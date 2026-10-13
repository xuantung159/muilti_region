// Lambda authorizer của API Gateway: kiểm tra API key và gắn tenant_id vào request.
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { CONTROL_TABLE, KEY_PATTERN, db, keyRef, routeOf, sameHex, sha256 } from "../shared/lib.mjs";

// API Gateway trả 401 khi authorizer ném đúng chuỗi "Unauthorized".
export const handler = async (event) => {
  const apiKey = routeOf(event).headers["x-api-key"] ?? "";
  const match = KEY_PATTERN.exec(apiKey);
  if (!match) throw new Error("Unauthorized");
  const [, tenantId, keyId] = match;

  const { Item: key } = await db.send(
    new GetCommand({ TableName: CONTROL_TABLE, Key: keyRef(tenantId, keyId), ConsistentRead: true }),
  );
  if (!key || key.status !== "active" || !sameHex(sha256(apiKey), key.keyHash)) {
    throw new Error("Unauthorized");
  }

  return {
    principalId: keyId,
    policyDocument: {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "execute-api:Invoke", Resource: event.methodArn }],
    },
    // Hàm api chỉ tin tenant_id ở đây, không tin gì từ phía client.
    context: { tenant_id: tenantId, key_id: keyId },
  };
};
