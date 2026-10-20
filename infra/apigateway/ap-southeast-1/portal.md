# Portal API — Singapore

Đối chiếu AWS Console ngày 17/10/2026 (Asia/Saigon), từ Configuration → Triggers của Lambda `mrapi-dashboard`.

- REST API: `mrapi-api-sg`, ID `43vakggyh5`.
- Stage: `demo`.
- Base URL: `https://43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo`.
- Hai trigger quan sát: `GET /` và mọi method `/api/*`, cùng trỏ tới Lambda dashboard.
- Đã điền ID/baseUrl trong `config/demo/ap-southeast-1.json`.
- Frontend dev dùng `PORTAL_API_TARGET` trong `monitoring-web/.env.local` (không commit); Vite proxy `/api/*` tới stage `demo`.

## Kiểm tra kết nối

`GET http://127.0.0.1:5174/api/me` đi qua Vite → API Gateway → Lambda, trả HTTP 401 và JSON:

```json
{"region":"ap-southeast-1","error":"Phiên đăng nhập không hợp lệ hoặc đã hết hạn"}
```

Đúng với request không có Bearer token. Đã xác nhận kết nối từ web local tới Lambda; chưa đăng ký tài khoản thử, chưa xác minh DynamoDB hoặc luồng đăng nhập có tài khoản thật.

Không thay cấu hình tài nguyên AWS trong lượt tích hợp này. Gói Lambda mới cho frontend dùng chung vẫn cần upload nếu muốn root API chuyển hướng; API tài khoản hiện có dùng được qua proxy local. Chưa kiểm tra CORS cho frontend deploy khác origin. Monitoring backend chưa triển khai, không dùng URL portal làm `VITE_MONITORING_API_URL`.
