# Monitoring và X-Ray, 01/11/2026

Account `138150704839`. Bằng chứng: [docs/evidence/2026-11-01/monitoring/](../evidence/2026-11-01/monitoring/), bản trích CLI ở [cloudshell-output.txt](../evidence/2026-11-01/monitoring/cloudshell-output.txt).

## Kết luận

| Mục | Trạng thái | Căn cứ |
|---|---|---|
| R7, frontend qua CloudFront hiển thị monitoring thật | **PASS có điều kiện** | Nhãn `LIVE · BACKEND`, số khớp CloudWatch. Điều kiện còn lại ở mục 2 và 3 |
| R9, trace khớp requestId với log và telemetry | **PARTIAL** | Trace khớp requestId ở cả 2 Region. Khớp log và telemetry: **NOT TESTED** |
| Backend monitoring Tokyo | **FAIL** | Cả 4 route trả 502, code cũ có bug |
| Xác thực route monitoring | **Không có** | `auth=NONE` ở cả 2 Region, công khai qua 4 hostname |

Không thay đổi gì trên AWS. Không sửa `src/`. Chỉ thêm hồ sơ local.

## Hai điểm khác với bối cảnh ban đầu

1. **CloudFront đã có behavior `/monitoring/*`.** Bối cảnh ghi là chưa có. Behavior trỏ origin `mrapi-api-sg`, CachingDisabled. Lần sửa distribution gần nhất là 28/10 01:52:42 UTC, user `admin` (CloudTrail). Tôi không thêm behavior này. CloudTrail chỉ cho biết thời điểm và user, tôi không mở chi tiết sự kiện nên chưa khẳng định chính lần sửa đó đã thêm behavior.
2. **`/monitoring/health` không phải route.** Code chỉ nhận `snapshot`, `endpoints`, `incidents`, `sources`, các path khác trả 404 từ chính Lambda. Kết quả 404 đã biết không phải là lỗi.

`infra/cloudfront/README.md` vẫn ghi `/monitoring/*` chưa nối. Vì tôi không đổi CloudFront nên chưa sửa file đó; cần cập nhật khi gom hồ sơ.

## 1. Gọi monitoring

Thời điểm 01/11/2026 08:00 GMT+7, GET không kèm header xác thực.

| Route | SG execute-api | Tokyo execute-api | CloudFront `app.*` |
|---|---|---|---|
| `/monitoring/snapshot?range=24h` | 200, 25.856 byte | 502, 47 byte | 200, 25.856 byte |
| `/monitoring/endpoints?range=24h` | 200, 627 byte | 502, 47 byte | 200, 627 byte |
| `/monitoring/incidents` | 200, 1.565 byte | 502, 47 byte | 200, 1.565 byte |
| `/monitoring/sources` | 200, 2.213 byte | 502, 47 byte | 200, 2.213 byte |

`https://api.multi-region.io.vn/monitoring/sources` cũng trả 200 (từ máy kiểm tra, đi tới SG theo latency routing).

**Body SG có dữ liệu thật.** Snapshot 24h: `dataMode: live`, 96 ô series, SG 44.161 request, Tokyo 44.525, cả hai health check `healthy`. Missing đúng hai nhóm: replication DynamoDB ở 2 Region và S3 (`unavailable`, Tokyo `not_configured`).

**Lỗi Tokyo.** Body `{"error":"upstream_error","detail":"TypeError"}`. Log ghi `service[name] is not a function`. Nguyên nhân đã xác nhận bằng code đang chạy:

| | SG | Tokyo |
|---|---|---|
| CodeSha256 | `tCPCJhwb…` | `Sfs9t0zX…` |
| LastModified | 27/10 15:59 UTC | 25/10 16:30 UTC |
| Handler | `handler(event, _context)` | `handler(event, service = realService())` |

Lambda truyền `context` vào đối số thứ hai nên `service` thành context. SG đã có bản sửa, Tokyo chưa. File `index.mjs` ở SG trùng SHA-256 với `src/monitoring/index.mjs` local (`86ea275a…`).

Báo cáo 27/10 ghi CodeSha256 khớp từng cặp. Hôm nay cặp monitoring không khớp, nên kết luận đó không còn đúng cho hàm này.

**MONITORING_CONFIG:** rỗng ở cả 2 Region, nên code dùng `DEFAULT_CONFIG`. Tên API thật là `mrapi-api-sg` và `mrapi-api-tyo`, đúng với default. Không cần sửa env. Chứng cứ thêm: Lambda SG đọc được metric của Tokyo (44.525 request). `MONITORING_ALLOWED_ORIGIN` rỗng, không cần vì frontend gọi cùng origin qua CloudFront.

## 2. Bảo mật

**Phát hiện:** `GET /monitoring/{proxy+}` là `authorizationType NONE`, `apiKeyRequired false` ở cả 2 Region. Hàm không tự xác thực. Dữ liệu SG mở công khai qua `app.multi-region.io.vn`, `api.multi-region.io.vn` và execute-api. Tokyo cũng mở nhưng đang 502, nên sửa bug Tokyo sẽ mở thêm một đường.

**Dữ liệu lộ ra:**
- Số liệu tổng hợp theo Region: request, tỷ lệ lỗi, latency, Lambda invocations/errors/duration.
- Trạng thái health check, chính sách routing.
- Mẫu route API Gateway (`/health`, `/monitoring/{proxy+}`), không phải URL thật của từng tenant.
- Tên alarm và lịch sử ALARM 7 ngày (4 lần `mrapi-sg-api-5xx`).
- Tên dịch vụ, đường dẫn tài liệu trong repo.

**Không thấy:** dữ liệu tenant, user, key, email, account ID. Căn cứ là đọc code tạo response (chỉ từ CloudWatch GetMetricData, ListMetrics, DescribeAlarmHistory) và quét regex toàn bộ JSON đã lưu, 0 kết quả. Quét regex chỉ là kiểm tra phụ. Lưu ý: nếu `/proxy/{apiId}` từng có resource riêng theo tenant thì tên đó sẽ hiện ở endpoints; hiện chỉ là mẫu `{apiId}`.

**Rủi ro thật sự là chi phí và lạm dụng, không phải rò dữ liệu.** Mỗi lần cache miss, hàm gọi CloudWatch ở 2 Region và us-east-1. Cache 45 giây chỉ nằm trong từng container, nên request song song có thể gọi CloudWatch nhiều lần. Stage giữ giới hạn rate 10.000, burst 5.000, không có WAF (`webAclArn null`), không reserved concurrency. Số liệu vận hành công khai cũng giúp kẻ tấn công biết lúc hệ thống suy giảm. `backend-api.md` đã ghi cần xác thực trước khi công khai, và comment trong `src/monitoring/index.mjs` cũng vậy.

**Cách frontend gọi:** `HttpProvider` gọi `fetch` chỉ với `Accept: application/json`, không có Bearer hay `x-api-key`. Trang live chỉ gọi `https://app.multi-region.io.vn/monitoring/snapshot?range=6h`, trả 200, không cần đăng nhập. Authorizer hiện tại kiểm tra `x-api-key` theo scope `/proxy/{apiId}`, không dùng được nguyên trạng. Nếu gắn vào route monitoring thì frontend nhận 401 và dashboard hỏng, nên tôi **không đổi**.

**Quyết định về CloudFront:** không thêm, không gỡ, không sửa behavior. Behavior có sẵn được giữ vì dữ liệu chỉ là tổng hợp không nhạy cảm theo căn cứ trên, và gỡ sẽ làm hỏng R7. Đây là đánh giá của tôi, không phải chứng nhận an toàn; nhóm cần chốt xem dashboard có được phép công khai không.

**Đề xuất, xếp theo công sức:**
1. Giảm giới hạn riêng cho `GET /monitoring/*` ở stage (ví dụ rate 5, burst 10). Không đổi frontend, nên làm ngay ở cả 2 Region.
2. Nếu chốt dashboard là công khai: giữ route mở, thêm cache ngắn ở CloudFront (ví dụ 30 giây) cho `/monitoring/*`, ghi rõ quyết định vào báo cáo đồ án.
3. Nếu chốt phải đăng nhập: tạo authorizer token phiên portal riêng cho route, thêm header ở `HttpProvider`, chuyển trang tổng quan ra sau đăng nhập, chặn truy cập execute-api trực tiếp. Phải sửa code và test lại.

## 3. Frontend

Bucket `mrapi-web-sg` khớp hoàn toàn `monitoring-web/dist`: `index.html`, `assets/index-D5x6s6tr.js`, `assets/index-Ke9J9iFB.css` trùng kích thước và MD5 (ETag). Đã upload 28/10 02:01 UTC. Không cần upload lại. Hai asset cũ 25/10 còn trong bucket, vô hại. `infra/cloudfront/frontend-build-manifest.json` vẫn ghi bản 25/10, đã cũ.

`https://app.multi-region.io.vn` hiển thị:
- Nhãn **LIVE · BACKEND**, không phải NOT CONNECTED.
- Overview 6h: SG 11.044 request, lỗi 0,01%, p95 33 ms; Tokyo 11.126, lỗi 0,02%, p95 37 ms; cả hai Healthy.
- Sources: 6/7 nguồn Connected, X-Ray Not connected.
- Ảnh: [overview](../evidence/2026-11-01/monitoring/app-overview-live-backend.jpg), [sources](../evidence/2026-11-01/monitoring/app-sources.jpg).

**Đối chiếu CloudWatch** cùng khoảng 6 giờ: SG 11.055, Tokyo 11.128. Chênh 2 đến 11 request là hợp lý vì cửa sổ lệch vài phút và dashboard bỏ ô gần nhất. Chưa đối chiếu từng con số khác.

**Giới hạn cần nói rõ khi nghiệm thu R7:**
- Traffic gần như toàn bộ là health check Route 53. Trong 24h, `/health` chiếm hầu hết request; danh sách endpoint không có dòng `/proxy` nào. Số liệu thật nhưng không thể hiện tải người dùng.
- Replication hiển thị Unavailable. DynamoDB 7 ngày: SG→Tokyo không có điểm, Tokyo→SG một điểm 679 ms ngày 25/10. S3 không có metric ReplicationLatency nào ở SG. Tôi chưa xác định nguyên nhân; khả năng là ít lần ghi hoặc metric S3 chưa bật. Thẻ nguồn vẫn hiện Connected dù không có điểm dữ liệu, dễ gây hiểu nhầm.
- Dòng `/monitoring/{proxy+}` hiện Down ở trang API là do chính các request kiểm tra hôm nay (404 và 502).
- CloudFront chỉ có origin API Singapore. Khi SG sập, dashboard mất dữ liệu dù Tokyo được sửa. Chưa test.

## 4. X-Ray

Đã gửi 12 request `GET /demo/health` mỗi Region, đều 200. Requestid và trace id lưu ở [xray-health-requests.json](../evidence/2026-11-01/monitoring/xray-health-requests.json).

- Sampling rule `Default` (5%, reservoir 1) nên chỉ một phần được ghi: SG 4/12, Tokyo 7/12. Trace thiếu là do lấy mẫu, không phải lỗi.
- Trace SG `1-6ae69036-c0d8ce67f3ac6cd2d070d4bc`: `api_gateway.request_id` = `715ada51-473e-4c1a-8a2b-b502da020fcc`, **trùng** `x-amzn-requestid` đã ghi. Có segment `mrapi-api-sg/demo` và hai segment `mrapi-proxy`, http 200.
- Trace Tokyo `1-6ae6903b-2dec637b0c8c477b7a787e56`: `request_id` = `1a738808-87dd-44e2-96d2-6db8d30632ce`, **trùng** header. Segment `mrapi-api-tyo/demo` và `mrapi-proxy`, http 200.
- Stage tracing bật ở 2 Region, cả 8 hàm `Active`.

**Hạn chế:** Console CloudWatch không render được trong browser tích hợp ("Unable to load content", cả mục Overview, cả 2 Region), xem [ảnh lỗi](../evidence/2026-11-01/monitoring/xray-console-unable-to-load.jpg). Bằng chứng trace là dữ liệu `aws xray batch-get-traces`, [ảnh CloudShell](../evidence/2026-11-01/monitoring/xray-segments-cloudshell.jpg). **Chưa có ảnh trang Traces.** Người dùng cần tự chụp nếu báo cáo yêu cầu ảnh Console.

**NOT TESTED:** khớp trace với log và telemetry qua `/proxy` bằng API key thật.

## 5. Lambda

| Hàm | Handler | Arch | Role | Tracing | Hai Region |
|---|---|---|---|---|---|
| mrapi-proxy | `api/index.handler` | arm64 | mrapi-proxy-role | Active | Khớp |
| mrapi-authorizer | `authorizer/index.handler` | arm64 | mrapi-authorizer-role | Active | Khớp |
| mrapi-dashboard | `dashboard/index.handler` | arm64 | mrapi-dashboard-role | Active | Khớp |
| mrapi-monitoring | `monitoring/index.handler` | arm64 | mrapi-monitoring-role | Active | **Code khác** |

Runtime đều `nodejs24.x`.

`HEALTH_PORCE_FAIL` (sai chính tả): **có ở mrapi-proxy cả SG lẫn Tokyo**, giá trị rỗng, không có `HEALTH_FORCE_FAIL`. Bối cảnh chỉ nêu SG. Chỉ ghi lại, không sửa.

## 6. Parity

`node scripts/check-region-parity.mjs` không chạy được: `spawnSync aws ENOENT` vì máy không có AWS CLI. Script cũng không kiểm tra `mrapi-monitoring`, đúng hàm đang lệch.

Đã chạy logic tương đương trong CloudShell, thêm monitoring, so env bằng hash để không in giá trị:
- proxy, dashboard, authorizer: tất cả MATCH.
- monitoring: **CodeSha256 DIFFERENT**, các trường còn lại MATCH.

## Việc cần làm

**Người dùng hoặc nhóm quyết định:**
1. Chốt dashboard công khai hay phải đăng nhập (mục 2).
2. Cho phép triển khai code monitoring lên Tokyo. Tôi chưa làm vì ngoài phạm vi giao (chỉ được sửa env) và việc này mở thêm một đường dữ liệu chưa xác thực. Nên đặt throttle trước. Cách làm: dùng cùng ZIP của SG, hoặc đóng gói `src/` rồi Upload trên Console hàm `mrapi-monitoring` Tokyo; sau đó gọi lại 4 route và xác nhận CodeSha256 khớp.
3. Thêm throttle cho `/monitoring/*` (đề xuất 1).

**Người dùng tự làm:**
4. Chụp trang CloudWatch Traces cho 2 trace nêu trên bằng trình duyệt thường. Trace X-Ray lưu 30 ngày.
5. Gọi `/proxy` bằng API key thật để hoàn tất R9. Tôi không nhập key.

**Agent khác hoặc gom hồ sơ:**
6. Sửa `HEALTH_PORCE_FAIL` ở cả 2 Region (agent failover).
7. Cập nhật `infra/cloudfront/README.md`, `frontend-build-manifest.json`, `infra/DEPLOYED_STATE.md` theo thực tế. `deployment.ts` ghi monitoring chỉ có ở SG trong khi Tokyo cũng có hàm này.
8. Thêm `monitoring` vào danh sách hàm của `check-region-parity.mjs`.
