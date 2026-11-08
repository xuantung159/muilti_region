# Giải thích gateway bằng lời thường

File này dành cho ai không học CNTT hoặc mới vào nhóm. Phần kỹ thuật xem [thiet-ke-gateway.md](thiet-ke-gateway.md).

## Hình dung

Coi hệ thống như một tòa nhà văn phòng có quầy lễ tân.

- Mỗi doanh nghiệp thuê vài phòng. Phòng ở đây là backend của doanh nghiệp, nơi xử lý đơn hàng, thanh toán...
- Khách muốn vào phòng phải qua quầy lễ tân. Quầy lễ tân là gateway của nhóm, đặt ở Singapore và Tokyo.
- Doanh nghiệp phát thẻ ra vào cho ứng dụng của mình. Thẻ đó là API key.

## Người soát thẻ (authorizer)

Mỗi lần gọi phải đưa thẻ trong header `x-api-key`.

- Không có thẻ hoặc thẻ giả: 401.
- Thẻ đã bị khóa (thu hồi): 403.
- Thẻ thật nhưng không mở được phòng này: 403.
- Thẻ đúng: cho qua, kèm phiếu ghi khách thuộc doanh nghiệp nào.

Khi tạo key, doanh nghiệp phải chọn key được vào những phòng nào. Lỡ lộ key thì người ngoài cũng chỉ vào được mấy phòng đó.

Hệ thống không giữ thẻ gốc, chỉ giữ "dấu vân tay" (mã băm SHA-256). Thẻ gốc chỉ hiện đúng một lần lúc tạo.

## Người dẫn đường (proxy)

Ứng dụng gọi dạng:

```
https://api.multi-region.io.vn/proxy/<mã API>/orders/42
```

Proxy tra xem mã API là phòng nào của đúng doanh nghiệp ghi trên phiếu, ghép với địa chỉ backend đã khai báo, chuyển request đi rồi trả nguyên câu trả lời về. Header `X-Mrapi-Source` cho biết câu trả lời đến từ backend (`upstream`) hay do gateway tự trả vì lỗi (`gateway`).

Mấy điểm an toàn:

- Không cho dẫn vào khu nội bộ của AWS. Kẻ xấu có thể khai báo một tên miền trỏ vào máy nội bộ (kiểu tấn công SSRF). Proxy kiểm tra IP thật ngay lúc kết nối và chặn.
- Không đưa thẻ của gateway, token đăng nhập hay cookie sang backend.
- Không theo chuyển hướng (redirect).
- Chờ backend tối đa 1–10 giây tùy doanh nghiệp đặt. Dữ liệu gửi lên tối đa 1 MB, trả về tối đa 4 MB.

## Sổ ghi khách (telemetry)

Mỗi request qua proxy được ghi một dòng: lúc nào, doanh nghiệp nào, API nào, key nào, kết quả ra sao, mất bao lâu. Không ghi nội dung gửi kèm. Mỗi doanh nghiệp chỉ xem được dòng của mình. Dòng tự xóa sau 30 ngày.

## Chuông báo chi phí

- SNS giống một nhóm chat thông báo: ai đăng ký và đã bấm xác nhận email thì nhận tin.
- Budget giống hạn mức thẻ tín dụng: đặt 10 USD/tháng, nhắn khi tiêu 50%, 80% và khi dự báo vượt 100%. Nó chỉ nhắc, không tự tắt gì.

## Hiện trạng

Proxy, authorizer, telemetry đã chạy ở cả Singapore và Tokyo. Budget và SNS đã tạo. Phần còn phải nghiệm thu thêm: đo thu hồi key giữa hai region và xác nhận email cảnh báo tới hộp thư.

## Một số từ hay gặp

- API: cửa để phần mềm này nói chuyện với phần mềm khác.
- Backend: máy chủ phía sau của doanh nghiệp.
- Tenant: một doanh nghiệp dùng hệ thống.
- Lambda: đoạn code AWS chạy khi có request, không cần tự quản lý máy chủ.
- DynamoDB: cơ sở dữ liệu của AWS.
- Mã 2xx / 4xx / 5xx: thành công / lỗi do người gọi / lỗi phía máy chủ.
