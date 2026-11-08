# Đăng nhập AWS và bật MFA

Dành cho Minh, Toan, Nhân. Mỗi người có một IAM user trong group `mrapi-developers`. Tùng gửi riêng link đăng nhập, username và mật khẩu tạm.

Trước khi làm, cài Google Authenticator hoặc Microsoft Authenticator trên điện thoại và bật giờ tự động.

Không gửi mật khẩu, mã QR hay mã MFA vào nhóm chat hoặc repo.

## 1. Đăng nhập lần đầu

1. Mở link Tùng gửi (dạng `https://<account>.signin.aws.amazon.com/console`). Nên mở cửa sổ ẩn danh.
2. Chọn đăng nhập bằng **IAM user**, nhập username và mật khẩu tạm.
3. AWS bắt đổi mật khẩu. Mật khẩu mới ít nhất 14 ký tự, có chữ hoa, chữ thường, số và ký tự đặc biệt.

Lúc này mở các dịch vụ sẽ bị Access denied. Đó là do chưa có MFA, làm tiếp bước 2.

## 2. Bật MFA

1. Bấm tên user ở góc trên bên phải, chọn **Security credentials**.
2. Ở mục **Multi-factor authentication (MFA)**, bấm **Assign MFA device**.
3. Đặt tên thiết bị (ví dụ `minh-phone`), chọn **Authenticator app**, bấm **Next**.
4. Bấm **Show QR code**, mở app trên điện thoại và quét.
5. Nhập mã 6 số đang hiện vào ô đầu. Đợi app ra mã mới rồi nhập vào ô thứ hai. Hai mã phải liên tiếp nhau.
6. Bấm **Add MFA**.

## 3. Đăng xuất và đăng nhập lại

Phiên cũ chưa có MFA nên vẫn bị chặn. Phải **Sign out** rồi đăng nhập lại: username, mật khẩu mới, sau đó nhập mã MFA.

Vào được rồi thì chọn region **Asia Pacific (Singapore)**. Mở thử DynamoDB hoặc Lambda, thấy danh sách là được. Nhắn Tùng là đã xong.

## Hay gặp

- Sai mật khẩu: kiểm tra Caps Lock, đúng link của nhóm chưa. Vẫn lỗi thì nhờ Tùng đặt lại.
- Trang đòi email root: bạn đang ở trang đăng nhập root, quay lại link của nhóm.
- Mã MFA không nhận: kiểm tra giờ điện thoại, đợi mã mới rồi nhập lại.
- Có MFA rồi mà vẫn Access denied: đăng xuất hẳn rồi vào lại. Vẫn bị thì gửi Tùng tên dịch vụ và câu báo lỗi.
- Mất điện thoại: báo Tùng để gỡ MFA cũ, không tự tạo tài khoản khác.

## Quy ước

- Mỗi người dùng user của mình, không dùng chung.
- Không tạo access key. Cần chạy lệnh thì dùng CloudShell ngay trong Console.
- Chỉ làm trong 3 region: Singapore, Tokyo và us-east-1. Region khác bị policy chặn.
- Thiếu quyền thì gửi Tùng: tên action, tài nguyên và lỗi thật. Chỉ Tùng sửa IAM.

Tham khảo: [IAM của dự án](../infra/iam/README.md), [hướng dẫn MFA của AWS](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable_virtual.html).
