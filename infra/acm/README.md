# ACM

## Chức năng

Cấp và quản lý chứng chỉ TLS để truy cập dịch vụ qua HTTPS.

## Ứng dụng trong project

Bảo vệ kết nối tới app.multi-region.io.vn qua CloudFront và api.multi-region.io.vn qua API Gateway ở hai Region.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `<region>/certificate.json` | Chi tiết chứng chỉ: domain, ARN, xác thực DNS, nơi đang sử dụng và hạn hiệu lực. Dùng đối chiếu HTTPS; không chứa private key. |
| `us-east-1/certificates.json` | Danh sách tóm tắt chứng chỉ trong Region của CloudFront. Dùng tìm chứng chỉ trước khi xem chi tiết. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

| Domain | Region | Certificate ID |
|---|---|---|
| `app.multi-region.io.vn` | us-east-1 | `30c505e1-65b2-4b90-b151-d600c9c3083a` |
| `api.multi-region.io.vn` | Singapore | `cede38ce-71f3-42e0-9b1f-ac2f7448eab0` |
| `api.multi-region.io.vn` | Tokyo | `c1a76b1f-060a-459e-aa39-4f2e8fda450e` |

Metadata từng chứng chỉ: [frontend](us-east-1/certificate.json), [API SG](ap-southeast-1/certificate.json), [API Tokyo](ap-northeast-1/certificate.json).

File giữ trạng thái, domain validation, InUseBy và hạn hiệu lực. Chứng chỉ frontend gắn CloudFront; hai chứng chỉ API gắn custom domain Regional. CNAME validation nằm trong [record Route 53](../route53/multi-region.io.vn.records.json).

Không lưu private key hoặc nội dung certificate export.
