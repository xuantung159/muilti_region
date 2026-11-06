# mrapi-web-sg — ap-southeast-1 (Singapore)

- Người thực hiện: A
- Lần đối chiếu: lệnh `get-public-access-block`, `get-bucket-encryption`, `get-bucket-tagging` ngày 23/10/2026
- Trạng thái: đã tạo, **đang trống**
- ARN: `arn:aws:s3:::mrapi-web-sg`
- Mục đích: chứa bản build `monitoring-web/dist`; L nối CloudFront (OAC) để phục vụ `app.<domain>`

## Cấu hình đang áp dụng

| Thuộc tính | Giá trị | Xác nhận |
|---|---|---|
| Block Public Access | Cả 4 cờ `true` | `get-public-access-block` 23/10 |
| Mã hóa | SSE-S3 (AES256), Bucket Key bật, chặn SSE-C | `get-bucket-encryption` 23/10 |
| Tag | `Project=mrapi`, `Owner=A` | `get-bucket-tagging` 23/10 |
| Static website hosting | Không bật (bucket private, CloudFront đọc qua OAC) | Theo thiết kế |
| Versioning, bucket policy | Chưa cấu hình | — |

Cấu hình thực tế: `mrapi-web-sg/public-access-block.json`, `encryption.json`, `tagging.json`.

## Bàn giao

- A → L: tên bucket, ARN, Region. L tạo OAC và bucket policy cho CloudFront
- Còn thiếu: build và upload `monitoring-web/dist` (người thực hiện chưa chốt, C là owner frontend); cấu hình CloudFront trả `index.html` cho deep link SPA (L)
- Reviewer/kết luận: chưa điền
