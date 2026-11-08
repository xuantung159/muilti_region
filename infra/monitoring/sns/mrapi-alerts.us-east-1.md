# SNS — mrapi-alerts, us-east-1

## Chức năng

Chuyển thông báo từ dịch vụ AWS tới các subscriber.

## Ứng dụng trong project

Topic tại us-east-1 nhận cảnh báo health check Route 53 từ CloudWatch và chuyển tới email đã đăng ký.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `mrapi-alerts.us-east-1.policy.json` | Quyền publish/quản lý topic. |
| `us-east-1.json` | Thuộc tính topic, policy và số subscription confirmed/pending. |

## Cấu hình và chi tiết

Topic Standard cho cảnh báo health check Route 53.

| Mục | Giá trị |
|---|---|
| Account | `138150704839` |
| ARN | `arn:aws:sns:us-east-1:138150704839:mrapi-alerts` |
| Message size tối đa | 256 KiB |
| Display name | Không đặt |
| Policy | [JSON](mrapi-alerts.us-east-1.policy.json) |

## Subscription

Topic có một email subscription Confirmed. CloudWatch đã gọi SNS thành công trong kiểm thử failover; còn cần xác nhận thư tới hộp thư.

Confirmed chỉ xác nhận đăng ký, không bảo đảm mọi cảnh báo đã được nhận. Mã hóa, tag và delivery policy cần kiểm tra riêng khi thay đổi cấu hình.
