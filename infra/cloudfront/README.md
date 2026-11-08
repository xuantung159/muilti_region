# CloudFront — mrapi-web

## Chức năng

Phân phối nội dung qua các edge location và chuyển request tới origin phù hợp.

## Ứng dụng trong project

Phục vụ giao diện từ S3 private qua OAC; chuyển các đường dẫn API tới domain chung của gateway. API không cache để tránh dùng lại phản hồi của người khác.

## Ý nghĩa các file cấu hình

| File | Ý nghĩa và cách dùng |
|---|---|
| `E33WCNP66CDRPQ.json` | Bản cấu hình distribution: origin, behavior, cache policy, HTTPS và function association. Dùng đối chiếu đường đi frontend/API; cần chuyển về đúng cấu trúc input nếu cập nhật bằng CLI. |
| `mrapi-web-sg.bucket-policy.json` | Policy cho CloudFront đọc bucket private qua OAC, giới hạn theo distribution. Dùng khi cấu hình quyền hosting. |
| `mrapi-spa-router.js` | Mã CloudFront Function chuyển route giao diện về index.html. Dùng khi publish function; không sửa đường dẫn API và asset. |
| `frontend-build-manifest.json` | Danh sách file build, dung lượng và hash để đối chiếu gói frontend. Không tự upload/deploy và không mặc định là bản đang chạy. |

Các thư mục Region dùng cấu trúc tương tự. File đối chiếu có thể chứa trường chỉ đọc; cần chọn đúng trường và định dạng input trước khi dùng với AWS CLI. Sửa file trong repo không tự thay đổi tài nguyên AWS.

## Cấu hình và chi tiết

Frontend: [app.multi-region.io.vn](https://app.multi-region.io.vn/portal). Distribution `E33WCNP66CDRPQ`, account `138150704839`; hostname AWS `d2hkrs5dvlrte6.cloudfront.net`.

## Cấu hình

- Bucket private `mrapi-web-sg`, OAC `EWN75AS66OW4A`; ACL tắt, Block all public access bật.
- Root `index.html`, HTTP chuyển sang HTTPS; HTTP/2 và IPv6 bật, dùng tất cả edge locations.
- ACM us-east-1: `30c505e1-65b2-4b90-b151-d600c9c3083a`, SNI, policy `TLSv1.3_2025`.
- Pay-as-you-go; không WAF, Origin Shield hoặc standard logging.

| Origin | Domain | Origin path |
|---|---|---|
| S3 | `mrapi-web-sg.s3.ap-southeast-1.amazonaws.com` | Trống |
| `mrapi-api-latency` | `api.multi-region.io.vn` | Trống; custom domain map tới stage `demo` |
| `mrapi-api-sg` | `43vakggyh5.execute-api.ap-southeast-1.amazonaws.com` | `/demo`; giữ để rollback |

Hai origin API dùng HTTPS 443, TLS 1.2. [Bucket policy](mrapi-web-sg.bucket-policy.json) chỉ cho distribution này đọc. Đã kiểm tra S3 trực tiếp trả 403, CloudFront trả 200.

## Đường dẫn và cache

| Pattern | Origin | Methods | Cache policy |
|---|---|---|---|
| `/api/*` | `mrapi-api-latency` | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE | Managed-CachingDisabled |
| `/health` | Như trên | Như trên | Như trên |
| `/proxy/*` | Như trên | Như trên | Như trên |
| `/monitoring/*` | Như trên | GET, HEAD | Như trên |
| Default `*` | S3 | GET, HEAD | Managed-CachingOptimized |

API dùng Managed-AllViewerExceptHostHeader: giữ Authorization, x-api-key, cookies và query; Host đổi thành origin. Không bỏ prefix đường dẫn. Failover phụ thuộc Route 53 và cache DNS, không dùng origin group.

Function `mrapi-spa-router`, runtime `cloudfront-js-2.0`, gắn viewer-request ở Default. [Code](mrapi-spa-router.js) chuyển đường dẫn giao diện không có dấu chấm về `/index.html`, giữ nguyên API và asset. Không đổi lỗi API 403/404 thành HTML.

## Cập nhật frontend

Build dùng `monitoring-web/.env.production`: `VITE_DEFAULT_DATA_MODE=live`, `VITE_MONITORING_API_URL=/`, `VITE_PORTAL_API_URL=` rỗng.

```powershell
npm run build --prefix monitoring-web
```

Upload nội dung `monitoring-web/dist/` vào gốc bucket: asset trước, `index.html` sau. Giữ asset cũ cho các phiên đang mở. Invalidation `/index.html` và các route cần cập nhật. Không upload source, .env hoặc dependencies.

## Kiểm tra và rollback

`index.html` có `Cache-Control: no-cache` từ 08/11/2026 (metadata object S3). Mỗi lần upload lại `index.html` phải đặt lại `--cache-control no-cache`, nếu không metadata sẽ mất. Asset có hash chưa có header Cache-Control riêng, đang dựa vào TTL của cache policy CloudFront. Build còn cảnh báo chunk lớn.

Quay API về SG: đổi `TargetOriginId` của 4 behavior API thành `mrapi-api-sg`. Khi cập nhật frontend, lưu bản index hiện hành để có thể khôi phục.

