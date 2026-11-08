# Nghiệm thu E2E luồng chính — 08/11/2026

Phạm vi: portal → API đích → key có scope → authorizer → proxy → telemetry/usage, chạy trên AWS thật ở Singapore (`43vakggyh5`, stage `demo`), Tokyo (`n39r5pits8`, stage `demo`) và domain latency `https://api.multi-region.io.vn`. Mọi giờ dưới đây là giờ Việt Nam (UTC+7). Upstream mẫu: `https://httpbin.org` (mặc định của script). Chạy tuần tự từ máy nhóm (Node 24), không bắn song song.

Không có thay đổi hạ tầng AWS, không xóa tài nguyên. Không có key/token/mật khẩu nào được ghi vào báo cáo (key chỉ ghi `keyId`, phần bí mật không lưu ở đâu).

## Tóm tắt

| Hạng mục | Kết quả |
|---|---|
| Ca kiểm thử | **38 PASS / 1 FAIL** (FAIL là lệch tài liệu về body của 403, không phải lỗi chặn quyền) |
| Unit test `npm test --prefix src` | 34/34 pass (07:5x, trước khi chạy E2E) |
| Thu hồi key xuyên Region (probe nhanh, 5 lượt/chiều) | SG→Tokyo: min 0 / median 208 / max 894 ms · Tokyo→SG: min 0 / median 204 / max 236 ms |
| Thu hồi key xuyên Region (probe qua httpbin, 5 lượt/chiều) | SG→Tokyo: min 0 / median 656 / max 1340 ms · Tokyo→SG: min 773 / median 804 / max 848 ms |
| Đối chiếu requestId → log → DynamoDB → X-Ray | Có, cả hai Region; trace X-Ray đầy đủ cho một request được sampling |
| Bug trong `src/` | Không phát hiện; **không sửa, không deploy** code nào |

## Cách chạy

| Script | Lệnh | Ghi chú |
|---|---|---|
| `tests/e2e/control-plane.mjs` | `API_BASE_URL=<base> npm run test:e2e --prefix src` | Đã thêm tiền tố dữ liệu thử `E2E_TAG` (mặc định `e2e-YYYYMMDD`) |
| `tests/e2e/proxy.mjs` | `API_BASE_URL=<base> npm run test:e2e:proxy --prefix src` | Như trên |
| `tests/e2e/acceptance-extra.mjs` (mới) | `node tests/e2e/acceptance-extra.mjs` | Ca bổ sung: 2 tenant cùng gọi 2xx, cách ly key qua portal, 502, usage đếm đúng ở 2 Region |
| `tests/e2e/revoke-cross-region.mjs` (mới) | `ROUNDS=5 [PROBE=upstream] node tests/e2e/revoke-cross-region.mjs` | Đo thu hồi key SG↔Tokyo, poll ~200 ms, tối đa 30 s |

`<base>` lần lượt là `https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo`, `https://n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo`, `https://api.multi-region.io.vn`.

## 1. Control plane (07:53:54 – 07:54:15)

| # | Ca | Mong đợi | SG | Tokyo | Domain |
|---|---|---|---|---|---|
| C | Signup 201, trùng email 409, login 200; tenant Y GET/PATCH API của X → 404; X sửa/tắt API → 200; baseUrl `http://127.0.0.1` → 400; logout → `/api/me` 401 | Như mô tả | PASS | PASS | PASS |

## 2. Proxy (`proxy.mjs`)

SG 07:54:19–07:54:31, Tokyo 07:54:31–07:54:42, domain 07:54:42–07:54:52.

| # | Ca | Mong đợi | Thực tế | SG | Tokyo | Domain |
|---|---|---|---|---|---|---|
| D2 | Key đúng: POST `/anything/orders?x=1&x=2` + body | 200, `X-Mrapi-Source: upstream`, giữ method/path/query/body, backend không nhận `x-api-key` | Đúng | PASS | PASS | PASS |
| D3 | Thiếu key; key sai 1 ký tự | 401 | 401 | PASS | PASS | PASS |
| D4 | Key gọi API ngoài scope; key tenant B gọi API tenant A | 403 | 403 | PASS | PASS | PASS |
| D5 | Backend 500; backend chậm 5 s (timeout 2 s); API tắt | 500 upstream; 504 `UPSTREAM_TIMEOUT`; 403 `API_DISABLED` | Đúng | PASS | PASS | PASS |
| D6 | Đăng ký đích `127.0.0.1`, `169.254.169.254`, `localhost`, `http://` | 400 | 400 | PASS | PASS | PASS |
| D3' | Key đã thu hồi (cùng Region) | 403 | 403 | PASS | PASS | PASS |

requestId mẫu: SG `91204bd0-7551-4f1c-8e25-aec066400ce1`, Tokyo `8ffd9ad7-b0d5-4a83-afeb-e73001eca0f1`, domain `ed1fe42e-2c5f-4abd-b71e-1b073615d29f`.

## 3. Ca bổ sung (`acceptance-extra.mjs`, 07:55:54 – 07:56:12)

Tenant A `t6e8f0efee4` (key `503077f0db19`), tenant B `t0f81911822` (key `9bd87f507805`), tạo ở SG, dùng ở cả hai Region.

| # | Ca | Mong đợi | Thực tế | Kết quả |
|---|---|---|---|---|
| X1 | A và B gọi API của mình ở SG và Tokyo | 200, `X-Served-Region` đúng Region | 200, đúng Region | PASS |
| X2 | B liệt kê key / DELETE key của A / GET API của A / liệt kê API | Không thấy; 404; 404; không thấy. Key A vẫn 200 | Đúng | PASS |
| X3 | Key đúng định dạng nhưng không tồn tại; key sai định dạng; gửi Bearer thay `x-api-key` (cả 2 Region) | 401 | 401 | PASS |
| X4 | Key A gọi API của B ở Tokyo | 403 | 403 | PASS |
| X5 | Backend không phân giải được (`e2e-20261108-nxdomain.multi-region.io.vn`) | 502 `UPSTREAM_UNREACHABLE`, source `gateway` | Đúng, requestId `56127efe-bd25-47ec-bfa3-3a7e264322aa` | PASS |
| X6 | Backend trả 503 (Tokyo) và 404 (SG) | Trả nguyên trạng, source `upstream` | Đúng | PASS |
| X7a | `/api/usage?range=1h` tenant A đọc ở SG | tổng 6, lỗi 2, SG 3, Tokyo 3, byKey 6 | 6 / 2 / 3 / 3 | PASS |
| X7b | Như trên, đọc ở Tokyo | như trên | 6 / 2 / 3 / 3 | PASS |
| X7c | Usage tenant B đọc ở SG | tổng 4, lỗi 1, SG 2, Tokyo 2 | 4 / 1 / 2 / 2 | PASS |
| X7d | Như trên, đọc ở Tokyo | như trên | 4 / 1 / 2 / 2 | PASS |
| X8 | Thu hồi key B ở SG → SG 403, Tokyo 403 sau đồng bộ | 403 | 403 cả hai; log `AUTHORIZER_DENY reason=KEY_REVOKED` ở SG 07:56:10.136 và Tokyo 07:56:11.206 | PASS |
| X9 | Body 403 khi key bị thu hồi có `code: KEY_REVOKED` như `docs/thiet-ke-gateway.md` ghi | `KEY_REVOKED` trong body | Body mặc định API Gateway `{"Message":"User is not authorized ... explicit deny ..."}`; lý do chỉ có trong log authorizer | **FAIL (lệch tài liệu)** |

Số đếm usage X7 chỉ gồm request đi qua proxy; các request bị authorizer chặn (X3, X4) không vào telemetry, đúng thiết kế.

X9: cần hoặc sửa tài liệu (client chỉ thấy 403 chung, lý do xem ở log `AUTHORIZER_DENY`), hoặc cấu hình Gateway Response `ACCESS_DENIED` dùng `$context.authorizer.reason`. Đây là cấu hình API Gateway, không phải code `src/`; chưa thay đổi.

## 4. Thu hồi key xuyên Region (`revoke-cross-region.mjs`)

Mỗi lượt: tạo key ở Region gốc → chờ Region đích dùng được → `DELETE /api/keys/{keyId}` ở Region gốc → poll Region đích mỗi ~200 ms đến khi 401/403. **Số đo = lúc gửi request bị chặn đầu tiên − lúc DELETE trả 200** (cận trên). "0" nghĩa là request đầu tiên sau DELETE đã bị chặn (đồng bộ xong trước khi client nhận phản hồi DELETE). Cửa sổ thực = [số đo − độ phân giải, số đo]. Không lượt nào vượt 30 s; mọi lượt bị chặn bằng 403.

### Lượt 2 — probe nhanh (API đích tắt, request được cho qua trả ngay 403 `API_DISABLED` từ proxy, không ra backend)

| Chiều | Lượt | keyId | DELETE gửi | DELETE 200 | Bị chặn đầu tiên | Số đo (ms) | Độ phân giải (ms) |
|---|---|---|---|---|---|---|---|
| SG→Tokyo | 1 | cad1f55ffa93 | 07:57:52.313 | 07:57:52.433 | 07:57:52.641 | 208 | 208 |
| SG→Tokyo | 2 | ddc0c2acb8c9 | 07:57:55.776 | 07:57:55.935 | 07:57:56.829 | 894 | 204 |
| SG→Tokyo | 3 | 348bf2b04ad8 | 07:57:59.555 | 07:57:59.663 | 07:57:59.868 | 205 | 205 |
| SG→Tokyo | 4 | cb418431d821 | 07:58:02.914 | 07:58:03.040 | 07:58:03.040 | 0 | 126 |
| SG→Tokyo | 5 | df476722ffa9 | 07:58:05.856 | 07:58:05.933 | 07:58:06.363 | 430 | 206 |
| Tokyo→SG | 1 | 66c20c521aae | 07:58:14.394 | 07:58:14.704 | 07:58:14.704 | 0 | 310 |
| Tokyo→SG | 2 | 0c312e0ddd9e | 07:58:17.543 | 07:58:17.796 | 07:58:18.032 | 236 | 236 |
| Tokyo→SG | 3 | 76854b61d7cf | 07:58:21.351 | 07:58:21.804 | 07:58:22.027 | 223 | 223 |
| Tokyo→SG | 4 | b2c33331561e | 07:58:25.045 | 07:58:25.215 | 07:58:25.215 | 0 | 170 |
| Tokyo→SG | 5 | dc2cfc7e757b | 07:58:28.087 | 07:58:28.273 | 07:58:28.477 | 204 | 204 |

| Chiều | n | min | median | max |
|---|---|---|---|---|
| SG→Tokyo | 5 | 0 ms | 208 ms | 894 ms |
| Tokyo→SG | 5 | 0 ms | 204 ms | 236 ms |

### Lượt 1 — probe qua backend httpbin (`PROBE=upstream`, mỗi poll được cho qua mất ~0,5–0,8 s nên độ phân giải kém)

| Chiều | Số đo từng lượt (ms) | min | median | max | Độ phân giải |
|---|---|---|---|---|---|
| SG→Tokyo (07:56:43–07:57:00) | 656, 661, 650, 1340, 0 | 0 | 656 | 1340 | 118–661 ms |
| Tokyo→SG (07:57:08–07:57:25) | 773, 785, 848, 804, 818 | 773 | 804 | 848 | 773–848 ms |

Lượt 1 cho cận trên lớn hơn chủ yếu vì độ phân giải: request được cho qua cuối cùng được gửi ngay sau DELETE, request kế tiếp chỉ đi sau khi httpbin trả lời. Kết luận dùng lượt 2.

**Kết luận (4 nhóm đo = 2 lượt × 2 chiều, đều PASS theo tiêu chí bị chặn trong 30 s):** thu hồi có hiệu lực ở Region còn lại trong dưới 1 giây ở cả 20 lượt (cận trên tối đa 1,34 s ở lượt 1, 0,89 s ở lượt 2), khớp giới hạn "~1 giây" trong thiết kế. Trong khoảng đó Region kia vẫn có thể cho key đã thu hồi đi qua. Tạo key cũng có độ trễ tương tự: key mới dùng được ở Region kia sau median 802 ms (SG→Tokyo) và 688 ms (Tokyo→SG) ở lượt 2.

## 5. Đối chiếu requestId → CloudWatch Logs → DynamoDB → X-Ray

Tra bằng AWS CLI trong CloudShell (us-east-1, `--region` từng Region), chỉ đọc.

| # | Bước | Mong đợi | Thực tế | Kết quả |
|---|---|---|---|---|
| T1 | Request 200 SG (D2): header `X-Request-Id` `91204bd0-7551-4f1c-8e25-aec066400ce1` → log `/aws/lambda/mrapi-proxy` SG → item `mrapi-telemetry` | Có log `PROXY_REQUEST` và item với cùng requestId ở cả 2 Region | Log 07:54:23.841, Lambda invocation `761c698a-…`, status 200, latency 709 ms; item `PK=TENANT#t81f4466e3a`, `SK=2026-11-08T00:54:23.132Z#91204bd0-…` có ở SG và replica Tokyo (`region=ap-southeast-1`) | PASS |
| T2 | Request 500 SG (D5) được X-Ray sampling: trace `1-6aefc840-07519e9e539b34f1168c4e46` → segment Lambda → log → telemetry | Cùng một request ở cả 4 nơi | Trace: `mrapi-api-sg/demo` 500 (0,736 s) → `mrapi-authorizer` (0,038 s) → `mrapi-proxy` invocation `4fdebe81-31aa-428a-bb97-44a2edff3f72` (0,68 s). Log của invocation đó: `PROXY_REQUEST requestId=fb4ee54b-7e4c-4ede-b191-c430cbef20d7`, `/status/500`, `UPSTREAM_5XX`, 668 ms, và dòng `XRAY TraceId: 1-6aefc840-… Sampled: true`. Item telemetry `SK=2026-11-08T00:54:24.628Z#fb4ee54b-…` có `GSI1PK=TENANT#t81f4466e3a#ERR`, có ở SG và Tokyo | PASS |

Tracing: `mrapi-proxy` và `mrapi-authorizer` ở cả hai Region `TracingConfig=Active`; stage `demo` hai Region `tracingEnabled=true`. Request D2 (200) không được sampling nên không có trace; sampling mặc định chỉ giữ một phần request, vì vậy chứng cứ X-Ray dùng request T2.

## 6. Bug và thay đổi code

- Không phát hiện bug trong `src/`. Không sửa `src/`, không deploy Lambda.
- Thay đổi trong repo (chưa commit theo quy định nhóm): `tests/e2e/control-plane.mjs`, `tests/e2e/proxy.mjs` thêm tiền tố `E2E_TAG` cho dữ liệu thử; thêm `tests/e2e/acceptance-extra.mjs`, `tests/e2e/revoke-cross-region.mjs`.

## 7. Dữ liệu thử đã tạo (bảng `mrapi-control`, Global Table)

Tất cả có tiền tố `e2e-20261108` trong tên tổ chức, email (`e2e-20261108-…@example.com`), tên API và tên key:

| Nguồn | Tenant | API đích | Key |
|---|---|---|---|
| control-plane × 3 lần | 6 | 3 (đã tắt, `backend.company.com`) | 0 |
| proxy × 3 lần | 6 | 9 (httpbin) | 6 — key tenant A đã thu hồi; key tenant B **còn active** |
| acceptance-extra | 2 (`t6e8f0efee4`, `t0f81911822`) | 3 (httpbin, nxdomain) | 2 — `9bd87f507805` đã thu hồi; `503077f0db19` **còn active** |
| revoke-cross-region × 2 lần | 4 (`t98e6bb4992`, `t595d74b77b`, `tb1664c7f87`, `t36039388a7`) | 4 | 20, đều đã thu hồi |

Tổng 18 tenant thử. Các key còn active không lưu bản rõ ở đâu nên không dùng lại được; nếu muốn sạch có thể thu hồi qua portal. Bảng `mrapi-telemetry` có các dòng tương ứng, tự xóa sau 30 ngày (TTL). Phiên đăng nhập của các tenant thử đã logout.

## Ghi chú vận hành

- Console CloudWatch trong trình duyệt tích hợp không tải được trang Logs ("Unable to load content"), nên dùng CloudShell. CloudShell SG và Tokyo đang được phiên khác dùng; lần mở CloudShell SG có thể đã làm phiên terminal SG của agent khác bị "detached" (bấm vào terminal để nối lại). Lệnh của báo cáo này chạy ở CloudShell us-east-1, chỉ đọc.
- Kết quả phụ thuộc httpbin.org công khai; nếu httpbin chậm, D5 (504) vẫn đúng nhưng các ca 200 có thể chậm.
