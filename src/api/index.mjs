// Hàm api: /health và API nghiệp vụ /orders. Đứng sau Lambda authorizer.
import { randomUUID } from "node:crypto";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { CONTROL_TABLE, ORDERS_TABLE, REGION, db, json, parseBody, routeOf } from "../shared/lib.mjs";

const USAGE_RETENTION_DAYS = 8;

async function health() {
  // Đặt biến môi trường HEALTH_FORCE_FAIL=true để giả lập region chết khi demo chuyển vùng.
  if (process.env.HEALTH_FORCE_FAIL === "true") return json(503, { status: "unhealthy", reason: "forced" });
  try {
    // Đọc thật vào DynamoDB để health check phản ánh cả tầng dữ liệu.
    await db.send(new GetCommand({ TableName: ORDERS_TABLE, Key: { PK: "HEALTH", SK: "HEALTH" } }));
    return json(200, { status: "ok" });
  } catch (err) {
    console.error("health check failed", err);
    return json(503, { status: "unhealthy", reason: "dynamodb" });
  }
}

const orderRef = (tenantId, orderId) => ({ PK: `TENANT#${tenantId}`, SK: `ORDER#${orderId}` });
const toOrder = ({ PK, SK, ...rest }) => rest;

async function orders(method, tenantId, id, event) {
  if (!id && method === "GET") {
    const res = await db.send(
      new QueryCommand({
        TableName: ORDERS_TABLE,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
        ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}`, ":sk": "ORDER#" },
        Limit: 50,
      }),
    );
    return json(200, { orders: res.Items.map(toOrder) });
  }

  if (!id && method === "POST") {
    const now = new Date().toISOString();
    const order = { id: randomUUID(), data: parseBody(event), createdAt: now, updatedAt: now, writtenIn: REGION };
    await db.send(new PutCommand({ TableName: ORDERS_TABLE, Item: { ...orderRef(tenantId, order.id), ...order } }));
    return json(201, { order });
  }

  if (id && method === "GET") {
    const res = await db.send(new GetCommand({ TableName: ORDERS_TABLE, Key: orderRef(tenantId, id) }));
    return res.Item ? json(200, { order: toOrder(res.Item) }) : json(404, { error: "Không tìm thấy đơn hàng" });
  }

  if (id && method === "PUT") {
    const res = await db.send(new GetCommand({ TableName: ORDERS_TABLE, Key: orderRef(tenantId, id) }));
    if (!res.Item) return json(404, { error: "Không tìm thấy đơn hàng" });
    // Ghi đè cả bản ghi: khi hai region cùng sửa một đơn, bản ghi muộn hơn thắng (last-write-wins).
    const order = { ...res.Item, data: parseBody(event), updatedAt: new Date().toISOString(), writtenIn: REGION };
    await db.send(new PutCommand({ TableName: ORDERS_TABLE, Item: order }));
    return json(200, { order: toOrder(order) });
  }

  if (id && method === "DELETE") {
    await db.send(new DeleteCommand({ TableName: ORDERS_TABLE, Key: orderRef(tenantId, id) }));
    return json(200, { deleted: id });
  }

  return json(405, { error: "Method không được hỗ trợ" });
}

// Mỗi lượt gọi cộng vào bộ đếm của phút hiện tại. Region nằm trong sort key nên mỗi region
// chỉ cộng vào bản ghi của riêng mình: hai region không bao giờ ghi đè số liệu của nhau.
async function recordUsage(tenantId, keyId, statusCode, durationMs) {
  const minute = new Date().toISOString().slice(0, 16);
  try {
    await db.send(
      new UpdateCommand({
        TableName: CONTROL_TABLE,
        Key: { PK: `TENANT#${tenantId}`, SK: `USAGE#${minute}#${REGION}#${keyId}` },
        UpdateExpression:
          "ADD #requests :one, #errors :error, #totalMs :ms SET #minute = :minute, #region = :region, #keyId = :keyId, #expiresAt = :expiresAt",
        ExpressionAttributeNames: {
          "#requests": "requests",
          "#errors": "errors",
          "#totalMs": "totalMs",
          "#minute": "minute",
          "#region": "servedRegion",
          "#keyId": "keyId",
          "#expiresAt": "expiresAt",
        },
        ExpressionAttributeValues: {
          ":one": 1,
          ":error": statusCode >= 400 ? 1 : 0,
          ":ms": durationMs,
          ":minute": minute,
          ":region": REGION,
          ":keyId": keyId,
          ":expiresAt": Math.floor(Date.now() / 1000) + USAGE_RETENTION_DAYS * 86400,
        },
      }),
    );
  } catch (err) {
    // Mất một lượt đếm không được làm hỏng request của khách hàng.
    console.error("failed to record usage", err);
  }
}

export const handler = async (event) => {
  const { method, parts } = routeOf(event);
  const [resource, id, ...extra] = parts;

  if (resource === "health" && !id && method === "GET") return health();

  // tenant_id chỉ lấy từ authorizer context, không bao giờ từ request của client.
  const { tenant_id: tenantId, key_id: keyId } = event.requestContext?.authorizer ?? {};
  if (!tenantId) return json(403, { error: "Thiếu thông tin xác thực" });

  const started = Date.now();
  let response;
  try {
    response =
      resource === "orders" && extra.length === 0
        ? await orders(method, tenantId, id, event)
        : json(404, { error: "Không tìm thấy" });
  } catch (err) {
    console.error("unhandled error", err);
    response = json(500, { error: "Lỗi hệ thống" });
  }
  await recordUsage(tenantId, keyId, response.statusCode, Date.now() - started);
  return response;
};
