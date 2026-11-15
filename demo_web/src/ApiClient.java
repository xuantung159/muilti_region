import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;

/** Java gọi API đơn hàng. Đổi base URL và key mà không đổi nghiệp vụ CRUD. */
public final class ApiClient {
    private final String baseUrl;
    private final String apiKey;
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(5))
            .followRedirects(HttpClient.Redirect.NEVER).build();

    public ApiClient(String baseUrl, String apiKey) {
        URI uri = URI.create(baseUrl);
        if (!List.of("http", "https").contains(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null) {
            throw new IllegalArgumentException("api.base-url khong hop le");
        }
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.apiKey = apiKey.trim();
        if (uri.getPath().contains("/proxy/") && this.apiKey.isEmpty()) {
            throw new IllegalArgumentException("Can dien api.key khi dung gateway");
        }
    }

    private Object request(String method, String path, Map<String, Object> body)
            throws IOException, InterruptedException {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(baseUrl + path))
                .timeout(Duration.ofSeconds(10)).header("Accept", "application/json");
        // API key chỉ tồn tại phía Java server, không gửi xuống HTML/trình duyệt.
        if (!apiKey.isEmpty()) request.header("x-api-key", apiKey);
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody()
                : HttpRequest.BodyPublishers.ofString(Json.stringify(body)));
        HttpResponse<String> response = client.send(request.build(), HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("API HTTP " + response.statusCode());
        }
        return response.body().isBlank() ? null : Json.parse(response.body());
    }

    public List<Map<String, Object>> listOrders() throws IOException, InterruptedException {
        Object result = request("GET", "/orders", null);
        Object rows = result instanceof Map<?, ?> map ? map.get("orders") : result;
        if (!(rows instanceof List<?> list)) throw new IOException("API khong tra danh sach orders");
        java.util.ArrayList<Map<String, Object>> orders = new java.util.ArrayList<>();
        for (Object item : list) orders.add(Json.object(item));
        return orders;
    }

    public Map<String, Object> getOrder(String id) throws IOException, InterruptedException {
        Map<String, Object> result = Json.object(request("GET", "/orders/" + encode(id), null));
        return result.containsKey("order") ? Json.object(result.get("order")) : result;
    }

    public void createOrder(Map<String, Object> order) throws IOException, InterruptedException {
        request("POST", "/orders", order);
    }

    public void updateOrder(String id, Map<String, Object> order) throws IOException, InterruptedException {
        request("PUT", "/orders/" + encode(id), order);
    }

    public void deleteOrder(String id) throws IOException, InterruptedException {
        request("DELETE", "/orders/" + encode(id), null);
    }

    public static String encode(String value) {
        return java.net.URLEncoder.encode(value, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20");
    }
}
