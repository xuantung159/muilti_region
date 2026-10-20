# Multi-Region Web — portal doanh nghiệp và giám sát

Dashboard giám sát cho dự án AWS Multi-Region Active-Active API Platform. Tài liệu này dành cho cả nhóm: cách chạy trên máy, cách nối dashboard với AWS thật, và cách đưa nó lên AWS.

**Trạng thái hiện tại:** portal doanh nghiệp và sáu trang giám sát chỉ dùng backend thật. Đã bỏ nút demo, tài khoản/key mẫu và bộ sinh số liệu khỏi ứng dụng. Dữ liệu kiểm thử nằm riêng trong `src/test/fixtures`, không được import bởi ứng dụng.

Tab **Hướng dẫn** giải thích cấu hình server doanh nghiệp bằng API ID/key và cách gọi gateway.

### Luồng doanh nghiệp trên web

Mở `/portal`, đăng ký/đăng nhập rồi đi theo bốn bước trên màn hình:

1. **Khai báo API**: đăng ký backend HTTPS công khai, bật API cần tích hợp.
2. **Lấy API key**: đặt tên ứng dụng, chọn các API được phép gọi, tạo key. Secret chỉ được trả một lần. Bấm **Dùng key này để tích hợp** để chuyển trực tiếp sang bước tiếp theo.
3. **Cấu hình & kiểm tra**: tab **Tích hợp project** nhận API/key vừa tạo. Nhập URL gateway bao gồm stage (hoặc cấu hình trước `VITE_GATEWAY_URL`). Sao chép `.env` có key hoặc tải `mrapi.env`, đặt vào project server và đổi tên thành `.env`. Có mã Node.js/Python để sao chép ngay trên web. Trình duyệt không tự ghi file vào project bên ngoài.
4. **Gửi GET tới gateway**: nhập đường dẫn của backend, ví dụ `/orders?limit=10`, xem trước URL rồi gửi. Màn hình hiển thị HTTP status, thời gian thực đo từ trình duyệt, response body, region/request ID nếu được CORS expose. Có lựa chọn thử thiếu key và nút hủy request. Sau đó bấm **Xem thống kê doanh nghiệp**. Thu hồi key trong tab API key và thử lại sẽ nhận lỗi nếu authorizer được cấu hình đúng.

Key tích hợp chỉ ở bộ nhớ của bước đang mở; rời bước/đăng xuất sẽ xóa. Nút xóa key cũng xóa secret đang dùng ở bước này. File/clipboard được xuất theo yêu cầu có chứa secret, nên chỉ dùng trên server và không commit. Không dùng biến public frontend để chứa key.

Tab tích hợp gọi gateway thật, không thay phản hồi lỗi bằng dữ liệu mẫu và không gửi Bearer token/cookie của portal đến gateway. GET không theo redirect, giới hạn 15 giây và chỉ hiển thị tối đa 64 KiB đầu của body. Project doanh nghiệp cần nạp `.env` và thực thi mã tích hợp trên server.

**Điều kiện kết nối thật:** triển khai proxy và authorizer cho `/proxy/{apiId}/...`; cấu hình preflight `OPTIONS` không yêu cầu key, `Access-Control-Allow-Origin` là origin của web, `Access-Control-Allow-Methods` gồm `GET, OPTIONS`, `Access-Control-Allow-Headers` gồm `x-api-key`. Phản hồi proxy và lỗi Gateway Responses đều cần CORS. Để đọc region/request ID, expose `X-Served-Region, X-Request-Id`. Nếu trình duyệt chặn CORS hoặc mạng lỗi, web báo không đọc được phản hồi và không suy đoán HTTP status. Portal CORS và proxy CORS là hai phần cấu hình riêng. Thống kê phụ thuộc telemetry backend và có thể cập nhật chậm; request bị authorizer từ chối có thể chưa được proxy ghi nhận.


## Mục lục

1. [Chạy trên máy](#1-chạy-trên-máy)
2. [Dashboard lấy dữ liệu thế nào](#2-dashboard-lấy-dữ-liệu-thế-nào)
3. [Lộ trình tích hợp](#3-lộ-trình-tích-hợp)
4. [Bước 1 — Thu thập thông tin tài nguyên](#bước-1--thu-thập-thông-tin-tài-nguyên)
5. [Bước 2 — Viết Lambda `monitoring`](#bước-2--viết-lambda-monitoring)
6. [Bước 3 — Cấp quyền IAM](#bước-3--cấp-quyền-iam)
7. [Bước 4 — Mở route trên API Gateway](#bước-4--mở-route-trên-api-gateway)
8. [Bước 5 — Nối dashboard với backend](#bước-5--nối-dashboard-với-backend)
9. [Bước 6 — Triển khai dashboard lên S3](#bước-6--triển-khai-dashboard-lên-s3)
10. [Checklist nghiệm thu](#checklist-nghiệm-thu)
11. [Lỗi thường gặp](#lỗi-thường-gặp)
12. [Tham chiếu](#tham-chiếu)

## 1. Chạy trên máy

Cần Node.js 20 trở lên (đã kiểm tra với Node 24, npm 11). Chạy các lệnh trong thư mục `monitoring-web/`.

```bash
npm install
```

```bash
npm run dev
```

Mở http://localhost:5173. Sidebar có Cổng doanh nghiệp và sáu trang giám sát. Mở http://localhost:5173/portal để đăng nhập, đăng ký, tạo/sửa/bật/tắt API đích, tạo/thu hồi key và xem thống kê doanh nghiệp.

### Nối portal với backend doanh nghiệp

Tạo `.env.local` từ `.env.example`. Khi phát triển, đặt `PORTAL_API_TARGET=https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/demo`, để trống `VITE_PORTAL_API_URL`, rồi khởi động lại Vite. Proxy dev chuyển `/api/*` tới stage tương ứng. Proxy chỉ chuyển request; vẫn cần API Gateway/Lambda thật.

Khi triển khai frontend tĩnh, đặt `VITE_PORTAL_API_URL` thành URL gốc API Gateway bao gồm stage trước khi build. Trên Lambda dashboard đặt `PORTAL_ALLOWED_ORIGIN` bằng origin của frontend (không có path/dấu `/` cuối), mở method `OPTIONS` qua Lambda hoặc cấu hình preflight tương đương ở API Gateway, rồi deploy stage. CORS cần có cả trên Gateway Responses cho lỗi do API Gateway trả. Nếu phục vụ frontend và `/api/*` qua cùng origin thì để trống URL này.

Lambda dashboard không còn chứa `page.html`. Đóng gói/upload lại `dashboard.zip`. Đặt `FRONTEND_URL` bằng URL gốc frontend để `GET /` của Lambda chuyển hướng tới `/portal`; nếu chưa đặt, nó trả thông tin JSON của service. Token phiên được giữ trong sessionStorage; logout/hết hạn xóa phiên phía giao diện và cache portal. Secret API key chỉ hiện sau khi tạo và bị ẩn khi đổi tab, trừ khi chủ động chuyển sang bước Tích hợp project.

Monitoring có nguồn dữ liệu/cấu hình độc lập với portal doanh nghiệp. Backend monitoring và phân quyền quản trị chưa triển khai.

Trước khi mở pull request, chạy:

```bash
npm test
```

```bash
npm run build
```

## 2. Dashboard lấy dữ liệu thế nào

```
Trình duyệt (dashboard)
      │  GET /monitoring/...   (không có AWS key nào ở đây)
      ▼
API Gateway  ──►  Lambda "monitoring"  (dùng IAM role)
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
  CloudWatch       CloudWatch        Route 53
  ap-southeast-1   ap-northeast-1    (health check)
```

Trình duyệt không được giữ thông tin xác thực AWS, nên dashboard không gọi AWS trực tiếp. Nó gọi một backend nhỏ; backend đọc CloudWatch ở cả hai Region và trả JSON theo đúng hợp đồng trong [docs/integration/backend-api.md](docs/integration/backend-api.md).

Dashboard chọn nguồn dữ liệu theo hai đầu vào:

| `VITE_MONITORING_API_URL` | Kết quả |
|---|---|
| Trống | Mọi metric hiện Not connected, trạng thái Unknown |
| Có URL | Gọi backend thật; lỗi không thay bằng dữ liệu mẫu |

Tích hợp xong không phải sửa trang nào của dashboard: chỉ cần backend trả đúng JSON.

## 3. Lộ trình tích hợp

Làm theo thứ tự. Mỗi bước có một người chịu trách nhiệm và một kết quả kiểm tra được.

| Bước | Việc | Người làm | Xong khi |
|---|---|---|---|
| 1 | Thu thập tên và ID tài nguyên ở hai Region | Mỗi người điền phần mình | Bảng ở Bước 1 không còn ô trống |
| 2 | Viết Lambda `monitoring` | L | `curl` bốn endpoint trả JSON đúng định dạng |
| 3 | Cấp quyền IAM cho Lambda đó | A, L review boundary | Lambda đọc được CloudWatch hai Region, không có quyền thừa |
| 4 | Mở route `/monitoring/*` và CORS | C | Gọi được từ trình duyệt ở `localhost:5173` |
| 5 | Nối dashboard, đối chiếu số liệu | C và L | Số trên dashboard khớp CloudWatch Console |
| 6 | Triển khai dashboard lên S3 | C triển khai frontend, A chuẩn bị bucket | Mở được bằng URL công khai |

Bước 2 nên làm tăng dần: trả `/monitoring/sources` trước, sau đó nối từng dịch vụ một. Dịch vụ nào chưa nối thì trả metric dạng "missing"; dashboard hiển thị được trạng thái dở dang này.

## Bước 1 — Thu thập thông tin tài nguyên

Điền bảng dưới đây (chép vào issue hoặc file cấu hình của nhóm). Lambda `monitoring` cần đủ các giá trị này.

| Thông tin | Singapore (`ap-southeast-1`) | Tokyo (`ap-northeast-1`) | Lấy ở đâu |
|---|---|---|---|
| Tên REST API | | | API Gateway → APIs → cột Name |
| Tên stage | | | API Gateway → Stages |
| Tên các hàm Lambda (api, authorizer, dashboard) | | | Lambda → Functions |
| Tên bảng control và telemetry (khi đã chốt/tạo) | | | DynamoDB → Tables |
| Health check ID | | | Route 53 → Health checks |
| Tên bucket và Rule ID replication | | | S3 → bucket → Management |

Theo mã nguồn trong `src/`, API của dự án là REST API (không phải HTTP API), nên tên metric dùng trong tài liệu này là của REST API.

## Bước 2 — Viết Lambda `monitoring`

Tạo một hàm Lambda riêng, chỉ cần triển khai ở **một** Region (đề xuất Singapore): từ đó nó tạo client CloudWatch cho cả hai Region.

| Cấu hình | Giá trị |
|---|---|
| Tên hàm | `<project>-monitoring` |
| Runtime | Node.js 22.x (đã có sẵn AWS SDK v3) |
| Timeout | 15 giây |
| Memory | 256 MB |

Biến môi trường:

| Biến | Ý nghĩa |
|---|---|
| `API_NAME`, `API_STAGE` | Tên REST API và stage (nếu hai Region đặt khác tên thì tách thành `API_NAME_SG`, `API_NAME_TYO`) |
| `FUNCTION_NAMES` | Danh sách tên hàm, cách nhau bằng dấu phẩy |
| `TABLE_NAMES` | Danh sách bảng Global Table |
| `HEALTH_CHECK_SG`, `HEALTH_CHECK_TYO` | Health check ID của từng Region |
| `ALLOWED_ORIGIN` | Origin của dashboard, dùng cho CORS |

Bốn endpoint phải có:

| Path | Trả về | Thứ tự làm |
|---|---|---|
| `GET /monitoring/sources` | Danh sách nguồn và trạng thái | 1 |
| `GET /monitoring/snapshot?range=1h\|6h\|24h\|7d` | Số liệu hai Region và chuỗi thời gian | 2 |
| `GET /monitoring/endpoints?range=…` | Số liệu từng endpoint | 3 |
| `GET /monitoring/incidents` | Sự cố và kết quả kiểm thử | 4 |

Định dạng JSON chính xác: [docs/integration/backend-api.md](docs/integration/backend-api.md). Kiểu TypeScript gốc: [src/domain/types.ts](src/domain/types.ts).

Khung mã để bắt đầu (đọc số liệu API Gateway của một Region cho cả khoảng xem):

```js
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";

const REGIONS = ["ap-southeast-1", "ap-northeast-1"];
const clients = Object.fromEntries(REGIONS.map((r) => [r, new CloudWatchClient({ region: r })]));
const RANGE_SECONDS = { "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800 };

// Có giá trị thì trả value, không có điểm dữ liệu thì nói rõ là thiếu. Không bao giờ trả 0 thay cho thiếu.
const metric = (v) => (v === undefined ? { kind: "missing", reason: "unavailable" } : { kind: "value", value: v });

async function apiGatewayTotals(region, range) {
  const seconds = RANGE_SECONDS[range];
  const end = new Date(Math.floor(Date.now() / 60000) * 60000);
  const start = new Date(end.getTime() - seconds * 1000);
  const dimensions = [
    { Name: "ApiName", Value: process.env.API_NAME },
    { Name: "Stage", Value: process.env.API_STAGE },
  ];
  const query = (id, name, stat) => ({
    Id: id,
    MetricStat: { Metric: { Namespace: "AWS/ApiGateway", MetricName: name, Dimensions: dimensions }, Period: seconds, Stat: stat },
  });

  const out = await clients[region].send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      MetricDataQueries: [
        query("count", "Count", "Sum"),
        query("e4", "4XXError", "Sum"),
        query("e5", "5XXError", "Sum"),
        query("avg", "Latency", "Average"),
        query("p95", "Latency", "p95"),
      ],
    }),
  );
  const first = (id) => out.MetricDataResults.find((r) => r.Id === id)?.Values?.[0];
  const count = first("count");
  const errors = (first("e4") ?? 0) + (first("e5") ?? 0);

  return {
    requests: metric(count),
    errorRatePct: metric(count ? (errors / count) * 100 : undefined),
    successRatePct: metric(count ? 100 - (errors / count) * 100 : undefined),
    latencyAvgMs: metric(first("avg")),
    latencyP95Ms: metric(first("p95")),
    apiGateway: { requests: metric(count), error4xx: metric(first("e4")), error5xx: metric(first("e5")) },
  };
}
```

Đây là điểm khởi đầu, chưa chạy thử trên AWS: hãy xác nhận tên metric và dimension trong CloudWatch Console của nhóm trước khi dựa vào nó. Cách lấy từng nhóm số liệu còn lại:

| Phần của snapshot | Hướng dẫn |
|---|---|
| Cách gọi `GetMetricData`, chọn `Period`, tính p95, cache | [cloudwatch.md](docs/integration/cloudwatch.md) |
| `requests`, lỗi, latency, bảng endpoint | [api-gateway.md](docs/integration/api-gateway.md) |
| `lambda.*` | [lambda.md](docs/integration/lambda.md) |
| `dynamodbReplicationLatencyMs` | [dynamodb-global-tables.md](docs/integration/dynamodb-global-tables.md) |
| `healthCheck`, `routingPolicy`, sự kiện failover | [route53.md](docs/integration/route53.md) |
| `s3ReplicationLatencyS` | [s3-replication.md](docs/integration/s3-replication.md) |

Ba quy tắc bắt buộc khi viết backend:

- Thiếu dữ liệu thì trả `{ "kind": "missing", "reason": ... }`, không trả `0`.
- `regions` luôn có đủ hai Region, kể cả khi một Region chưa có số liệu.
- Sự kiện trong `/monitoring/incidents` chỉ dùng `origin` là `aws` hoặc `manual_test`. Giá trị `simulated` chỉ dành cho dữ liệu mẫu.

## Bước 3 — Cấp quyền IAM

Tạo execution role riêng cho Lambda `monitoring` với inline policy sau, cộng thêm policy ghi log mặc định của Lambda (`AWSLambdaBasicExecutionRole`).

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadMetrics",
      "Effect": "Allow",
      "Action": ["cloudwatch:GetMetricData", "cloudwatch:DescribeAlarms", "cloudwatch:DescribeAlarmHistory"],
      "Resource": "*"
    },
    {
      "Sid": "ReadHealthChecks",
      "Effect": "Allow",
      "Action": ["route53:GetHealthCheckStatus", "route53:ListHealthChecks"],
      "Resource": "*"
    }
  ]
}
```

Các action này không hỗ trợ giới hạn theo resource nên phải dùng `"Resource": "*"`; chúng đều là quyền chỉ đọc. Role này **không** cần quyền DynamoDB, S3 hay quyền ghi nào.

## Bước 4 — Mở route trên API Gateway

Trên REST API ở Region đặt Lambda `monitoring`:

1. Tạo resource `/monitoring` và resource con `{proxy+}`.
2. Thêm method `GET` kiểu Lambda proxy integration, trỏ tới hàm `monitoring`.
3. Bật CORS cho resource, cho phép origin của dashboard: `http://localhost:5173` khi phát triển và URL S3 sau khi triển khai.
4. Deploy API lên stage.

Với proxy integration, Lambda phải tự trả header CORS trong mọi response, kể cả response lỗi:

```js
headers: {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": process.env.ALLOWED_ORIGIN,
}
```

Kiểm tra bằng dòng lệnh trước khi mở dashboard:

```bash
curl -i "https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/<stage>/monitoring/sources"
```

Kết quả mong đợi: HTTP 200, body là một mảng JSON, có header `Access-Control-Allow-Origin`.

**Về bảo mật:** route này lộ số liệu vận hành. Dashboard hiện chưa gửi header xác thực, nên nếu để route công khai thì ai có URL cũng đọc được. Với đồ án có thể chấp nhận trong lúc demo; nếu cần chặn, thêm kiểm tra token ở Lambda và bổ sung header trong `HttpProvider` ([src/data/providers.ts](src/data/providers.ts)).

## Bước 5 — Nối dashboard với backend

1. Tạo file `monitoring-web/.env.local` (file này đã nằm trong `.gitignore`):

   ```
   VITE_DEFAULT_DATA_MODE=live
   VITE_MONITORING_API_URL=https://<api-id>.execute-api.ap-southeast-1.amazonaws.com/<stage>
   ```

2. Dừng rồi chạy lại `npm run dev` (Vite chỉ đọc file env lúc khởi động).
3. Mở trang Settings để xác nhận URL backend. Không còn chế độ demo; cấu hình demo cũ trong trình duyệt bị bỏ qua.
4. Header phải đổi từ `DEMO DATA` sang `LIVE · BACKEND`.
5. Mở trang Data Sources: nguồn nào đã nối phải hiện `Connected`.

Không đặt AWS access key, secret key hay token vào `.env.local`: mọi biến `VITE_*` đều bị nhúng vào JavaScript công khai khi build.

Đối chiếu số liệu trước khi tin dashboard:

1. Chọn khoảng thời gian 1 giờ trên dashboard.
2. Mở CloudWatch Console → Metrics → API Gateway, cùng Region, cùng khoảng 1 giờ, statistic `Sum`.
3. So `Count` với ô "Request" của Region đó. Lệch vài request do thời điểm lấy là bình thường; lệch nhiều thì sai dimension hoặc sai `Period`.
4. Lặp lại cho Region còn lại và cho latency p95.

## Bước 6 — Triển khai dashboard lên S3

Dashboard là trang tĩnh, đặt lên một bucket S3 bật static website hosting. Chi phí không đáng kể ở quy mô đồ án (vài MB lưu trữ và lượng truy cập nhỏ).

1. Build với URL backend thật. Giá trị trong `.env.local` được nhúng vào bản build tại thời điểm này:

   ```bash
   npm run build
   ```

   Kết quả nằm trong `dist/`.

2. S3 → Create bucket: Region `ap-southeast-1`, tên duy nhất toàn cầu (ví dụ `<project>-monitoring-web`), bỏ chọn "Block all public access" cho riêng bucket này.
3. Tab Properties → Static website hosting → Enable. Index document: `index.html`. Error document: `index.html` (để các đường dẫn như `/regions` vẫn mở được khi tải lại trang).
4. Tab Permissions → Bucket policy:

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::<ten-bucket>/*"
       }
     ]
   }
   ```

5. Tải toàn bộ **nội dung bên trong** `dist/` lên gốc bucket (không tải cả thư mục `dist`).
6. Mở "Bucket website endpoint" ở cuối tab Properties.
7. Thêm URL đó vào `ALLOWED_ORIGIN` của Lambda `monitoring` và cấu hình CORS ở Bước 4, rồi deploy lại API.

Cần biết trước:

- Website endpoint của S3 chỉ phục vụ HTTP, không có HTTPS. Muốn HTTPS và tên miền riêng phải đặt CloudFront phía trước, nằm ngoài danh sách dịch vụ của đề bài.
- Bucket này công khai theo thiết kế. Chỉ chứa file build của dashboard; không tải lên file `.env`, mã nguồn hay bất kỳ dữ liệu nào khác.
- Mỗi lần đổi URL backend phải build và tải lên lại.
- Tải lại trang ở đường dẫn con sẽ trả mã 404 kèm nội dung `index.html`; trang vẫn hiển thị đúng.

Dọn dẹp khi kết thúc đồ án: xóa hết object trong bucket rồi xóa bucket, xóa Lambda `monitoring` và resource `/monitoring` trên API Gateway.

## Checklist nghiệm thu

Người kiểm tra không phải là người làm bước đó.

| # | Kiểm tra | Cách làm | Kết quả mong đợi |
|---|---|---|---|
| 1 | Backend trả đúng định dạng | `curl` bốn endpoint | HTTP 200, JSON khớp `backend-api.md` |
| 2 | Không có quyền thừa | Đọc policy của role | Chỉ có các action ở Bước 3 |
| 3 | Số request khớp | Đối chiếu như Bước 5 | Lệch không đáng kể ở cả hai Region |
| 4 | Số liệu phản ánh đúng Region | Gửi 10 request vào Tokyo, chờ 3 phút | Chỉ Tokyo tăng 10 |
| 5 | Health check phản ánh thật | Bật `HEALTH_FORCE_FAIL=true` cho hàm api ở một Region | Region đó chuyển `Down` sau khi Route 53 Console báo unhealthy |
| 6 | Không còn dữ liệu mẫu | Mở cả sáu trang ở chế độ live | Không còn nhãn DEMO DATA hay Simulated |
| 7 | Thiếu dữ liệu hiển thị đúng | Xem metric chưa tích hợp | Hiện "Not connected" hoặc "Not configured", không hiện 0 |
| 8 | Backend lỗi hiển thị đúng | Tạm đổi URL backend thành sai | Trang hiện "Không tải được dữ liệu", không hiện số cũ |
| 9 | Bản triển khai chạy được | Mở URL S3, tải lại ở `/regions` | Trang hiển thị, gọi được backend |

Nhớ tắt `HEALTH_FORCE_FAIL` sau kiểm tra số 5.

## Lỗi thường gặp

| Hiện tượng | Nguyên nhân thường gặp | Cách xử lý |
|---|---|---|
| Header là `NOT CONNECTED` | `VITE_MONITORING_API_URL` trống, hoặc chưa chạy lại dev server | Kiểm tra `.env.local`, chạy lại `npm run dev` |
| "Không tải được dữ liệu", console báo CORS | Lambda không trả `Access-Control-Allow-Origin`, hoặc sai origin | Sửa header ở Lambda, kiểm tra `ALLOWED_ORIGIN` |
| "Backend trả HTTP 403" | Chưa deploy API sau khi thêm route, hoặc sai stage trong URL | Deploy lại, kiểm tra URL bằng `curl` |
| "Backend trả HTTP 502" | Lambda ném lỗi hoặc trả sai cấu trúc proxy | Xem CloudWatch Logs của hàm `monitoring` |
| "Backend trả dữ liệu sai định dạng" | Thiếu `regions` hoặc `series` trong snapshot | So với ví dụ trong `backend-api.md` |
| Mọi metric là "Unavailable" | Sai tên API, stage hoặc dimension; hoặc chưa có traffic | Mở metric trong CloudWatch Console, chép đúng dimension |
| Số Tokyo luôn trống | Dùng client CloudWatch của Singapore cho cả hai Region | Tạo client riêng với `region: "ap-northeast-1"` |
| Trang S3 trắng ở đường dẫn con | Chưa đặt Error document là `index.html` | Sửa ở Static website hosting |
| Trang S3 trả 403 | Thiếu bucket policy hoặc còn bật Block Public Access | Làm lại mục 2 và 4 của Bước 6 |

## Tham chiếu

### Lệnh

| Lệnh | Tác dụng |
|---|---|
| `npm run dev` | Dev server ở cổng 5173 |
| `npm test` | Chạy test (Vitest + React Testing Library) |
| `npm run typecheck` | Kiểm tra kiểu TypeScript |
| `npm run build` | Kiểm tra kiểu rồi build ra `dist/` |
| `npm run preview` | Chạy thử bản build |

### Các trang

| Đường dẫn | Trang | Endpoint backend dùng |
|---|---|---|
| `/portal` | Cổng doanh nghiệp | `/api/me`, `/api/signup`, `/api/login`, `/api/logout`, `/api/apis`, `/api/keys`, `/api/usage`, `/api/status` |
| `/` | System Overview | `/monitoring/snapshot` |
| `/regions` | Multi-Region | `/monitoring/snapshot` |
| `/apis` | API Monitoring | `/monitoring/endpoints` |
| `/incidents` | Failover & Incidents | `/monitoring/incidents` |
| `/sources` | Data Sources | `/monitoring/sources` |
| `/settings` | Settings | không gọi backend |

### Cấu trúc mã nguồn

```
src/
  domain/        Kiểu dữ liệu, quy tắc suy ra trạng thái, định dạng. Không phụ thuộc React hay AWS.
  data/
    provider.ts  Interface MonitoringProvider: hợp đồng giữa giao diện và nguồn dữ liệu
    providers.ts MockProvider, NotConnectedProvider, HttpProvider, createProvider()
    sources.ts   Danh mục nguồn AWS dự kiến tích hợp
  app/           Settings (localStorage) và các hook truy vấn (TanStack Query)
  components/    Layout, biểu đồ, thành phần giao diện dùng chung
  pages/         Sáu trang
docs/integration/  Hướng dẫn tích hợp theo từng dịch vụ AWS
```

Ngưỡng đánh giá trạng thái (Healthy, Degraded, Down) nằm ở [src/domain/status.ts](src/domain/status.ts). Đây là ngưỡng của dự án, không phải cam kết của AWS.

### Quy tắc hiển thị dữ liệu

- Một Region chỉ là `Healthy` khi có cả health check lẫn error rate. Thiếu một trong hai là `Unknown`.
- Metric thiếu nguồn hiện lý do thiếu, không hiện 0.
- Sự kiện `Simulated` không phải bằng chứng Route 53 đã failover. Thời gian chuyển hướng thực tế phải do nhóm đo và ghi dưới nhãn `Manual test`.

### Giới hạn hiện tại

- Chưa có Lambda `monitoring`; `HttpProvider` mới được kiểm thử bằng fetch giả lập, chưa gọi backend thật.
- Dashboard chưa gửi header xác thực tới backend.
- Chưa có form nhập kết quả kiểm thử failover thủ công; kết quả loại `Manual test` phải đến từ backend.
- Chưa có test trình duyệt tự động (Playwright).



### Thống kê portal trống dù client gọi thành công

`/api/usage` tổng hợp các request từ `mrapi-telemetry` theo tenant, region, key và khoảng thời gian; giao diện tự làm mới 15 giây. Lỗi là HTTP từ 400 trở lên. Không đọc bộ đếm `USAGE#` cũ trong bảng control. Xem [hướng dẫn triển khai bản sửa](../docs/runbooks/PORTAL_TELEMETRY_FIX.md). Thay code local không tự cập nhật Lambda đang chạy trên AWS.
