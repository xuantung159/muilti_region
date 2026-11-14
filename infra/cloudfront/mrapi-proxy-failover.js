import cf from 'cloudfront';

// CloudFront Function (viewer-request, cloudfront-js-2.0) gắn vào behavior /proxy/* của distribution mrapi-web.
// Với request đọc, tạo origin group ngay trong request: gửi tới domain chung api.multi-region.io.vn
// (Route 53 latency chọn Region), nếu trả 500/502/503 hoặc không kết nối được thì CloudFront gửi lại
// ngay request đó sang execute-api Tokyo. Request ghi (POST/PUT/PATCH/DELETE) giữ nguyên origin của behavior,
// vì gửi lại có thể làm backend ghi hai lần.
// Không gắn origin group cố định vào behavior được: CloudFront từ chối behavior cho phép POST/PUT/DELETE
// trỏ tới origin group.
var SAFE_METHODS = { GET: true, HEAD: true, OPTIONS: true };

function handler(event) {
    if (SAFE_METHODS[event.request.method]) {
        cf.createRequestOriginGroup({
            originIds: [{ originId: 'mrapi-api-latency-fo' }, { originId: 'mrapi-api-tyo' }],
            failoverCriteria: { statusCodes: [500, 502, 503] }
        });
    }
    return event.request;
}
