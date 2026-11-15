// Lambda authorizer kiểu REQUEST cho route /proxy/{apiId}/...: kiểm tra x-api-key và quyền (scope) của key.
//
// Kết quả trả về API Gateway:
//   - Key thiếu, sai định dạng hoặc không khớp bản băm → ném "Unauthorized" → 401.
//   - Key đúng nhưng đã thu hồi, hoặc key cũ không có scope → policy Deny → 403.
//   - Key hợp lệ → policy Allow cho đúng các API trong scope, context có tenant_id và key_id.
//     Gọi API ngoài scope nhận cùng policy đó; API Gateway trả 403 vì đường dẫn không có trong policy.
//
// API Gateway cache kết quả 60 giây theo x-api-key (authorizerResultTtlInSeconds), nên thu hồi key
// có hiệu lực chậm nhất sau 60 giây.
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
  if (!apiIds.length) return deny(event, keyId, tenantId, "KEY_SCOPE_DENIED");
  const requested = event.pathParameters?.apiId ?? routeOf(event).parts[1];
  // Gọi API ngoài scope vẫn trả cùng policy Allow (chỉ gồm API trong scope): API Gateway tự trả 403 cho đường dẫn
  // không có trong policy. Không trả Deny cả stage ở đây, vì kết quả được cache theo x-api-key và Deny sẽ chặn luôn
  // các API hợp lệ của key trong suốt thời gian cache.
  if (!apiIds.includes(requested)) {
    console.log(JSON.stringify({ event: "AUTHORIZER_DENY", reason: "KEY_SCOPE_DENIED", keyId, tenantId, path: event.path }));
  }

  const base = stageArn(event.methodArn);
  return {
    principalId: keyId,
    policyDocument: policy("Allow", apiIds.flatMap((id) => [`${base}/*/proxy/${id}`, `${base}/*/proxy/${id}/*`])),
    // Hàm proxy chỉ tin tenant_id/key_id ở đây, không tin gì từ phía client.
    context: { tenant_id: tenantId, key_id: keyId },
  };
};
