# Hướng dẫn thành viên đăng nhập AWS và bật MFA

Dành cho A, B, C sử dụng IAM user thuộc group `mrapi-developers` của dự án. Làm lần lượt: đăng nhập bằng mật khẩu tạm → đổi mật khẩu → bật MFA → đăng xuất → đăng nhập lại bằng MFA.

## 1. Chuẩn bị

- URL đăng nhập AWS của nhóm.
- IAM username của bạn.
- Mật khẩu tạm.

URL có dạng `https://<ACCOUNT_ID>.signin.aws.amazon.com/console` hoặc `https://<ACCOUNT_ALIAS>.signin.aws.amazon.com/console`. Dùng đúng URL L gửi; `mrapi-team` trong tài liệu base chỉ là alias dự kiến, không mặc định đã được tạo.

Cài Google Authenticator hoặc Microsoft Authenticator trên điện thoại để tạo mã MFA. Bật ngày giờ tự động trên điện thoại.

Không đưa mật khẩu, mã QR MFA, khóa thiết lập MFA hoặc mã xác thực vào repo, ảnh chụp hay nhóm chat chung.

## 2. Đăng nhập lần đầu và đổi mật khẩu

1. Mở URL L gửi. Nếu trình duyệt đang đăng nhập bằng tài khoản khác, đăng xuất hoặc mở cửa sổ riêng tư.
2. Tại trang **Sign in as IAM user**, kiểm tra **Account ID / Account alias** đúng với thông tin L gửi.
3. Nhập **IAM user name** và mật khẩu tạm → **Sign in**. Dùng username, không dùng email đăng ký tài khoản AWS của trưởng nhóm.
4. Nếu AWS yêu cầu đổi mật khẩu, nhập mật khẩu tạm vào ô mật khẩu hiện tại và nhập mật khẩu mới hai lần → xác nhận.
5. Theo cấu hình base của nhóm, mật khẩu mới phải có ít nhất 14 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt; không dùng lại 5 mật khẩu gần nhất. Nếu yêu cầu hiển thị trên AWS khác, làm theo yêu cầu thực tế và báo L.

Sau khi vào Console, một số trang có thể báo **Access denied** vì bạn chưa có MFA. Tiếp tục bước 3; đây là hành vi dự kiến của policy `mrapi-force-mfa`.

## 3. Bật MFA cho chính user của bạn

1. Trong AWS Console, bấm menu tên tài khoản/user ở góc trên bên phải.
2. Chọn **Security credentials** (có thể hiện **My security credentials**).
3. Nếu trang có nhiều tab, chọn **AWS IAM credentials**.
4. Tìm mục **Multi-factor authentication (MFA)** → bấm **Assign MFA device**.
5. Nhập **Device name**, ví dụ `nguyen-van-a-mfa` (thay bằng tên của bạn).
6. Chọn **Authenticator app** → **Next**.
7. Bấm **Show QR code** nếu mã QR chưa hiện.
8. Mở ứng dụng Authenticator trên điện thoại:
   - Google Authenticator: bấm dấu **+** → **Scan a QR code**.
   - Microsoft Authenticator: bấm thêm tài khoản → **Other account** → quét mã QR.
   - Tên nút có thể khác theo phiên bản; chọn chức năng thêm tài khoản bằng mã QR.
9. Quét QR trên trang AWS. Ứng dụng sẽ thêm một mục và hiển thị mã gồm 6 chữ số. Đặt tên mục dễ phân biệt nếu bạn có nhiều tài khoản.
10. Nhập mã đang hiển thị vào **MFA code 1**.
11. Đợi ứng dụng chuyển sang mã mới, rồi nhập mã mới vào **MFA code 2**. Hai ô phải là hai mã liên tiếp, không nhập cùng một mã hai lần.
12. Bấm **Add MFA** hoặc nút hoàn tất ngay sau khi nhập mã thứ hai.
13. Kiểm tra danh sách **Multi-factor authentication (MFA)** có thiết bị vừa thêm. Giữ lại mục tài khoản trong ứng dụng Authenticator để đăng nhập những lần sau.

Không cần vào trang user của thành viên khác, tạo role hoặc gắn permissions boundary để bật MFA.

## 4. Bắt buộc đăng xuất và đăng nhập lại

Phiên đăng nhập ban đầu chưa xác thực bằng MFA. Chỉ thêm thiết bị MFA chưa đủ để phiên đó được dùng các dịch vụ dự án.

1. Bấm menu tài khoản ở góc trên bên phải → **Sign out**.
2. Mở lại URL đăng nhập của nhóm.
3. Nhập IAM username và **mật khẩu mới** → **Sign in**.
4. Khi AWS yêu cầu MFA, mở Authenticator, chọn đúng mục AWS vừa thêm và nhập mã 6 chữ số hiện tại → xác nhận.
5. Sau khi vào Console, chọn Region **Asia Pacific (Singapore) — `ap-southeast-1`** để bắt đầu làm việc.

Những lần sau cũng đăng nhập theo trình tự username + mật khẩu → mã MFA. IAM là dịch vụ toàn cục; chọn Singapore là để làm các dịch vụ dự án như Lambda và DynamoDB.

## 5. Kiểm tra đã hoàn tất

- Đăng nhập thành công bằng mật khẩu mới và mã MFA.
- Trang **Security credentials → Multi-factor authentication (MFA)** hiển thị thiết bị của bạn.
- Mở **DynamoDB → Tables** hoặc **Lambda → Functions** tại Singapore và tải được danh sách. Danh sách trống vẫn bình thường nếu chưa có tài nguyên.
- Báo L đã hoàn tất đăng nhập và MFA; không gửi kèm mã MFA hoặc mật khẩu.

Quyền developer vẫn có giới hạn sau khi bật MFA: các dịch vụ ngoài phạm vi, Region ngoài quy định và tạo role thiếu boundary vẫn có thể bị từ chối. Khi cần tạo role ứng dụng, xem [BASE_SETUP.md](BASE_SETUP.md), mục 9.

## 6. Xử lý lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| Sai username hoặc mật khẩu | Kiểm tra URL/Account ID, nhập đúng username L gửi, kiểm tra Caps Lock. Sau khi đổi mật khẩu, dùng mật khẩu mới. Nếu vẫn lỗi, nhờ L đặt lại mật khẩu Console. |
| Trang đăng nhập yêu cầu email root | Quay về URL của nhóm và chọn đăng nhập **IAM user**. |
| Mã MFA không hợp lệ khi thiết lập | Dùng hai mã liên tiếp, bật thời gian tự động trên điện thoại và gửi ngay sau khi nhập mã thứ hai. |
| Mã MFA không hợp lệ khi đăng nhập | Chọn đúng tài khoản trong Authenticator, đợi mã mới, kiểm tra giờ tự động và thử lại. Nếu vẫn lỗi, báo L để kiểm tra/đồng bộ MFA. |
| Đã bật MFA nhưng dịch vụ vẫn Access denied | Đăng xuất hẳn rồi đăng nhập lại bằng MFA; kiểm tra đúng user và Region Singapore. Nếu vẫn lỗi, gửi L tên dịch vụ, thao tác và thông báo lỗi đã che thông tin nhạy cảm. |
| Không mở được Security credentials hoặc không gắn được MFA | Báo L kiểm tra user đã vào group `mrapi-developers` và policy `mrapi-force-mfa`. Lỗi ở những trang dịch vụ khác trước khi có MFA là dự kiến. |
| Báo thiết bị MFA đã tồn tại sau lần thiết lập thất bại | Báo L kiểm tra thiết bị tạo dở; không tự xóa mục Authenticator nếu chưa biết thiết bị nào đã được gắn thành công. |
| Mất điện thoại hoặc xóa mục Authenticator | Liên hệ L để xác minh và khôi phục quyền truy cập. Không tự tạo tài khoản AWS mới để thay thế user của nhóm. |

## 7. Quy ước khi làm việc

- Mỗi người dùng user riêng; không chia sẻ tài khoản hoặc mã MFA.
- Không tự tạo access key. Nếu cần CLI, dùng **CloudShell** từ phiên Console đã đăng nhập bằng MFA theo hướng dẫn của nhóm.
- User thành viên không cần gắn `mrapi-workload-boundary`; boundary đó dành cho role dịch vụ.
- Khi xong việc trên máy dùng chung, đăng xuất AWS.

## Tài liệu tham khảo

- [AWS: đăng nhập Console bằng IAM user](https://docs.aws.amazon.com/signin/latest/userguide/introduction-to-iam-user-sign-in-tutorial.html).
- [AWS: gắn thiết bị MFA bằng ứng dụng Authenticator](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_credentials_mfa_enable_virtual.html).
- [Cấu hình base của dự án](BASE_SETUP.md).
