function handler(event) {
    var request = event.request;
    // This function is attached only to the S3 default behavior.
    // Preserve file URLs and leave API status codes untouched.
    if ((request.method === 'GET' || request.method === 'HEAD') &&
        request.uri.indexOf('.') === -1 &&
        request.uri !== '/api' && request.uri.indexOf('/api/') !== 0 &&
        request.uri !== '/health' && request.uri.indexOf('/proxy/') !== 0 &&
        request.uri.indexOf('/monitoring/') !== 0) {
        request.uri = '/index.html';
    }
    return request;
}
