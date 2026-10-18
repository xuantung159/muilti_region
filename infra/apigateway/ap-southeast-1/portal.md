# API Gateway `mrapi-api-sg` — `ap-southeast-1`

- Người đối chiếu Console: IAM user `thenhan`
- Ngày đối chiếu: 2026-10-18 (Asia/Ho_Chi_Minh)
- Trạng thái: **Đã triển khai; smoke test `/health` đạt. Tích hợp metrics hai Region chưa hoàn tất.**
- API ID/type: `43vakggyh5` / REST API
- Stage: `demo`
- Invoke URL: `https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo`
- Active deployment: `ej0xd0`, Console hiển thị 2026-10-18 11:09 (UTC+07:00)
- Config: [`config/demo/ap-southeast-1.json`](../../../config/demo/ap-southeast-1.json)
- Contract metrics: [`monitoring-web/docs/integration/api-gateway.md`](../../../monitoring-web/docs/integration/api-gateway.md)

## Cấu hình stage đã xác minh

| Thuộc tính | Giá trị trong Console |
|---|---|
| Detailed metrics | Active |
| Logging level | Inactive |
| Data tracing | Inactive |
| X-Ray tracing | Inactive |
| Access logging | Inactive |
| Cache cluster | Inactive |
| Throttle rate / burst | 10000 / 5000 |

Detailed metrics đã bật cho stage theo yêu cầu của phần endpoint metrics. AWS tính phí metric bổ sung; chưa có truy vấn endpoint-level nào được ghi nhận ở đây.

## Routes và integration đã xác minh

| Method | Resource | Integration | Authorization tại API Gateway | API Gateway API key required |
|---|---|---|---|---|
| `GET` | `/` | Lambda proxy → `mrapi-dashboard` | `NONE` | No |
| `ANY` | `/api/{proxy+}` | Lambda proxy → `mrapi-dashboard` | `NONE`; portal tự kiểm tra Bearer session | No |
| `GET` | `/health` | Lambda proxy → `mrapi-proxy` | `NONE` | No |
| `ANY` | `/proxy/{apiId}` | Lambda proxy → `mrapi-proxy` | `mrapi-request-authorizer` | No |
| `ANY` | `/proxy/{apiId}/{proxy+}` | Lambda proxy → `mrapi-proxy` | `mrapi-request-authorizer` | No |

`mrapi-request-authorizer` nhận identity source từ header `x-api-key`; authorization caching đang tắt. Vì vậy, `API key required = No` trong method settings không đồng nghĩa proxy route không xác thực: key của ứng dụng được xác thực bởi Lambda authorizer, không phải API Gateway usage-plan key.

## Kiểm thử và bằng chứng

- `GET /health`: mở endpoint qua browser và gửi tổng cộng 10 request (1 lần mở trang + 9 lần reload). Cả 10 response đều có body `{"region":"ap-southeast-1","status":"ok"}`.
- Proxy: output PowerShell do người dùng cung cấp ngày 2026-10-18 cho `GET /proxy/{apiId}/anything?test=1` ghi nhận HTTP `200`, `X-Mrapi-Source: upstream`, upstream `https://httpbin.org/anything?test=1`. Không lưu API key.
- Lệnh `curl.exe` trong môi trường kiểm tra hiện tại không phân giải được hostname API (`Could not resolve host`); đây là lỗi DNS của môi trường shell đó. Browser vẫn tải được response `/health`; không kết luận endpoint AWS bị lỗi từ lỗi DNS của shell.
- Bằng chứng kiểm tra: [`docs/evidence/apigateway/singapore-smoke-2026-10-18.md`](../../../docs/evidence/apigateway/singapore-smoke-2026-10-18.md).

## Còn thiếu / chưa kiểm thử

- AWS Console tại `ap-northeast-1` hiện báo **No API**. API ID và base URL trong `config/demo/ap-northeast-1.json` vẫn để trống; cần API Gateway và integration backend tại Tokyo trước khi kiểm thử so sánh hai Region.
- Chưa xác nhận metric/dimension thực tế trong CloudWatch Console; không viết truy vấn từ giả định. Tài liệu tích hợp nêu điều kiện cần kiểm tra trước khi backend metrics sử dụng.
- Chưa kiểm thử `requests` tăng đúng 10 trên dashboard và Region kia không đổi: chưa có API tại Tokyo và chưa đối chiếu được dashboard với CloudWatch.
- Chưa lưu ảnh Console. Các giá trị stage/routes ở trên được đọc trực tiếp từ Console trong phiên đối chiếu ngày 2026-10-18; cần bổ sung ảnh đã che thông tin nhạy cảm nếu nhóm yêu cầu bằng chứng hình ảnh.
