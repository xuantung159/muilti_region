// Phần dùng chung của ba hàm Lambda.
import { createHash, timingSafeEqual } from "node:crypto";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

export const REGION = process.env.AWS_REGION;
export const CONTROL_TABLE = process.env.CONTROL_TABLE;
export const TELEMETRY_TABLE = process.env.TELEMETRY_TABLE;

// Bảng control:
//   USER#<email>      / META                            tài khoản doanh nghiệp (mật khẩu đã băm)
//   SESSION#<hash>    / META                            phiên đăng nhập
//   TENANT#<tenantId> / API#<apiId>                     cấu hình API đích
//   TENANT#<tenantId> / KEY#<keyId>                     API key (chỉ lưu bản băm) và apiIds được phép gọi
//   TENANT#<tenantId> / USAGE#<phút>#<region>#<keyId>   bộ đếm lượt gọi theo phút
export const db = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Served-Region": REGION },
  body: JSON.stringify({ region: REGION, ...body }),
});

export const parseBody = (event) => {
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? "", "base64").toString("utf8") : event.body;
    const parsed = JSON.parse(raw || "{}");
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

// Method, các đoạn của đường dẫn và header (tên viết thường) từ sự kiện API Gateway REST.
export const routeOf = (event) => ({
  method: event.httpMethod,
  parts: (event.path ?? "/").split("/").filter(Boolean),
  headers: Object.fromEntries(
    Object.entries(event.headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  ),
});

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export const sameHex = (a, b) => {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
};

export const text = (value, max) =>
  typeof value === "string" && value.trim().length <= max ? value.trim() : "";

// Dạng key: mrk_<tenantId>_<keyId>_<secret>. tenantId và keyId không bí mật,
// chỉ để tra đúng bản ghi bằng một lần GetItem; bảng lưu SHA-256 của cả key.
export const KEY_PATTERN = /^mrk_(t[a-f0-9]{10})_([a-f0-9]{12})_[a-f0-9]{48}$/;
export const keyRef = (tenantId, keyId) => ({ PK: `TENANT#${tenantId}`, SK: `KEY#${keyId}` });
export const API_ID_PATTERN = /^a[0-9a-f]{32}$/;
export const apiRef = (tenantId, apiId) => ({ PK: `TENANT#${tenantId}`, SK: `API#${apiId}` });
