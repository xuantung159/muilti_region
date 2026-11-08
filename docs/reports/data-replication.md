# Dữ liệu: replication DynamoDB và S3, 01/11/2026

Account `138150704839`. Bằng chứng: [docs/evidence/data-replication/](../evidence/data-replication/). Thời gian là UTC.

## Kết luận

| Mục | Trạng thái | Căn cứ |
|---|---|---|
| R2, ghi Region này thấy ở Region kia | **PASS** | 10/10 item thấy ở Region kia trong khoảng 1 giây, đã xóa và xác nhận mất ở cả 2 Region |
| R6, object export có ở cả 2 bucket | **PASS, chạy thủ công** | Export 9 object, cả 9 `COMPLETED`/`REPLICA`, ETag khớp. Chưa có lịch chạy định kỳ |
| Dashboard DynamoDB replication | **Đã có số** | Không phải lỗi: thiếu lượt ghi. Sau R2 hiện 708 ms và 551 ms. Sẽ lại `Unavailable` khi không có ghi trong khoảng xem |
| Dashboard S3 replication | **Vẫn Unavailable** | Lỗi code: hỏi CloudWatch sai Region. Cần sửa code, chưa sửa |

## Đã đổi gì trên AWS

| Thay đổi | Rollback |
|---|---|
| 10 item thử trong `mrapi-telemetry` | Đã xóa, xác nhận mất ở 2 Region |
| 1 lần DynamoDB Export, thêm 9 object vào `exports/telemetry/AWSDynamoDB/01793499887258-66a60a29/` ở `mrapi-exports-sg`, tự chép sang `mrapi-exports-tyo` | Giữ lại làm bằng chứng. Nếu muốn dọn: xóa prefix này ở cả 2 bucket; bucket có versioning và rule không chép delete marker nên phải làm ở từng bucket |

**Không đổi:** PITR (SG đã bật sẵn), replication rule, Lambda, IAM, S3 Metrics, RTC. Chi phí phát sinh: export 9.241 byte, không đáng kể.

Lưu ý một sự cố nhỏ trong lúc làm: một lệnh JavaScript đọc terminal của tôi làm hỏng hiển thị tab CloudShell, phải tải lại trang. Không ảnh hưởng tới AWS.

## R2: `mrapi-telemetry`

Cách đo: script boto3 chạy ở CloudShell us-east-1, `put-item` ở Region nguồn, poll `get-item` (`ConsistentRead`) ở Region kia. Khóa có tiền tố `R2TEST#2026-11-01#`, `expiresAt` trong 1 giờ, không có khóa GSI. Số liệu đầy đủ: [r2-measurements.csv](../evidence/data-replication/r2-measurements.csv).

| Lần | SG → Tokyo: từ lúc gửi put (ms) | từ lúc put trả về (ms) | Tokyo → SG: từ lúc gửi put (ms) | từ lúc put trả về (ms) |
|---|---|---|---|---|
| 1 | 535 | 308 | 584 | 426 |
| 2 | 983 | 768 | 793 | 637 |
| 3 | 981 | 767 | 1005 | 850 |
| 4 | 979 | 765 | 792 | 636 |
| 5 | 981 | 768 | 1009 | 854 |

**Đọc số này thế nào:** đây là cận trên có sai số, không phải độ trễ replication chính xác. Máy đo ở us-east-1, mỗi lần poll mất 153 ms (Tokyo) hoặc 212 ms (SG), nên độ phân giải là một vòng poll. Lần 1 mỗi chiều nhỏ hơn hẳn các lần sau, tôi chưa có căn cứ giải thích, không nên coi là bình thường. 10 mẫu chưa đủ để nói về p95.

**Đối chiếu CloudWatch `ReplicationLatency`:**

| Chiều | Nơi có metric | Số mẫu | Trung bình | Max |
|---|---|---|---|---|
| SG → Tokyo | ap-southeast-1, `ReceivingRegion=ap-northeast-1` | 7 | 708 ms | 1.080 ms |
| Tokyo → SG | ap-northeast-1, `ReceivingRegion=ap-southeast-1` | 6 | 551 ms | 683 ms |

Cùng cỡ với số đo poll. Metric có 7 và 6 mẫu dù có 10 thao tác ghi và xóa mỗi chiều; tôi không biết CloudWatch lấy mẫu theo quy tắc nào nên không suy diễn.

**Dọn dẹp:** xóa ở Region đã ghi, chờ 6 giây, `get-item` cả 2 Region cho 20/20 kết quả không còn.

## R6: export sang S3

**Trước khi làm:**
- PITR `mrapi-telemetry`: SG **đã bật**, Tokyo tắt. Không cần bật gì. Runbook ghi nếu bật thì nên bật cả 2 Region, nên Tokyo đang lệch; xem đề xuất.
- Producer có một lần chạy duy nhất: export `01792752415680-452d01dd`, 23/10, prefix `exports/telemetry/`, DYNAMODB_JSON. Không có EventBridge rule hay schedule nào ở 2 Region, tức **chưa có producer định kỳ**.
- `exports/latency-test/*` là object thử cũ, không dùng làm bằng chứng.

**Lần chạy hôm nay:** export `01793499887258-66a60a29`, FULL_EXPORT, cùng prefix quy ước `exports/telemetry`. Bắt đầu 02:24:47, xong 02:26:49 (122 giây), 27 item, 9.241 byte.

| Đợt object | Thấy ở SG | Thấy ở Tokyo | Chênh |
|---|---|---|---|
| `_started` | 1793499892,1 | 1793499914,1 | 22,0 s |
| 4 file `data/` | 1793499979,3 | 1793500001,2 | 22,0 s |
| 4 file `manifest-*` | 1793500012,0 | 1793500032,8 | 20,8 s |

- Cả 9 object: SG `COMPLETED`, Tokyo `REPLICA`, ETag và VersionId khớp. Chi tiết ở [cloudshell-output.txt](../evidence/data-replication/cloudshell-output.txt).
- Chu kỳ poll khoảng 4 giây nên số trên có thể cao hơn thực tế tới chừng đó. Giá trị rất đều, cần ghi nhận nhưng mẫu quá ít để kết luận.
- CloudWatch `ReplicationLatency` ghi **11 giây** ở 02:25 và 02:27, thấp hơn số poll. Hai số đo khác nhau: metric là chênh theo định nghĩa của S3, số poll là lúc `ListObjects` thấy object. Báo cáo nên nêu cả hai.
- Không mở nội dung object.

Không có RTC nên S3 không cam kết thời gian chép.

## Vì sao dashboard báo Unavailable

### DynamoDB: không có lượt ghi, không phải lỗi

Code truy vấn đúng: metric ở Region nguồn, dimension `ReceivingRegion` là Region đích. CloudWatch chỉ có điểm khi có ghi. Trước hôm nay điểm gần nhất là 23/10 (SG) và 25/10 (Tokyo), vì hệ thống không có traffic `/proxy` nên telemetry không có ghi mới.

Kiểm chứng: sau R2, không sửa gì, `/monitoring/snapshot` trả SG 708 ms, Tokyo 551 ms ở khoảng 6h và 24h, 695 ms và 551 ms ở khoảng 1h. Các snapshot lưu ở thư mục bằng chứng. Ngay sau R2 vẫn `unavailable` vì code bỏ các ô thời gian chưa kết thúc.

Số này sẽ biến mất khi hết khoảng xem nếu không có ghi mới. Nhãn nên là "không có lượt ghi trong khoảng này".

### S3: code hỏi sai Region

`fetchRegion` gửi truy vấn `s_rep` bằng client của Region nguồn (SG), và `monitoring-web/docs/integration/s3-replication.md` cũng ghi metric nằm ở Region nguồn. Thực tế trên account này:

| | ap-southeast-1 | ap-northeast-1 |
|---|---|---|
| `list-metrics` AWS/S3 ReplicationLatency | rỗng | có, đúng 3 dimension code dùng |
| Điểm dữ liệu | không có | mỗi phút một điểm, 2 điểm 11 giây sau R6 |

Rule SG đã bật Metrics, tên bucket và `RuleId` đúng, role có `cloudwatch:GetMetricData`, Lambda SG đọc được CloudWatch Tokyo. **Không thiếu cấu hình và không thiếu quyền.** Kiểm chứng: sau R6 metric Tokyo có giá trị 11 mà snapshot SG vẫn `unavailable`.

Tôi kết luận theo dữ liệu quan sát được trên account này; chưa đối chiếu tài liệu AWS về Region phát metric.

**Không sửa bằng `MONITORING_CONFIG`.** Có thể chuyển khối `s3` sang Tokyo qua biến môi trường, nhưng `OverviewPage.tsx:107` luôn đọc `regions[0]` (SG) nên trang Tổng quan vẫn không có số, còn trang Regions lại hiện nhầm "gửi đi" ở Tokyo. Đây là che lỗi, nên tôi không đổi Lambda.

Tokyo báo `not_configured` là đúng với cấu hình `s3: null`. Bật Metrics trên rule `mrapi-tyo-to-sg` không có tác dụng với dashboard và tốn phí metric, không có producer ở Tokyo, nên không bật.

### Đề xuất sửa code (chưa làm)

Trong `src/monitoring/index.mjs`:

1. Thêm `metricRegion: 'ap-northeast-1'` vào `regions['ap-southeast-1'].s3`.
2. Bỏ `s_rep` khỏi `queries` trong `fetchRegion`; truyền `clientFor` xuống, truy vấn riêng:

```js
if (cfg.s3) {
  try {
    const s3Data = await getMetricData(clientFor(cfg.s3.metricRegion),
      [query('s_rep', 'AWS/S3', 'ReplicationLatency',
        { SourceBucket: cfg.s3.sourceBucket, DestinationBucket: cfg.s3.destinationBucket, RuleId: cfg.s3.ruleId },
        'Maximum', p)], win.start, win.end);
    if (s3Data.has('s_rep')) data.set('s_rep', s3Data.get('s_rep'));
  } catch { /* s3 thành unavailable, không làm hỏng số liệu Region */ }
}
```

3. Dùng `Maximum` thay `Average`, và ở `buildRegion` lấy max thay `mean`. Metric có điểm 0 mỗi phút khi rảnh, trung bình 24h sẽ gần như luôn 0,0 s dù vừa có chép chậm 11 giây.
4. Thêm test, sửa dòng "Metric ghi ở Region của bucket nguồn" trong tài liệu tích hợp.

Không cần sửa IAM. Sau khi sửa phải deploy cả 2 Region; Tokyo đã cập nhật code ngày 08/11 ([config-fixes.md](config-fixes.md)). Thẻ nguồn `Connected` khi không có điểm dữ liệu vẫn gây hiểu nhầm, nên sửa cùng lúc.

## Phát hiện khác

1. **Bucket có file tên `exports/ducminh_credentials.csv`** (112 byte, 17/10), đã được chép sang Tokyo. Tên gợi ý chứa credential IAM. Tôi không mở file nên không xác nhận nội dung. Nằm ở cả 2 bucket có versioning, xóa thường không xóa hẳn. Cần người dùng xử lý.
2. **Rule Tokyo lệch repo:** AWS là `Filter: {}`, role `s3crr_role_for_mrapi-exports-tyo_1`; [replication.json](../../infra/s3/ap-northeast-1/replication.json) ghi filter `exports/` + tag `Project=mrapi`, role không có `_1`. Rule Tokyo trên AWS chép mọi object. Object `REPLICA` không chép ngược nên không có vòng lặp (SG sau export tăng đúng 9 object). Bản SG khớp repo.
3. **Tokyo có thêm marker `exports/`**, nên lệch 1 object (25 và 26). Vô hại.

## Việc chưa xong

- Dashboard S3 chưa có số, chờ sửa code và deploy.
- R6 mới chạy tay. Muốn định kỳ cần Lambda và EventBridge, cần role do L cấp.
- Chưa có ảnh Console, chỉ có bản trích CloudShell và [ảnh CloudShell](../evidence/data-replication/cloudshell-final.jpg).

## Đề xuất, không làm

- **RTC:** không bật, tốn thêm phí. Chỉ cần nếu đồ án muốn SLA 15 phút và bộ metric RTC.
- **PITR Tokyo:** chỉ bật nếu nhóm muốn khôi phục được ở Tokyo khi mất SG. Export không cần.
- `src/monitoring`: ghi nhãn rõ hơn cho trạng thái không có lượt ghi.
- Khi gom hồ sơ: cập nhật `infra/s3/ap-northeast-1/replication.json`, `infra/s3/README.md`, `infra/DEPLOYED_STATE.md` theo thực tế (dòng "chưa triển khai export S3" đã cũ). Tôi không sửa theo yêu cầu.

## Cần người dùng

1. Xử lý `exports/ducminh_credentials.csv`: kiểm tra, vô hiệu access key nếu là credential thật, rồi xóa mọi version ở cả 2 bucket.
2. Duyệt sửa `src/monitoring/index.mjs` và deploy (đề xuất ở trên).
3. Quyết định có cần producer định kỳ không.
