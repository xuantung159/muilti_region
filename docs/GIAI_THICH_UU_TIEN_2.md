# Giải thích phần "Ưu tiên 2" cho người không học ngành CNTT

Tài liệu này giải thích những gì đã làm trên nhánh `feature/gateway-proxy`, bằng lời thường. Phần kỹ thuật chi tiết nằm ở các file được dẫn link.

## 1. Hệ thống này làm gì? (một ví dụ đời thường)

Hãy hình dung **một tòa nhà văn phòng có quầy lễ tân**.

- Mỗi **doanh nghiệp** thuê một số phòng trong tòa nhà. Trong hệ thống, "phòng" là **API đích** — máy chủ (backend) của doanh nghiệp, nơi thực sự xử lý công việc như tra đơn hàng hay thanh toán.
- Khách muốn vào phòng không đi thẳng vào mà phải qua **quầy lễ tân** — đó là **gateway** của nhóm, chạy trên AWS ở Singapore (sau này thêm Tokyo).
- Doanh nghiệp phát cho khách của mình **thẻ ra vào** — đó là **API key**, một chuỗi ký tự bí mật.

Phần "Ưu tiên 2" là xây **quầy lễ tân**: kiểm tra thẻ, dẫn khách đến đúng phòng, ghi sổ khách ra vào, và lắp **chuông báo** khi chi phí tòa nhà tăng quá mức.

## 2. Bốn việc đã làm

### 2.1. Người soát thẻ — "authorizer" (file `src/authorizer/index.mjs`)

Mỗi request (một lần "khách gõ cửa") phải có thẻ trong header `x-api-key`. Người soát thẻ làm như sau:

| Tình huống | Ví dụ đời thường | Kết quả |
|---|---|---|
| Không có thẻ, thẻ giả, thẻ sai mã | Khách không có thẻ hoặc thẻ in lậu | **401** — "anh/chị là ai?" |
| Thẻ thật nhưng đã bị thu hồi | Nhân viên đã nghỉ việc, thẻ bị khóa | **403** — "thẻ này không còn hiệu lực" |
| Thẻ thật nhưng không có quyền vào phòng này | Thẻ chỉ mở phòng 101 mà đòi vào phòng 205, hoặc phòng của công ty khác | **403** — "thẻ không mở được phòng này" |
| Thẻ hợp lệ, đúng phòng | | Cho qua, kèm "phiếu" ghi rõ khách thuộc doanh nghiệp nào |

**Điểm mới quan trọng: "phạm vi" (scope) của thẻ.** Trước đây một thẻ hợp lệ là vào được mọi thứ. Giờ khi doanh nghiệp tạo key trên portal, họ **bắt buộc chọn key được gọi những API nào**. Key chỉ mở đúng các "phòng" đó. Nếu một key bị lộ, kẻ gian cũng chỉ vào được các phòng đã chọn, không vào được phòng khác hay công ty khác.

Thẻ không được lưu nguyên văn: hệ thống chỉ lưu **dấu vân tay** của thẻ (bản băm SHA-256). Kể cả ai đọc được cơ sở dữ liệu cũng không dựng lại được thẻ gốc. Thẻ gốc chỉ hiện **một lần** lúc tạo.

Key tạo trước khi có tính năng phạm vi không có danh sách phòng, nên sẽ bị từ chối; doanh nghiệp cần tạo key mới.

### 2.2. Người dẫn đường — "proxy" (file `src/api/proxy.mjs`)

Sau khi qua người soát thẻ, request đến người dẫn đường. Khách gọi địa chỉ dạng:

```
https://<gateway>/proxy/<mã API>/orders/42?trang=2
```

Người dẫn đường:

1. Tra sổ xem `<mã API>` là phòng nào **của chính doanh nghiệp ghi trên phiếu** (không bao giờ tin thông tin doanh nghiệp do khách tự khai). Phòng không có → **404**; phòng đang tạm đóng (API bị tắt trên portal) → **403**.
2. Ghép địa chỉ thật: lấy địa chỉ backend đã đăng ký (vd. `https://backend.congty.com/v1`) + phần còn lại `/orders/42?trang=2`.
3. Chuyển nguyên request (loại yêu cầu GET/POST…, dữ liệu gửi kèm) tới backend, rồi **trả lại nguyên câu trả lời** cho khách.
4. Gắn nhãn `X-Mrapi-Source` vào câu trả lời: `upstream` nghĩa là câu trả lời do backend doanh nghiệp đưa ra, `gateway` nghĩa là quầy lễ tân tự trả lời (vì lỗi). Nhờ vậy khi có lỗi, biết ngay lỗi nằm ở phía nào.

**Các biện pháp an toàn** (đây là phần khó nhất):

- **Không cho dẫn vào khu vực nội bộ.** Kẻ xấu có thể đăng ký một "backend" mà tên miền thực chất trỏ vào máy nội bộ của AWS (vd. địa chỉ `169.254.169.254` chứa thông tin đăng nhập của máy chủ). Kiểu tấn công này gọi là **SSRF**. Proxy kiểm tra **địa chỉ IP thật ngay lúc kết nối** và từ chối mọi dải địa chỉ nội bộ, riêng tư, dành riêng (cả IPv4 và IPv6) → **403 `TARGET_BLOCKED`**. Kiểm tra ngay lúc kết nối (chứ không chỉ lúc đăng ký) để chặn cả trò "đổi địa chỉ phút chót" (DNS rebinding).
- **Không lộ thẻ cho backend.** Thẻ gateway (`x-api-key`), token đăng nhập portal (`Authorization`), cookie và các header nội bộ của AWS đều bị gỡ trước khi chuyển đi.
- **Không cho "đi lùi" ra ngoài phạm vi.** Đường dẫn chứa `..` (kiểu `/v1/../admin`) bị từ chối → **400**.
- **Không theo chuyển hướng (redirect)** tự động: nếu backend bảo "sang chỗ khác", proxy chỉ báo lại cho khách chứ không tự đi.
- **Giới hạn thời gian và kích thước.** Chờ tối đa theo thời gian doanh nghiệp đặt (1–10 giây), quá thì **504**. Dữ liệu gửi lên tối đa 1 MB (**413** nếu vượt), câu trả lời tối đa 4 MB (**502** nếu vượt) — do giới hạn của AWS Lambda.

**Bảng mã lỗi do gateway trả về** (luôn có `X-Mrapi-Source: gateway` và body `{"error": "...", "code": "...", "requestId": "..."}`):

| Mã HTTP | `code` | Nghĩa |
|---|---|---|
| 400 | `BAD_PATH` | Đường dẫn không hợp lệ (vd. có `..`) |
| 403 | `API_DISABLED` | Doanh nghiệp đã tắt API này |
| 403 | `TARGET_BLOCKED` | Địa chỉ backend trỏ vào mạng nội bộ |
| 404 | `API_NOT_FOUND` | Không có API này (của doanh nghiệp đó) |
| 413 | `PAYLOAD_TOO_LARGE` | Dữ liệu gửi lên quá 1 MB |
| 502 | `UPSTREAM_UNREACHABLE` | Không kết nối được backend (sai tên miền, máy tắt, lỗi chứng chỉ) |
| 502 | `UPSTREAM_TOO_LARGE` | Backend trả về quá 4 MB |
| 504 | `UPSTREAM_TIMEOUT` | Backend trả lời quá chậm |
| 500 | `GATEWAY_INTERNAL` | Lỗi của chính gateway |

Còn nếu backend tự trả lỗi (vd. 404, 500) thì khách nhận **nguyên** lỗi đó, nhãn `upstream`.

### 2.3. Sổ ghi khách ra vào — "telemetry"

Mỗi request qua proxy được ghi **một dòng** vào bảng DynamoDB `mrapi-telemetry`: lúc nào, doanh nghiệp nào, API nào, key nào (chỉ mã key, không ghi thẻ), đường dẫn, kết quả, mất bao lâu, lỗi loại gì. **Không ghi** dữ liệu gửi kèm, tham số hay header, để không lưu thông tin nhạy cảm của khách hàng.

- Sổ được chia theo doanh nghiệp, nên khi xem thống kê chỉ lấy được dòng của chính mình.
- Request lỗi được ghi thêm vào một "mục lục lỗi" (GSI1) để tra nhanh "các lỗi gần đây".
- Mỗi dòng tự hết hạn sau 30 ngày (TTL) để bảng không phình mãi.
- Nếu ghi sổ thất bại, khách **vẫn nhận câu trả lời bình thường**; hệ thống để lại log `TELEMETRY_WRITE_FAILED` để sau này đặt chuông báo.
- Request bị người soát thẻ chặn (401/403 ở mục 2.1) **không** vào sổ này, chỉ có trong log CloudWatch (`AUTHORIZER_DENY`).

Script `tests/telemetry/telemetry-table.mjs` giúp A kiểm tra bảng thật: ghi dữ liệu thử của 2 doanh nghiệp giả, kiểm tra tra cứu theo thời gian, mục lục lỗi, việc doanh nghiệp này không thấy dòng của doanh nghiệp kia, và hạn TTL, rồi tự xóa dữ liệu thử.

### 2.4. Chuông báo chi phí — SNS và Budgets (thư mục `infra/monitoring/`)

- **SNS** giống một **nhóm chat thông báo**: hệ thống gửi tin vào nhóm, ai đã tham gia (và đã bấm xác nhận trong email) thì nhận được.
- **Budgets** giống **hạn mức thẻ tín dụng có nhắn tin**: đặt 40 USD/tháng, nhắn khi đã tiêu 50%, 80%, và khi dự đoán cả tháng sẽ vượt 100%. Nó **chỉ nhắc**, không tự tắt gì.

Đã chuẩn bị sẵn file cấu hình và từng lệnh để L chạy trên AWS. **Chưa chạy trên AWS**.

## 3. Đã kiểm chứng đến đâu

| Hạng mục | Trạng thái |
|---|---|
| Code authorizer, proxy, key có phạm vi, portal chọn API cho key | Xong, chạy thử trên máy (giả lập AWS): 17/17 test backend, 31/31 test frontend đạt |
| Chặn địa chỉ nội bộ | Có test thật: tên miền trỏ về máy nội bộ bị chặn **trước khi kết nối** |
| Bảng telemetry thật | Có script, **chưa chạy** trên AWS (cần quyền của A) |
| Deploy Lambda proxy/authorizer lên AWS | **Chưa làm** — có hướng dẫn tại `infra/lambda/ap-southeast-1/` |
| Nối route `/proxy` vào API Gateway | **Chưa làm** — chờ C; đã ghi các bước bàn giao |
| Chạy thử toàn bộ trên AWS | Có script `tests/e2e/proxy.mjs` cho mục nghiệm thu D2–D7, **chưa chạy** được vì chưa có route |
| SNS, Budgets | Có cấu hình và lệnh, **chưa tạo** trên AWS |
| IAM | Quyền của role proxy và role authorizer đã khớp với code, **không cần sửa policy** |

"Đạt test trên máy" nghĩa là logic đúng trong môi trường giả lập; **chưa phải bằng chứng hệ thống chạy trên AWS**. Bằng chứng thật chỉ có sau khi deploy và chạy các script ở trên.

## 4. Việc tiếp theo, theo người làm

1. **B (hoặc L):** `npm run package --prefix src`, tạo Lambda `mrapi-proxy` và cập nhật `mrapi-authorizer` theo [mrapi-proxy.md](../infra/lambda/ap-southeast-1/mrapi-proxy.md) và [mrapi-authorizer.md](../infra/lambda/ap-southeast-1/mrapi-authorizer.md); chạy test trên Console.
2. **Upload lại `dashboard.zip`** cho `mrapi-dashboard`: portal mới bắt buộc chọn API khi tạo key.
3. **A:** chạy `npm run test:telemetry --prefix src` trong CloudShell, lưu output làm bằng chứng.
4. **C:** nối route `/proxy` và authorizer theo mục "Nối vào API Gateway", rồi chạy `npm run test:e2e:proxy --prefix src`.
5. **L:** tạo SNS và Budget theo [infra/monitoring/README.md](../infra/monitoring/README.md), cho mọi người bấm Confirm email.

## 5. Giải nghĩa nhanh

| Từ | Nghĩa |
|---|---|
| API | "Cửa" để phần mềm này nói chuyện với phần mềm khác |
| Backend | Máy chủ phía sau của doanh nghiệp, nơi xử lý thật |
| Gateway / proxy | Trạm trung gian nhận request rồi chuyển tiếp |
| Request / response | Một lần hỏi / câu trả lời |
| Tenant | Một doanh nghiệp dùng hệ thống; dữ liệu các tenant phải tách biệt |
| Lambda | Đoạn code AWS chạy khi có request, không cần tự quản lý máy chủ |
| DynamoDB | Cơ sở dữ liệu của AWS |
| IAM role | "Giấy phép" quy định một Lambda được đụng vào tài nguyên nào |
| Mã 2xx / 4xx / 5xx | Thành công / lỗi do người gọi / lỗi phía máy chủ |
