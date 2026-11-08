# Làm trên Console xong thì ghi lại vào repo

Nhóm không dùng Terraform. Mọi thứ dựng trên Console, nên phải ghi lại cấu hình thật vào `infra/` để người khác đọc hiểu và dựng lại được.

## Mỗi lần làm

1. Làm trên Console, bấm Save/Create/Deploy.
2. Mở lại trang đó, xem đúng region, đúng tên, đã lưu chưa.
3. Ghi vào file trong `infra/<dịch vụ>/<region>/`. Có JSON (policy, replication...) thì copy nguyên JSON đang chạy trên AWS.
4. Tên, ID, URL mà phần khác cần dùng thì điền vào `config/demo/`.
5. Thử chức năng. Ảnh hoặc output (đã che thông tin nhạy cảm) để vào `docs/evidence/`. Chưa thử thì ghi "chưa test".

## Ghi ở đâu

| Dịch vụ | File |
|---|---|
| IAM | `infra/iam/policies/*.json`, `infra/iam/roles/<role>/` |
| DynamoDB | `infra/dynamodb/<region>/<bảng>.md` |
| Lambda | `infra/lambda/<region>/<hàm>.md` |
| API Gateway | `infra/apigateway/<region>/` |
| Route 53, ACM | `infra/route53/`, `infra/acm/` |
| CloudFront | `infra/cloudfront/` |
| S3 | `infra/s3/<region>/` |
| Alarm, SNS, Budget | `infra/monitoring/` |

## Mẫu

```markdown
# mrapi-proxy — ap-northeast-1

Người làm: Toan

| Mục | Giá trị |
|---|---|
| Runtime | Node.js 24.x, arm64 |
| Handler | api/index.handler |
| Role | mrapi-proxy-role |
| Biến môi trường | CONTROL_TABLE, TELEMETRY_TABLE, PROJECT |
| Memory / timeout | 256 MB / 15 s |

Đã thử: GET /demo/health trả 200, region ap-northeast-1.
```

## Không được ghi

Mật khẩu, token, API key thật, access key, mã QR MFA. Biến môi trường bí mật thì chỉ ghi tên biến.

Sửa lại trên Console lần sau thì sửa luôn file cũ, đừng để hai bản khác nhau.
