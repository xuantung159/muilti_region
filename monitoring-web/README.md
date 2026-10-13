# Monitoring Web — dashboard giám sát Multi-Region

Dashboard giám sát cho dự án AWS Multi-Region Active-Active API Platform. Giai đoạn này chạy độc lập trên máy local bằng **dữ liệu mẫu sinh trong trình duyệt**; chưa có kết nối AWS nào. Mọi số liệu mẫu đều được gắn nhãn `DEMO DATA` / `MOCK DATA` trên giao diện.

## Chạy

Cần Node.js 20 trở lên (đã kiểm tra với Node 24, npm 11).

```bash
npm install
```

```bash
npm run dev
```

Mở http://localhost:5173.

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Chạy dev server ở cổng 5173 |
| `npm test` | Chạy toàn bộ test (Vitest + React Testing Library) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run build` | Kiểm tra kiểu rồi build ra `dist/` |
| `npm run preview` | Chạy thử bản build |

## Các trang

| Đường dẫn | Trang | Nội dung |
|---|---|---|
| `/` | System Overview | Trạng thái hai Region, KPI, biểu đồ request và lỗi, replication, định tuyến |
| `/regions` | Multi-Region | Bảng so sánh Singapore và Tokyo, hoặc xem riêng từng Region |
| `/apis` | API Monitoring | Bảng endpoint, tìm kiếm, lọc theo Region, method, trạng thái, khoảng thời gian |
| `/incidents` | Failover & Incidents | Sự cố, chuyển hướng traffic, kiểm thử failover; phân biệt Simulated / Manual test / AWS |
| `/sources` | Data Sources | Tình trạng tích hợp của từng dịch vụ AWS |
| `/settings` | Settings | Khoảng thời gian, Region mặc định, chu kỳ refresh, chế độ demo, giao diện sáng/tối |

## Kiến trúc

```
src/
  domain/        Kiểu dữ liệu, quy tắc suy ra trạng thái, định dạng. Không phụ thuộc React hay AWS.
  data/
    provider.ts  Interface MonitoringProvider — hợp đồng duy nhất giữa giao diện và nguồn dữ liệu
    providers.ts MockProvider, NotConnectedProvider, HttpProvider, createProvider()
    mock/        Bộ sinh dữ liệu mẫu
    sources.ts   Danh mục nguồn AWS dự kiến tích hợp
  app/           Settings (localStorage) và các hook truy vấn (TanStack Query)
  components/    Layout, biểu đồ, thành phần giao diện dùng chung
  pages/         Sáu trang
```

Giao diện chỉ gọi `MonitoringProvider`. Chọn provider theo hai đầu vào:

| Chế độ demo (Settings) | `VITE_MONITORING_API_URL` | Provider | Giao diện hiển thị |
|---|---|---|---|
| Bật | bất kỳ | `MockProvider` | Dữ liệu mẫu, nhãn DEMO DATA |
| Tắt | trống | `NotConnectedProvider` | Mọi metric là "Not connected", trạng thái "Unknown" |
| Tắt | có URL | `HttpProvider` | Dữ liệu từ backend; lỗi thì hiện trạng thái lỗi, không rơi về dữ liệu mẫu |

Để nối AWS thật, chỉ cần dựng backend trả đúng JSON trong [docs/integration/backend-api.md](docs/integration/backend-api.md) rồi đặt URL; không phải sửa trang nào.

## Nguyên tắc về tính trung thực của dữ liệu

- Mỗi metric có kiểu `Metric`: hoặc có giá trị, hoặc ghi rõ lý do thiếu (`Not connected`, `Unavailable`, `Not configured`). Không có giá trị mặc định là 0.
- Một Region chỉ được coi là `Healthy` khi có cả health check lẫn error rate. Thiếu một trong hai là `Unknown`.
- Sự kiện trên trang Incidents luôn mang nhãn nguồn gốc. Sự kiện `Simulated` không phải bằng chứng Route 53 đã failover.
- Ở chế độ demo, mọi nguồn AWS trên trang Data Sources đều là `Not connected`.
- Endpoint trong dữ liệu mẫu (`/health`, `/tenants`, `/orders`, `/usage`) là minh họa cho đến khi API thật được xác nhận.

## Cấu hình

Sao chép `.env.example` thành `.env.local`:

| Biến | Ý nghĩa | Mặc định |
|---|---|---|
| `VITE_DEFAULT_DATA_MODE` | `mock` hoặc `live`, áp dụng khi người dùng chưa chỉnh trong Settings | `mock` |
| `VITE_MONITORING_API_URL` | URL gốc của backend giám sát | trống |

Biến `VITE_*` được nhúng vào JavaScript công khai khi build. **Không đặt AWS access key, secret key hay token vào đây.** Trình duyệt chỉ gọi backend; backend dùng IAM role để đọc AWS.

## Tài liệu tích hợp

| Tài liệu | Nội dung |
|---|---|
| [backend-api.md](docs/integration/backend-api.md) | Hợp đồng JSON giữa dashboard và backend, các bước chuyển từ mock sang thật |
| [cloudwatch.md](docs/integration/cloudwatch.md) | Cách backend đọc metric bằng GetMetricData |
| [api-gateway.md](docs/integration/api-gateway.md) | Metric request, 4xx, 5xx, latency |
| [lambda.md](docs/integration/lambda.md) | Metric invocation, error, duration |
| [dynamodb-global-tables.md](docs/integration/dynamodb-global-tables.md) | Replication latency |
| [route53.md](docs/integration/route53.md) | Health check, định tuyến, bằng chứng failover |
| [s3-replication.md](docs/integration/s3-replication.md) | Replication metrics của S3 |

## Giới hạn hiện tại

- Chưa có backend và chưa có số liệu AWS nào. `HttpProvider` mới được kiểm thử bằng fetch giả lập.
- Chưa có form nhập kết quả kiểm thử failover thủ công; kết quả loại `Manual test` sẽ đến từ backend.
- Số p95 trong dữ liệu mẫu là ước lượng theo công thức. Khi tích hợp thật, backend phải lấy p95 trực tiếp từ CloudWatch.
- Chưa có test trình duyệt tự động (Playwright); giao diện đã được kiểm tra thủ công ở kích thước desktop và mobile, giao diện sáng và tối.
- Dùng `BrowserRouter`: khi đặt lên static hosting cần cấu hình trả `index.html` cho mọi đường dẫn.
