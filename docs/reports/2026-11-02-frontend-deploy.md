# Deploy frontend, 02/11/2026

Account `138150704839`, bucket `mrapi-web-sg`, distribution `E33WCNP66CDRPQ`. Giờ UTC. Không commit.

## Đã đổi trên AWS

| Thay đổi | Trước | Sau | Thời điểm |
|---|---|---|---|
| `assets/index-D_0xNfOM.js` | Chưa có | Thêm, 806.614 byte | 07:02 |
| `assets/index-AS3tCnNt.css` | Chưa có | Thêm, 31.924 byte | 07:02 |
| `index.html` | `a97818ac…` | `9f0d5033…` | 07:02 |
| Invalidation | | `ID01FX1RPFFHK96QTRBX3LQ3ZU`: `/index.html`, `/`, `/portal`, `/infrastructure`, Completed | 07:02:55 |

Không xóa object nào. Không đổi bucket policy, CloudFront config, IAM, Route 53, Lambda.

**Cách upload:** máy local không có AWS CLI và bản vá 138 KB quá lớn để gõ qua terminal. Dùng 3 presigned PUT tạo trong CloudShell (`ExpiresIn=900`, ký theo key và `Content-Type`), `curl` từ máy local; JS và CSS trước, `index.html` sau. File URL `/tmp/u` đã xóa. URL hết hạn 07:16:41.

## Rollback

Trong CloudShell SG (`~/web-backup-1102/index.html` hash `a97818ac…`). Asset cũ vẫn trong bucket nên chỉ cần trả `index.html`:

```bash
aws s3 cp ~/web-backup-1102/index.html s3://mrapi-web-sg/index.html --region ap-southeast-1 --content-type text/html
aws cloudfront create-invalidation --distribution-id E33WCNP66CDRPQ --paths /index.html / /portal /infrastructure
```

## Kiểm tra sau deploy

| Kiểm tra | Kết quả |
|---|---|
| Hash và Content-Type đọc lại từ S3 | Trùng local cả 3 file |
| `npm test`, `npm run build` | 33/33 pass, build pass, còn cảnh báo chunk lớn |
| `/`, `/portal`, `/infrastructure`, 2 asset | 200 |
| `/health`, `/monitoring/sources` | 200 |
| Browser `/portal` | Bundle mới, 6 chặng mô phỏng |
| Browser `/` | `LIVE · BACKEND`, console không lỗi |
| Alarm | 0 alarm khác OK ở 3 Region |

Không kiểm tra: đăng nhập portal, D1–D8, R3, R9. Animation trên site thật chưa bấm chạy, chỉ xác nhận component có mặt; hành vi đã kiểm tra trên bản local cùng mã nguồn. Trang chạy từ 1 edge.

`index.html` vẫn không có `Cache-Control`, nên người đã mở trang có thể cần Ctrl+F5.

## Lần 2: hướng dẫn "Làm thử với project mẫu" (07:17–07:20 UTC)

| Thay đổi | Trước | Sau |
|---|---|---|
| `assets/index-CjZe6Rhg.js` | Chưa có | Thêm, 818.258 byte, `d281782c…` |
| `assets/index-Cc4mNVBW.css` | Chưa có | Thêm, 32.440 byte, `adcac021…` |
| `samples/project-mau-mrapi.zip` | Chưa có | Thêm, 4.747 byte, `19d612fb…` (5 file của `project_test`, không có `.env`) |
| `index.html` | `9f0d5033…` | `74086e6a…` |
| Invalidation | | `IEHLJFKS081MRL5JLQ8MC0Y1XU`: `/index.html`, `/`, `/portal`, `/samples/project-mau-mrapi.zip`, Completed |

**Cách upload:** một presigned PUT (`ExpiresIn=900`) cho file tạm `_deploy/web-1102b.tar`, CloudShell giải nén rồi `aws s3 cp` từng file với Content-Type đúng, asset trước, `index.html` sau. Đã xóa `_deploy/` (đọc lại: 0 object) và thư mục tạm. Không xóa object cũ, không đổi cấu hình khác.

**Rollback:** `index.html` cũ ở CloudShell SG `~/web-backup-1102b/index.html` (`9f0d5033…`). Chép lại như lệnh rollback ở trên.

**Kiểm tra:** hash và Content-Type đọc lại từ S3 trùng local cả 4 file. `/`, `/portal`, 2 asset, zip, `/health` trả 200. Zip tải từ site có hash `19d612fb…`. Trên browser, `/portal` dùng `index-CjZe6Rhg.js`, bấm hết 5 bước và tình huống "Dán sai key" ra đúng HTTP 401, console không lỗi. 0 alarm khác OK ở 3 Region. `npm test` 34/34, build pass.
