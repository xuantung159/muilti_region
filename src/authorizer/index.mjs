// Lambda authorizer kiểu REQUEST cho route /proxy/{apiId}/...: kiểm tra x-api-key và quyền (scope) của key.
//
// Kết quả trả về API Gateway:
//   - Key thiếu, sai định dạng hoặc không khớp bản băm → ném "Unauthorized" → 401.
//   - Key đúng nhưng đã thu hồi, hoặc gọi API không có trong apiIds của key → policy Deny → 403.
//   - Key hợp lệ → policy Allow cho đúng các API trong scope, context có tenant_id và key_id.
//
// Policy liệt kê mọi API trong scope (không chỉ API của request hiện tại) để API Gateway có thể
// cache kết quả theo x-api-key mà vẫn chặn đúng khi cùng key gọi sang API ngoài scope.
// Context không chứa apiId vì kết quả cache được dùng lại cho nhiều đường dẫn.
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { API_ID_PATTERN, CONTROL_TABLE, KEY_PATTERN, db, keyRef, routeOf, sameHex, sha256 } from "../shared/lib.mjs";

// methodArn: arn:aws:execute-api:<region>:<account>:<restApiId>/<stage>/<METHOD>/<path...>
const stageArn = (methodArn) => methodArn.split("/").slice(0, 2).join("/");

const policy = (effect, resources) => ({
  Version: "2012-10-17",
  Statement: [{ Effect: effect, Action: "execute-api:Invoke", Resource: resources }],
});

// Ghi lý do từ chối để chẩn đoán; không ghi key hay bản băm.
const deny = (event, keyId, tenantId, reason) => {
  console.log(JSON.stringify({ event: "AUTHORIZER_DENY", reason, keyId, tenantId, path: event.path }));
  return {
    principalId: keyId,
    policyDocument: policy("Deny", `${stageArn(event.methodArn)}/*`),
    context: { tenant_id: tenantId, key_id: keyId, reason },
  };
};

export const handler = async (event) => {
  const apiKey = routeOf(event).headers["x-api-key"] ?? "";
  const match = KEY_PATTERN.exec(apiKey);
  if (!match) throw new Error("Unauthorized");
  const [, tenantId, keyId] = match;

  const { Item: key } = await db.send(
    new GetCommand({ TableName: CONTROL_TABLE, Key: keyRef(tenantId, keyId), ConsistentRead: true }),
  );
  if (!key || !sameHex(sha256(apiKey), key.keyHash)) throw new Error("Unauthorized");
  if (key.status !== "active") return deny(event, keyId, tenantId, "KEY_REVOKED");

  // Key tạo trước khi có scope không có apiIds nên không gọi được API nào; tạo key mới để cấp quyền.
  const apiIds = (Array.isArray(key.apiIds) ? key.apiIds : []).filter((id) => API_ID_PATTERN.test(id));
  const requested = event.pathParameters?.apiId ?? routeOf(event).parts[1];
  if (!apiIds.includes(requested)) return deny(event, keyId, tenantId, "KEY_SCOPE_DENIED");

  const base = stageArn(event.methodArn);
  return {
    principalId: keyId,
    policyDocument: policy("Allow", apiIds.flatMap((id) => [`${base}/*/proxy/${id}`, `${base}/*/proxy/${id}/*`])),
    // Hàm proxy chỉ tin tenant_id/key_id ở đây, không tin gì từ phía client.
    context: { tenant_id: tenantId, key_id: keyId },
  };
};
