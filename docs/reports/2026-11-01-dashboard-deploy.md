# Deploy `mrapi-dashboard` bản đọc telemetry, 01/11/2026

Account `138150704839`, thao tác qua CloudShell SG (user `admin`). Giờ UTC. Bằng chứng: [docs/evidence/2026-11-01/dashboard/](../evidence/2026-11-01/dashboard/). Không commit.

## Kết luận

**Đã deploy lên 2 Region, không có lỗi, không rollback.** Trang portal, `/` và `/api/me` không đổi hành vi. **Chưa chứng minh được thống kê thật:** `/api/usage` có phiên là **NOT TESTED**, vì cần đăng nhập, nên đường code Query `mrapi-telemetry` chưa chạy lần nào trên AWS.

| Region | Trước | Sau | LastModified |
|---|---|---|---|
| ap-southeast-1 | `mggBHJ5biFepPFOy/1dwPt4+gO8QvVi8Lg2CFz0ZzCo=` | `6j5+KNl+NH8rOICWWSUzQ5GCr2OK8vZgdhagS7FLZaI=` | 03:35:54 |
| ap-northeast-1 | như trên | như trên | 03:36:41 |

Handler, env, role, memory, timeout, runtime không đổi. Không sửa IAM.

## 1. Tiền kiểm

| Điều kiện | Kết quả | Căn cứ |
|---|---|---|
| File đổi | Chỉ `dashboard/index.mjs` | `apis.mjs`, `lib.mjs` chỉ khác kiểu xuống dòng; `lib.mjs` đang chạy đã export `TELEMETRY_TABLE` |
| Dependency mới | Không | `client-cloudwatch` thêm vào `package.json` là của monitoring; dashboard không import. Import thử ZIP mới trả handler |
| Env | Đã có | `TELEMETRY_TABLE=mrapi-telemetry` ở 2 Region |
| Cách code đọc | Query bảng chính, `ConsistentRead`, không dùng GSI1 | `src/dashboard/index.mjs:193`. Key `PK`, `SK` khớp bảng và khớp cách proxy ghi |
| IAM | Đủ | Inline `ReadTelemetry` có `dynamodb:Query` trên bảng ở 2 Region; boundary v2 cho `dynamodb:*` trên `table/mrapi-*` |
| Mô phỏng IAM | `allowed` cả 2 Region | `simulate-principal-policy`, có tính boundary |
| Bảng | `ACTIVE` ở 2 Region, replica của nhau | `describe-table` |

Không có quyền trên ARN `index/GSI1`, nhưng code không gọi index. Nếu sau này truy vấn GSI1 thì phải thêm quyền.

`npm --prefix src test`: 19/19 pass, gồm 2 test usage telemetry. `npm --prefix src run package`: `dashboard.zip` đúng cấu trúc, handler `dashboard/index.handler`.

## 2. Cách tạo ZIP

Vá ZIP đang chạy như lần monitoring: `old.zip` tải từ Lambda, hash trùng `mggBHJ5b…`; bản vá 964 ký tự base64 áp lên `dashboard/index.mjs`.

| Kiểm tra | Kết quả |
|---|---|
| `dashboard/index.mjs` trong ZIP mới | `29698ac1…`, trùng byte với file local |
| `apis.mjs`, `lib.mjs` | Không đổi. `4c5d667a…`, `cd61b8f9…` trùng bản local **sau khi đổi sang CRLF**, không trùng byte vì local là LF |
| So từng entry `old.zip` với `new.zip` | 4.652 entry, cùng thứ tự, chỉ khác `dashboard/index.mjs` |
| `package.json` trong ZIP | Giữ của bản đang chạy, không trùng local, không phải code thực thi |

**`CodeSha256` khác `artifacts/lambda/dashboard.zip` local** (`6333d03b…` là SHA-256 hex của file đó), vì đây là ZIP vá chứ không phải ZIP đóng gói lại. `node_modules` là của bản đang chạy, tôi không so với local; dashboard không đổi import nên giữ nguyên là an toàn.

Lần chạy đầu script tạo ZIP báo lỗi CRC ở bước tự kiểm tra, do tôi dùng lại đối tượng `ZipInfo`. Chưa deploy; sửa script, tạo lại, hash không đổi.

## 3. Kiểm tra sau deploy

| Kiểm tra | SG | Tokyo |
|---|---|---|
| `LastUpdateStatus` | Successful | Successful |
| `CodeSha256` | `6j5+KNl+…` | Trùng SG |
| `/` trên execute-api | 200 JSON `portal-api`, như trước | Như vậy |
| `/api/me` không phiên | 401, `region` đúng | 401, `region` đúng |
| `/api/usage` không phiên | 401 | 401 |
| Log lỗi import, runtime, timeout, AccessDenied | 0/13 sự kiện | 0/10 sự kiện |
| Hash env | `64dad97b…` | Trùng SG |
| 4 alarm Region | OK | OK |

Khởi động lạnh SG init 297 ms, Max Memory 99 MB trên 256 MB.

Qua domain: `https://app.multi-region.io.vn/portal` 200 `text/html`, trình duyệt hiện "Cổng doanh nghiệp" và form đăng nhập, console không lỗi. `/api/me` qua domain 401. Từ CloudShell SG nên các request domain này đi SG; bản Tokyo được kiểm tra qua execute-api.

Log 2 Region chỉ bao phủ khoảng 2 phút sau deploy. Portal chưa đăng nhập không gọi `/api/`, nên kiểm tra trang không chạm tới code mới.

## 4. NOT TESTED

- `/api/usage` có phiên, số thống kê portal, `/api/status`. Không suy đoán kết quả.
- Query thật vào `mrapi-telemetry` bằng role. Hiện chỉ có mô phỏng IAM, chưa có lần gọi thật.

**Hành vi sẽ khác khi đăng nhập:** thống kê chỉ đếm request `/proxy` có trong telemetry, không còn đọc `USAGE#`. Tenant chưa có traffic proxy sẽ thấy 0 thay vì số cũ, theo test `empty telemetry stays empty`. Telemetry là global table, nên số gộp từ cả 2 Region, nhưng ConsistentRead không chờ replication: request vừa phục vụ ở Region kia có thể đến muộn.
## 5. Rollback

Trong CloudShell SG, `~/dash/old.zip` có hash `mggBHJ5b…`:

```bash
cd ~/dash
aws lambda update-function-code --function-name mrapi-dashboard --region ap-southeast-1 --zip-file fileb://old.zip
aws lambda update-function-code --function-name mrapi-dashboard --region ap-northeast-1 --zip-file fileb://old.zip
```

Bản này đọc lại `USAGE#`. File chỉ nằm trong CloudShell, không có trong repo; storage CloudShell bị xóa nếu lâu không dùng, nên tải về nếu muốn giữ lâu.

## Phát hiện phụ, chưa sửa

- `infra/iam/policies/mrapi-workload-boundary.json` trong working tree đang bị ghi đè bằng nội dung giống policy của authorizer, không phải boundary. AWS v2 có `ProjectTables` như bản ở git HEAD. Không đổi IAM trên AWS, nhưng nếu ai áp file này lên AWS thì 3 role sẽ mất quyền (không ghi được control, không đọc được telemetry). Cần khôi phục trước khi commit.
- `infra/iam/roles/mrapi-dashboard-role/permission.json` đúng với `mrapi-dashboard-access`, còn `ReadTelemetry` ở file riêng, khớp AWS. Câu "Repo gộp chúng vào một file" trong `infra/DEPLOYED_STATE.md` đã cũ.
- Portal vẫn ghi "Proxy chuyển tiếp và cấp quyền key theo API chưa triển khai", trái với trạng thái hiện tại. Sửa cần build và upload frontend, ngoài phạm vi.

## Cần người dùng

1. Đăng nhập portal, xem thống kê sau khi có request `/proxy`, rồi xem log `/aws/lambda/mrapi-dashboard` có `AccessDenied` hay không. Đây là bước còn thiếu để kết luận tính năng.
2. Khôi phục `mrapi-workload-boundary.json` trước khi commit.
3. Commit các thay đổi local. Tôi không commit.
