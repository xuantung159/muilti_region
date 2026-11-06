# Budget — mrapi-monthly

## Chức năng

Theo dõi chi phí và gửi cảnh báo theo ngưỡng ngân sách.

## Ứng dụng trong project

Đặt mức 10 USD/tháng cho cả account, cảnh báo actual 50%, 80% và forecast 100%. Không tự dừng tài nguyên khi vượt ngưỡng.

## Ý nghĩa các file cấu hình

| File | Mục đích |
|---|---|
| `budgets/mrapi-monthly.budget.json` | Hạn mức, chu kỳ và phạm vi tính chi phí. |
| `budgets/mrapi-monthly.notifications.json` | Ngưỡng actual/forecast và subscriber email placeholder. |

## Cấu hình và chi tiết

Account `138150704839`.

| Mục | Giá trị |
|---|---|
| Loại | Cost budget, Monthly, Recurring |
| Hạn mức | 10 USD/tháng, cố định |
| Phạm vi | Cả account, không filter |
| Metric | UnblendedCost |
| Người nhận | EMAIL, không có SNS |
| Budget actions | Không |

Budget chỉ cảnh báo, không tự tắt tài nguyên.

## Ngưỡng cảnh báo

| Loại | Điều kiện |
|---|---|
| Actual | Lớn hơn 50% — 5 USD |
| Actual | Lớn hơn 80% — 8 USD |
| Forecasted | Lớn hơn 100% — 10 USD |

Cả ba gửi cùng email đã nhập trên Console. File [budget](budgets/mrapi-monthly.budget.json) và [notifications](budgets/mrapi-monthly.notifications.json) lưu cấu hình của dự án; email để placeholder.

## Trạng thái cảnh báo

- Tên, hạn mức và ba ngưỡng đúng.
- Email cảnh báo còn chờ xác minh; chưa nghiệm thu cảnh báo vượt ngưỡng.
- Chưa xác nhận nhận được email cảnh báo.
- API trả CostTypes null; credits/refunds/taxes chưa kiểm tra riêng.

Người nhận cần mở thư xác minh AWS Budgets. Nếu hết hạn, kiểm tra địa chỉ rồi gửi lại từ Budget details.
