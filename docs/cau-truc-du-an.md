# Cấu trúc dự án

## Thư mục

```text
aws/
├── src/              code Lambda (Node.js)
│   ├── api/          proxy và /health
│   ├── authorizer/   kiểm tra API key
│   ├── dashboard/    API của portal: tài khoản, API đích, key, thống kê
│   ├── monitoring/   gom số liệu hai region cho trang giám sát
│   ├── exporter/     export telemetry sang S3 mỗi ngày
│   └── shared/       code dùng chung
├── monitoring-web/   giao diện React: portal + 6 trang giám sát
├── config/demo/      tên, ID, URL tài nguyên từng region
├── infra/            cấu hình đọc lại từ Console, theo từng dịch vụ
├── scripts/          đóng gói Lambda, so cấu hình hai region
├── tests/            e2e, bảo mật, replication, failover
├── docs/             thiết kế, runbook, báo cáo, bằng chứng
└── artifacts/        file ZIP sinh ra, không commit
```

## Đường đi của request

Người dùng mở web:

```text
Trình duyệt → app.multi-region.io.vn (CloudFront)
  ├─ trang web  → S3 mrapi-web-sg
  └─ /api/*, /monitoring/*, /health → api.multi-region.io.vn
```

Ứng dụng của doanh nghiệp gọi API:

```text
api.multi-region.io.vn (Route 53, chọn region gần nhất và còn khỏe)
  → API Gateway của region đó
  → authorizer kiểm tra key
  → proxy chuyển tới backend doanh nghiệp, ghi telemetry
```

Dữ liệu trong DynamoDB tự đồng bộ giữa hai region. File export trên S3 tự chép từ Singapore sang Tokyo.

## Route trên API Gateway

| Route | Lambda | Xác thực |
|---|---|---|
| GET / và ANY /api/{proxy+} | dashboard | Lambda tự kiểm tra token đăng nhập |
| GET /health | proxy | Không |
| ANY /proxy/{apiId}/{proxy+} | proxy | Authorizer, header `x-api-key` |
| GET /monitoring/{proxy+} | monitoring | Không |

`/api/...` là API của portal. `/proxy/...` mới là đường chuyển tiếp tới backend doanh nghiệp, đừng nhầm hai cái.

## Hai loại "chìa khóa"

| Giá trị | Ai dùng | Header |
|---|---|---|
| Token đăng nhập | Người dùng portal | `Authorization: Bearer ...` |
| API key `mrk_...` | Server của doanh nghiệp | `x-api-key` |

Còn Lambda truy cập DynamoDB, log... bằng IAM role, không dùng key nào cả.

## Chạy và kiểm thử

Backend:

```bash
npm ci --prefix src
```

```bash
npm test --prefix src
```

```bash
npm run package --prefix src
```

Lệnh cuối tạo ZIP trong `artifacts/lambda/`. Handler của dashboard là `dashboard/index.handler`, không phải `index.handler`.

Frontend:

```bash
npm ci --prefix monitoring-web
```

```bash
npm run dev --prefix monitoring-web
```

Chạy local cần file `monitoring-web/.env.local`, xem [README frontend](../monitoring-web/README.md).

E2E chạy trên AWS thật, có tạo dữ liệu thử:

```bash
npm run test:e2e --prefix src
```

```bash
npm run test:e2e:proxy --prefix src
```

## `config/` và `infra/`

`config/demo/` ghi tên và URL để các phần nối với nhau và để script e2e đọc. Lambda không đọc file này; sửa nó không làm thay đổi AWS.

`infra/` không phải Terraform. Đây là cấu hình nhóm đọc lại từ Console sau mỗi lần làm, để người khác dựng lại được. [DEPLOYED_STATE.md](../infra/DEPLOYED_STATE.md) là bản tổng hợp.

Vài khái niệm IAM hay lẫn:

- Trust policy: dịch vụ nào được dùng role.
- Permission policy: role được làm gì.
- Boundary: trần quyền, không tự cấp thêm quyền.
- Resource policy của Lambda: API Gateway có được gọi hàm hay không.

## Tài liệu nên đọc

1. [thiet-ke-gateway.md](thiet-ke-gateway.md): thiết kế và mã lỗi.
2. [phan-cong.md](phan-cong.md): ai làm gì.
3. [runbooks/](runbooks/): các bước làm trên Console.
