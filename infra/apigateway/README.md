# API Gateway

## Chức năng

Tiếp nhận HTTP request, chọn route và chuyển tới Lambda; áp dụng xác thực và giới hạn tốc độ.

## Ứng dụng trong project

Làm cửa vào cho portal, proxy, health và monitoring. Route proxy dùng authorizer kiểm tra API key; portal tự kiểm tra phiên đăng nhập trong Lambda.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `<region>/api.json` | Thông tin REST API: ID, tên, endpoint, TLS policy. Dùng nhận diện đúng API và so cấu hình hai Region. |
| `<region>/routes.json` | Resource, HTTP method, kiểu xác thực và integration URI. Dùng kiểm tra request được chuyển tới Lambda nào. |
| `<region>/authorizers.json` | Lambda authorizer, nguồn x-api-key và cache TTL. Dùng kiểm tra cách xác thực key. |
| `<region>/stages.json` | Stage demo, deployment, throttle, access log, metrics và tracing. Dùng kiểm tra cấu hình vận hành. |
| `<region>/account.json` | Thiết lập API Gateway cấp account/Region, gồm role ghi CloudWatch. Không phải tài khoản doanh nghiệp của portal. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Hai REST API Regional có cùng route và xác thực.

| Mục | Singapore | Tokyo |
|---|---|---|
| API | `mrapi-api-sg`, `43vakggyh5` | `mrapi-api-tyo`, `n39r5pits8` |
| Stage / deployment | `demo`, `r6bin4` | `demo`, `fm5wpo` |
| Authorizer | `mrapi-request-authorizer`, `gq9zp9` | `mrapi-request-authorizer`, `n7sdca` |
| X-Ray | Bật | Bật |
| Access log | `/mrapi/apigateway/sg/demo` | `/mrapi/apigateway/tyo/demo` |
| REST API securityPolicy | `SecurityPolicy_TLS13_1_2_2021_06` | `TLS_1_0` |
| Endpoint access mode | `STRICT` | Không có trường trả về |
| Execute-api endpoint | Bật | Bật |

Policy REST API khác policy của custom domain. Custom domain `api.multi-region.io.vn` map gốc tới stage demo; cấu hình domain ở [Route 53](../route53/multi-region.io.vn.md).

## Route

| Route | Xác thực | Lambda |
|---|---|---|
| GET `/` | Không | `mrapi-dashboard` |
| ANY `/api/{proxy+}` | Lambda tự kiểm tra Bearer | `mrapi-dashboard` |
| GET `/health` | Không | `mrapi-proxy` |
| GET `/monitoring/{proxy+}` | Không, chỉ trả số liệu tổng hợp | `mrapi-monitoring` |
| ANY `/proxy/{apiId}` | REQUEST authorizer | `mrapi-proxy` |
| ANY `/proxy/{apiId}/{proxy+}` | REQUEST authorizer | `mrapi-proxy` |

Authorizer đọc x-api-key, cache TTL 0. Root API trả JSON portal-api; giao diện ở [CloudFront](https://app.multi-region.io.vn).

## Throttle

| Method setting | Rate | Burst | Log | Metrics |
|---|---|---|---|---|
| `*/*` | 10000 | 5000 | INFO | Bật |
| `~1monitoring~1{proxy+}/GET` | 5 | 10 | INFO | Bật |

Throttle monitoring chưa được kiểm chứng đầy đủ. Quota Lambda 10 concurrent executions mỗi Region có thể gây lỗi integration trước khi tới giới hạn API Gateway.

## File cấu hình

Mỗi thư mục Region có `api.json`, `stages.json`, `authorizers.json`, `routes.json`, `account.json`. Routes chứa authorization và integration URI; account có role ghi CloudWatch.
