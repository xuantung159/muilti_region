# multi-region.io.vn

## Chức năng

Cấu hình DNS của domain dự án và liên kết domain với các dịch vụ AWS.

## Ứng dụng trong project

app trỏ CloudFront; api dùng hai Alias Latency tới API Gateway. CNAME xác thực ACM và health check hỗ trợ HTTPS, định tuyến và failover.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `multi-region.io.vn.records.json` | Các record DNS của project, không bao gồm toàn bộ record ngoài project trong zone. |
| `api-latency-records.json` | Hai Alias Latency của API và health check đi kèm. |
| `health-checks.json` | Thông số endpoint và cách kiểm tra sức khỏe từng Region. |

## Cấu hình và chi tiết

Domain quản lý tại P.A Việt Nam, DNS dùng Route 53.

## Zone

- Account: `138150704839`.
- Public hosted zone: `Z03093462BF2L4GV4FGRD`.
- NS: `ns-179.awsdns-22.com`, `ns-2031.awsdns-61.co.uk`, `ns-860.awsdns-43.net`, `ns-1037.awsdns-01.org`.

Nameserver của domain đã trỏ sang Route 53.

## Frontend và API

`app.multi-region.io.vn` có A/AAAA Alias tới CloudFront `E33WCNP66CDRPQ`, hostname `d2hkrs5dvlrte6.cloudfront.net`, EvaluateTargetHealth false.

Hai record A Alias Latency cho `api.multi-region.io.vn`:

| Region | API / stage | Alias target | Target zone ID | Record ID |
|---|---|---|---|---|
| Singapore | `43vakggyh5/demo` | `d-zd1hv50jn0.execute-api.ap-southeast-1.amazonaws.com` | `ZL327KTPIQFUL` | `mrapi-sg` |
| Tokyo | `n39r5pits8/demo` | `d-csqvriesoh.execute-api.ap-northeast-1.amazonaws.com` | `Z1YSHQZHG15GKL` | `mrapi-tokyo` |

Cả hai custom domain Regional IPv4, map gốc tới stage demo, policy `SecurityPolicy_TLS13_1_2_2021_06`, endpoint access Basic. EvaluateTargetHealth false; mỗi record gắn check riêng.

## Health check

| Region | ID | Đích HTTPS |
|---|---|---|
| SG | `c7764d38-b17d-44df-8d44-4f2791296adc` | `43vakggyh5.execute-api.ap-southeast-1.amazonaws.com/demo/health` |
| Tokyo | `bfa2df95-4abf-40d2-a240-dbd04acf735c` | `n39r5pits8.execute-api.ap-northeast-1.amazonaws.com/demo/health` |

Port 443, SNI bật, interval 30 giây, failure threshold 3. Cách đo failover và giới hạn ở [README](README.md).

## Chứng chỉ ACM

| Hostname | Region | Certificate ID | Hết hạn |
|---|---|---|---|
| `app.multi-region.io.vn` | us-east-1 | `30c505e1-65b2-4b90-b151-d600c9c3083a` | 12/05/2027 |
| `api.multi-region.io.vn` | ap-southeast-1 | `cede38ce-71f3-42e0-9b1f-ac2f7448eab0` | 13/05/2027 |
| `api.multi-region.io.vn` | ap-northeast-1 | `c1a76b1f-060a-459e-aa39-4f2e8fda450e` | 12/05/2027 |

Cả ba có trạng thái ISSUED, ELIGIBLE. ARN đầy đủ ở `config/demo/global.json`. Giữ CNAME validation để gia hạn:

| Name | Value | TTL |
|---|---|---|
| `_5f7e01d4f84c0c259f4307697c0f4cf2.app.multi-region.io.vn` | `_d4ea9b8c410cf318fa2f291e955913c5.wzccmgtwzk.acm-validations.aws` | 300 |
| `_f994f68d3e7315add72fd342842a03f0.api.multi-region.io.vn` | `_f983283af8655fc6ad524f548d618f30.wzccmgtwzk.acm-validations.aws` | 300 |

