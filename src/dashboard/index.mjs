// API doanh nghiệp. Giao diện React dùng chung nằm trong monitoring-web/.
import { randomBytes, scryptSync } from "node:crypto";
import { GetHealthCheckStatusCommand, ListHealthChecksCommand, Route53Client } from "@aws-sdk/client-route-53";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { API_ID_PATTERN, CONTROL_TABLE, TELEMETRY_TABLE, apiRef, db, json, keyRef, parseBody, routeOf, sameHex, sha256, text } from "../shared/lib.mjs";
import { apis } from './apis.mjs';

const SESSION_HOURS = 8;
const MAX_KEYS = 20;
const MAX_KEY_APIS = 20;
// Khoảng thời gian xem thống kê: số ô trên biểu đồ, độ dài một ô (phút), số ký tự ISO xác định một ô.
const RANGES = {
  "1h": { buckets: 60, minutes: 1, chars: 16 },
  "24h": { buckets: 24, minutes: 60, chars: 13 },
  "7d": { buckets: 7, minutes: 1440, chars: 10 },
};
const HEALTH_CHECK_PREFIX = `${process.env.PROJECT}-hc-`;

// Route 53 là dịch vụ toàn cục, API của nó đặt tại us-east-1.
const route53 = new Route53Client({ region: "us-east-1", maxAttempts: 1 });

// ---------- Tài khoản và phiên đăng nhập ----------

const hashPassword = (password, salt) => scryptSync(password, salt, 32).toString("hex");

// Phiên lưu trong bảng control (Global Table) nên đăng nhập ở region này vẫn dùng được ở region kia.
async function startSession(user) {
  const token = randomBytes(32).toString("hex");
  await db.send(
    new PutCommand({
      TableName: CONTROL_TABLE,
      Item: {
        PK: `SESSION#${sha256(token)}`,
        SK: "META",
        tenantId: user.tenantId,
        orgName: user.orgName,
        email: user.email,
        expiresAt: Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600,
      },
    }),
  );
  return { token, orgName: user.orgName, email: user.email, tenantId: user.tenantId };
}

async function signup(event) {
  const body = parseBody(event);
  const orgName = text(body.orgName, 100);
  const email = text(body.email, 200).toLowerCase();
  if (!orgName) return json(400, { error: "Cần nhập tên doanh nghiệp" });
  if (!/^\S+@\S+\.\S+$/.test(email)) return json(400, { error: "Email không hợp lệ" });
  if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 200) {
    return json(400, { error: "Mật khẩu cần ít nhất 8 ký tự" });
  }

  const salt = randomBytes(16).toString("hex");
  const user = { email, orgName, tenantId: `t${randomBytes(5).toString("hex")}` };
  try {
    await db.send(
      new PutCommand({
        TableName: CONTROL_TABLE,
        Item: {
          PK: `USER#${email}`,
          SK: "META",
          ...user,
          salt,
          passwordHash: hashPassword(body.password, salt),
          createdAt: new Date().toISOString(),
        },
        ConditionExpression: "attribute_not_exists(PK)",
      }),
    );
  } catch (err) {
    if (err.name === "ConditionalCheckFailedException") return json(409, { error: "Email này đã được đăng ký" });
    throw err;
  }
  return json(201, await startSession(user));
}

async function login(event) {
  const body = parseBody(event);
  const email = text(body.email, 200).toLowerCase();
  if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 200 || !/^\S+@\S+\.\S+$/.test(email)) {
    return json(401, { error: 'Email hoặc mật khẩu không đúng' });
  }
  const password = body.password;

  const { Item: user } = await db.send(
    new GetCommand({ TableName: CONTROL_TABLE, Key: { PK: `USER#${email}`, SK: "META" }, ConsistentRead: true }),
  );
  // Vẫn băm khi không có tài khoản để thời gian phản hồi không tiết lộ email nào đã đăng ký.
  const given = hashPassword(password, user?.salt ?? "00");
  if (!user || !sameHex(given, user.passwordHash)) return json(401, { error: "Email hoặc mật khẩu không đúng" });
  return json(200, await startSession(user));
}

const bearer = (headers) => /^Bearer ([a-f0-9]{64})$/.exec(headers.authorization ?? "")?.[1];
const sessionRef = (token) => ({ PK: `SESSION#${sha256(token)}`, SK: "META" });

async function sessionOf(headers) {
  const token = bearer(headers);
  if (!token) return null;
  const { Item: session } = await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: sessionRef(token), ConsistentRead: true }));
  return session && session.expiresAt > Date.now() / 1000 ? session : null;
}

async function logout(headers) {
  const token = bearer(headers);
  if (token) await db.send(new DeleteCommand({ TableName: CONTROL_TABLE, Key: sessionRef(token) }));
  return json(200, {});
}

// ---------- API key: tenantId luôn lấy từ phiên đăng nhập ----------

async function listKeyItems(tenantId) {
  const res = await db.send(
    new QueryCommand({
      TableName: CONTROL_TABLE,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "KEY#" },
    }),
  );
  return res.Items;
}

async function listKeys(session) {
  const items = await listKeyItems(session.tenantId);
  const keys = items
    .map(({ keyId, name, status, apiIds = [], createdAt, revokedAt }) => ({ keyId, name, status, apiIds, createdAt, revokedAt }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json(200, { keys });
}

// Scope của key: danh sách API của chính doanh nghiệp mà key được phép gọi qua proxy.
async function createKey(session, event) {
  const body = parseBody(event);
  const name = text(body.name, 60);
  if (!name) return json(400, { error: "Cần nhập tên ứng dụng (tối đa 60 ký tự)" });
  const apiIds = Array.isArray(body.apiIds) ? [...new Set(body.apiIds)] : [];
  if (!apiIds.length || apiIds.length > MAX_KEY_APIS || !apiIds.every((id) => typeof id === "string" && API_ID_PATTERN.test(id))) {
    return json(400, { error: `Chọn từ 1 đến ${MAX_KEY_APIS} API mà key được phép gọi` });
  }
  const owned = await Promise.all(apiIds.map((apiId) =>
    db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: apiRef(session.tenantId, apiId), ConsistentRead: true }))));
  if (owned.some(({ Item }) => !Item)) return json(400, { error: "Có API không tồn tại hoặc không thuộc doanh nghiệp này" });
  if ((await listKeyItems(session.tenantId)).length >= MAX_KEYS) {
    return json(400, { error: `Mỗi doanh nghiệp tối đa ${MAX_KEYS} key` });
  }

  const keyId = randomBytes(6).toString("hex");
  const apiKey = `mrk_${session.tenantId}_${keyId}_${randomBytes(24).toString("hex")}`;
  const key = { keyId, name, status: "active", apiIds, createdAt: new Date().toISOString() };
  await db.send(
    new PutCommand({
      TableName: CONTROL_TABLE,
      Item: { ...keyRef(session.tenantId, keyId), ...key, keyHash: sha256(apiKey) },
    }),
  );
  // apiKey chỉ trả về đúng một lần ở đây.
  return json(201, { key, apiKey });
}

async function revokeKey(session, keyId) {
  const ref = keyRef(session.tenantId, keyId);
  const { Item: key } = await db.send(new GetCommand({ TableName: CONTROL_TABLE, Key: ref, ConsistentRead: true }));
  if (!key) return json(404, { error: "Không tìm thấy key" });
  if (key.status === "active") {
    await db.send(
      new PutCommand({
        TableName: CONTROL_TABLE,
        Item: { ...key, status: "revoked", revokedAt: new Date().toISOString() },
      }),
    );
  }
  return json(200, { keyId, status: "revoked" });
}

// ---------- Thống kê: tổng hợp request từ telemetry do proxy ghi ----------

async function usage(session, event) {
  if (!TELEMETRY_TABLE) return json(503, { error: "Chưa cấu hình TELEMETRY_TABLE cho dashboard" });
  const rangeName = event.queryStringParameters?.range ?? "24h";
  const range = RANGES[rangeName];
  if (!range) return json(400, { error: "range phải là 1h, 24h hoặc 7d" });

  const now = new Date();
  const start = new Date(now.getTime() - (range.buckets - 1) * range.minutes * 60_000);
  const from = start.toISOString().slice(0, range.chars);

  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(
      new QueryCommand({
        TableName: TELEMETRY_TABLE,
        KeyConditionExpression: "PK = :pk AND SK BETWEEN :from AND :to",
        ExpressionAttributeValues: { ":pk": `TENANT#${session.tenantId}`, ":from": from, ":to": `${now.toISOString()}#~` },
        ConsistentRead: true,
        ExclusiveStartKey,
      }),
    );
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  const add = (target, name, item) => {
    target[name] ??= { requests: 0, errors: 0 };
    target[name].requests += item.requests ?? 0;
    target[name].errors += item.errors ?? 0;
  };
  const totals = { requests: 0, errors: 0, totalMs: 0 };
  const byRegion = {};
  const byKey = {};
  const series = {};
  for (const record of items) {
    if (!record.timestamp || !Number.isFinite(record.status) || !Number.isFinite(record.latencyMs)) continue;
    const item = { requests: 1, errors: record.status >= 400 ? 1 : 0, totalMs: record.latencyMs,
      servedRegion: record.region, keyId: record.keyId, minute: record.timestamp };
    totals.requests += item.requests ?? 0;
    totals.errors += item.errors ?? 0;
    totals.totalMs += item.totalMs ?? 0;
    add(byRegion, item.servedRegion, item);
    add(byKey, item.keyId, item);
    add(series, `${item.minute.slice(0, range.chars)}|${item.servedRegion}`, item);
  }

  return json(200, {
    range: rangeName,
    source: "telemetry",
    generatedAt: new Date().toISOString(),
    totals,
    byRegion,
    byKey,
    series: Object.entries(series).map(([name, value]) => {
      const [bucket, servedRegion] = name.split("|");
      return { bucket, servedRegion, ...value };
    }),
  });
}

// ---------- Trạng thái region: đọc từ health check của Route 53 ----------
// Dùng chung nguồn với cơ chế định tuyến, nên trạng thái hiển thị trùng với quyết định của Route 53.

async function regionStatus() {
  try {
    const options = { abortSignal: AbortSignal.timeout(3000) };
    const { HealthChecks = [] } = await route53.send(new ListHealthChecksCommand({}), options);
    const checks = HealthChecks.filter((check) => check.CallerReference?.startsWith(HEALTH_CHECK_PREFIX));
    const regions = await Promise.all(
      checks.map(async (check) => {
        const { HealthCheckObservations: observations = [] } = await route53.send(
          new GetHealthCheckStatusCommand({ HealthCheckId: check.Id }),
          options,
        );
        const ok = observations.filter((o) => o.StatusReport?.Status?.startsWith("Success")).length;
        // Route 53 coi endpoint là khoẻ khi hơn 18% điểm kiểm tra báo thành công.
        const status = !observations.length ? "unknown" : ok / observations.length > 0.18 ? "healthy" : "unhealthy";
        return { region: check.CallerReference.slice(HEALTH_CHECK_PREFIX.length), status };
      }),
    );
    return json(200, { regions: regions.sort((a, b) => a.region.localeCompare(b.region)) });
  } catch (err) {
    console.error("failed to read health checks", err);
    return json(200, { regions: [] });
  }
}

// ---------- Định tuyến ----------

async function portalApi(method, [action, id, ...extra], headers, event) {
  if (extra.length) return json(404, { error: "Không tìm thấy" });
  if (action === "signup" && !id && method === "POST") return signup(event);
  if (action === "login" && !id && method === "POST") return login(event);
  if (action === "logout" && !id && method === "POST") return logout(headers);

  const session = await sessionOf(headers);
  if (!session) return json(401, { error: "Phiên đăng nhập không hợp lệ hoặc đã hết hạn" });
  if (action === 'apis') return apis(method, id, session, event);

  if (action === "me" && !id && method === "GET") {
    return json(200, { orgName: session.orgName, email: session.email, tenantId: session.tenantId });
  }
  if (action === "keys" && !id && method === "GET") return listKeys(session);
  if (action === "keys" && !id && method === "POST") return createKey(session, event);
  if (action === "keys" && id && method === "DELETE") return revokeKey(session, id);
  if (action === "usage" && !id && method === "GET") return usage(session, event);
  if (action === "status" && !id && method === "GET") return regionStatus();
  return json(404, { error: "Không tìm thấy" });
}

const dispatch = async (event) => {
  const { method, parts, headers } = routeOf(event);
  const [resource, ...rest] = parts;

  try {
    if (!resource && method === "GET") {
      if (process.env.FRONTEND_URL) return {
        statusCode: 302,
        headers: { Location: `${process.env.FRONTEND_URL.replace(/\/+$/, '')}/portal`, 'Cache-Control': 'no-store' },
        body: '',
      };
      return json(200, { service: 'portal-api', frontend: '/portal' });
    }
    if (resource === "api") return await portalApi(method, rest, headers, event);
    return json(404, { error: "Không tìm thấy" });
  } catch (err) {
    console.error("unhandled error", err);
    return json(500, { error: "Lỗi hệ thống" });
  }
};

// Origin cố định theo deployment; không phản chiếu Origin tùy ý từ request.
export const handler = async event => {
  const origin = process.env.PORTAL_ALLOWED_ORIGIN;
  const response = event.httpMethod === 'OPTIONS'
    ? { statusCode: 204, headers: {}, body: '' }
    : await dispatch(event);
  if (!origin) return response;
  return { ...response, headers: {
    ...response.headers,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    Vary: 'Origin',
  } };
};
