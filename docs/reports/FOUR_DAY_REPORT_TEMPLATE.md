# Mẫu báo cáo đợt 15–18/10/2026

Sao chép thành `docs/reports/2026-10-18-L.md` (hoặc A/B/C). Đây là mẫu, chưa phải báo cáo hoàn thành. Deadline cuối ngày 18/10, giờ Việt Nam. Xem [phân công](../WORK_ASSIGNMENT.md).

## 1. Thông tin

- Người/ký hiệu: …
- Phần phụ trách trong đợt: …
- Branch/PR/commit đã deploy: …
- Ngày giờ báo cáo/Region: …
- Trạng thái: IN REVIEW / BLOCKED; chỉ DONE sau ACCEPTED.

## 2. Kết quả từng đầu việc

| Đầu việc được giao | Kết quả thực tế | DONE/IN REVIEW/BLOCKED/TODO | File/PR | Bằng chứng |
|---|---|---|---|---|
| … | … | … | … | … |

Ghi riêng việc mock/local và AWS thật; không ghi DONE cho đầu việc chỉ có fixture.

## 3. Cấu hình và bàn giao

| Tài nguyên/contract | Tên/ARN/URL/Region | File infra/config | Người nhận | Đã gửi/xác nhận |
|---|---|---|---|---|
| … | … | … | … | … |

Ghi handler/env không secret, role/policy, schema/query, route/authorizer/stage tùy phần. Các giá trị đã đối chiếu Console phải lưu vào infra theo runbook RECORD_CONSOLE_CONFIG.

## 4. Test và hướng dẫn chạy lại

| Test D1–D8 hoặc test riêng | Input/thao tác che secret | Mong đợi | Thực tế | PASS/FAIL/NOT TESTED | Bằng chứng |
|---|---|---|---|---|---|
| … | … | … | … | … | … |

1. Điều kiện trước khi chạy: …
2. URL/lệnh/thao tác: …
3. Kết quả/nơi xem log: …

## 5. Lỗi và việc còn lại

| Vấn đề | Có chặn demo/tích hợp? | Owner/người cần hỗ trợ | Cách tái hiện | Ước lượng thời gian sửa |
|---|---|---|---|---|
| … | … | … | … | … |

Không có bằng chứng hoặc chưa test thì ghi rõ. Liệt kê contract/quyền/tài nguyên đang chờ.

## 6. Đề xuất để chia đợt tiếp

- Phần có thể bắt đầu ngay: …
- Phần phải sửa/nhận input trước: …
- Thời gian có thể làm trong đợt tiếp: …
- Rủi ro với ngày demo: …

Đây là đề xuất, chưa phải lịch phân công đợt 2.

## 7. Review

- Reviewer khác owner: …
- Test đã chạy lại/ngày giờ: …
- Kết luận: ACCEPTED / NEEDS REVISION / BLOCKED.
- Việc cần sửa trước khi DONE: …

Không đưa password, API key gốc, token, AWS secret key hoặc QR MFA vào báo cáo/bằng chứng.
