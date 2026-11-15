// Tạo tài khoản admin trên portal, tích hợp sẵn project mẫu (API Todo demo + key "Project mẫu").
// Chạy trong CloudShell ap-southeast-1 (bảng control là Global Table nên Tokyo tự có bản sao):
//   mkdir -p ~/seed && cd ~/seed && npm i @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
//   CONTROL_TABLE=mrapi-control node seed-admin.mjs
// Lần đầu không đặt ADMIN_PASSWORD thì script tự sinh mật khẩu ngẫu nhiên và in ra một lần.
// Chạy lại an toàn: giữ tài khoản, API và key đã có. Thêm --new-key để cấp key mới (key cũ bị thu hồi).
// Mật khẩu và secret key chỉ in ra terminal một lần, không ghi vào repo.
import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { pathToFileURL } from "node:url";

export const ADMIN_EMAIL = "admin@multi-region.io.vn";
export const ADMIN_ORG = "MRAPI Admin";
export const SAMPLE_API = { name: "API Todo demo", baseUrl: "https://jsonplaceholder.typicode.com", timeoutMs: 5000 };
export const SAMPLE_KEY_NAME = "Project mẫu";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hashPassword = (password, salt) => scryptSync(password, salt, 32).toString("hex");

async function queryTenant(db, Q, table, tenantId, prefix) {
  const items = [];
  let ExclusiveStartKey;
  do {
    const res = await db.send(new Q({ TableName: table, KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
      ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": prefix }, ConsistentRead: true, ExclusiveStartKey }));
    items.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

// cmd: { GetCommand, PutCommand, QueryCommand } của @aws-sdk/lib-dynamodb (truyền vào để test được).
export async function seedAdmin({ db, cmd, table, password, newKey = false, now = () => new Date().toISOString() }) {
  const { GetCommand, PutCommand, QueryCommand } = cmd;
  const out = { email: ADMIN_EMAIL, created: [] };

  let { Item: user } = await db.send(new GetCommand({ TableName: table, Key: { PK: `USER#${ADMIN_EMAIL}`, SK: "META" }, ConsistentRead: true }));
  if (!user) {
    if (!password || password.length < 8 || password.length > 200) throw new Error("Tài khoản admin chưa có: đặt ADMIN_PASSWORD (8–200 ký tự)");
    const salt = randomBytes(16).toString("hex");
    user = { PK: `USER#${ADMIN_EMAIL}`, SK: "META", email: ADMIN_EMAIL, orgName: ADMIN_ORG, role: "admin",
      tenantId: `t${randomBytes(5).toString("hex")}`, salt, passwordHash: hashPassword(password, salt), createdAt: now() };
    await db.send(new PutCommand({ TableName: table, Item: user, ConditionExpression: "attribute_not_exists(PK)" }));
    out.created.push("user");
  } else if (user.role !== "admin" || password) {
    // Tài khoản đã có: bảo đảm role admin; nếu có ADMIN_PASSWORD thì đặt lại mật khẩu.
    const salt = password ? randomBytes(16).toString("hex") : user.salt;
    user = { ...user, role: "admin", salt, passwordHash: password ? hashPassword(password, salt) : user.passwordHash };
    await db.send(new PutCommand({ TableName: table, Item: user }));
    out.created.push(password ? "password" : "role");
  }
  out.tenantId = user.tenantId;

  const apis = await queryTenant(db, QueryCommand, table, user.tenantId, "API#");
  let api = apis.find((item) => item.name === SAMPLE_API.name && item.baseUrl === SAMPLE_API.baseUrl);
  if (!api) {
    const t = now();
    const apiId = `a${randomUUID().replaceAll("-", "")}`;
    api = { PK: `TENANT#${user.tenantId}`, SK: `API#${apiId}`, apiId, tenantId: user.tenantId, ...SAMPLE_API,
      enabled: true, revision: 1, createdAt: t, updatedAt: t };
    await db.send(new PutCommand({ TableName: table, Item: api, ConditionExpression: "attribute_not_exists(PK)" }));
    out.created.push("api");
  }
  out.apiId = api.apiId;

  const keys = await queryTenant(db, QueryCommand, table, user.tenantId, "KEY#");
  const active = keys.filter((item) => item.name === SAMPLE_KEY_NAME && item.status === "active");
  if (active.length && !newKey) {
    out.keyId = active[0].keyId;
  } else {
    for (const old of active) {
      await db.send(new PutCommand({ TableName: table, Item: { ...old, status: "revoked", revokedAt: now() } }));
    }
    const keyId = randomBytes(6).toString("hex");
    const apiKey = `mrk_${user.tenantId}_${keyId}_${randomBytes(24).toString("hex")}`;
    await db.send(new PutCommand({ TableName: table, Item: { PK: `TENANT#${user.tenantId}`, SK: `KEY#${keyId}`, keyId,
      name: SAMPLE_KEY_NAME, status: "active", apiIds: [api.apiId], createdAt: now(), keyHash: sha256(apiKey) } }));
    out.keyId = keyId;
    out.apiKey = apiKey;
    out.created.push("key");
  }
  return out;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const table = process.env.CONTROL_TABLE;
  if (!table) { console.error("Thiếu CONTROL_TABLE (vd mrapi-control)"); process.exit(1); }
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const lib = await import("@aws-sdk/lib-dynamodb");
  const db = lib.DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION ?? "ap-southeast-1" }));
  const { Item: existing } = await db.send(new lib.GetCommand({ TableName: table, Key: { PK: `USER#${ADMIN_EMAIL}`, SK: "META" } }));
  const generated = !existing && !process.env.ADMIN_PASSWORD ? randomBytes(12).toString("base64url") : undefined;
  const result = await seedAdmin({ db, cmd: lib, table, password: process.env.ADMIN_PASSWORD ?? generated, newKey: process.argv.includes("--new-key") });
  if (generated) console.log(`Mật khẩu admin (chỉ hiện lần này, đổi bằng ADMIN_PASSWORD): ${generated}`);
  console.log(`Admin: ${result.email} (tenant ${result.tenantId}) — đã tạo/cập nhật: ${result.created.join(", ") || "không có gì"}`);
  console.log(`API mẫu: ${SAMPLE_API.name} → ID ${result.apiId}`);
  if (result.apiKey) {
    console.log("\nĐiền vào project_test/.env (secret chỉ hiện lần này):");
    console.log(`MRAPI_GATEWAY_URL=https://api.multi-region.io.vn\nMRAPI_API_ID=${result.apiId}\nMRAPI_API_KEY=${result.apiKey}`);
  } else {
    console.log(`Key "${SAMPLE_KEY_NAME}" (${result.keyId}) đã có; chạy lại với --new-key nếu cần secret mới.`);
  }
}
