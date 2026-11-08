# Tùng — rà soát Console

Kiểm tra trên Console (account `138150704839`), không sửa gì của các bạn khác.

## Thấy gì trên AWS

- Route 53: đã có hosted zone `multi-region.click` nhưng chưa có record nào ngoài NS/SOA. Chưa mua được domain.
- Chưa có health check, chưa có CloudFront distribution.
- Budget `mrapi-monthly` 10 USD, đã dùng 0 USD.
- SNS `mrapi-alerts` ở us-east-1: đã thêm email, đang chờ xác nhận.

## Repo

- Sửa các link còn trỏ tới `BASE_SETUP.md` (file đã xóa).
- Sửa Budget mẫu từ 40 về 10 USD cho khớp Console.
- Còn 4 nhánh có commit chưa vào `main`: `feature/iam-roles`, `feature/lambda`, `feature/monitoring`, `feature/route53`. Chưa merge.

## Việc tiếp

1. Bấm xác nhận email SNS.
2. Review và gom 4 nhánh trên về `main`.
3. Tìm domain khác vì `.click` bị chặn với tài khoản free plan. (Sau đó chốt `multi-region.io.vn`.)
4. Chờ Nhân và Toan dựng xong Tokyo rồi mới làm health check và CloudFront.

Ảnh chụp SNS có địa chỉ email nên chỉ để trong `docs/evidence/`, không đưa ra ngoài.
