import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

/** Kiểm thử tích hợp bằng HTTP thật, không dùng dữ liệu đơn hàng của người dùng. */
public final class DemoTest {
    private static final HttpClient HTTP = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build();
    private static void check(boolean condition, String message) { if (!condition) throw new AssertionError(message); }
    private static HttpResponse<String> request(String method, String url, String body) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create(url));
        if (body != null) request.header("Content-Type", "application/x-www-form-urlencoded");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return HTTP.send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
    private static String fields(String id, String name, String status, String quantity) {
        return "id=" + ApiClient.encode(id) + "&customerName=" + ApiClient.encode(name)
                + "&phone=0901234567&product=" + ApiClient.encode("Bàn phím")
                + "&quantity=" + quantity + "&price=150000&status=" + status + "&note=Demo";
    }

    public static void main(String[] args) throws Exception {
        Path temp = Files.createTempDirectory("mini-shop-java-test-");
        Path file = temp.resolve("orders.json");
        HttpServer backend = null, web = null, gateway = null;
        try {
            // Vòng đời CRUD qua form HTML -> Java ApiClient -> backend Java.
            OrderRepository repository = new OrderRepository(file);
            backend = Main.startBackend(0, repository);
            ApiClient client = new ApiClient("http://127.0.0.1:" + backend.getAddress().getPort(), "");
            web = new Main(Path.of(args[0]), client).startWeb(0);
            String base = "http://127.0.0.1:" + web.getAddress().getPort();
            String html = request("GET", base + "/", null).body();
            check(html.contains("Tạo đơn hàng") && !html.contains("<script"), "Web phai la HTML khong JavaScript");
            check(request("GET", base + "/config.local.properties", null).statusCode() == 404, "Khong duoc public key");
            check(request("GET", base + "/data/orders.json", null).statusCode() == 404, "Khong duoc public file du lieu");
            HttpResponse<String> invalid = request("POST", base + "/orders/save", fields("", "", "pending", "1"));
            check(invalid.statusCode() == 400 && client.listOrders().isEmpty(), "Validation tao don");
            HttpResponse<String> created = request("POST", base + "/orders/save", fields("", "<script>alert(1)</script>", "pending", "2"));
            check(created.statusCode() == 303, "Tao thanh cong phai redirect");
            Map<String, Object> order = client.listOrders().get(0);
            String id = order.get("id").toString();
            check(order.get("total").toString().equals("300000"), "Server tinh tong tien");
            html = request("GET", base + "/", null).body();
            check(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;") && !html.contains("<script>"), "Escape HTML");
            check(html.contains("http-equiv='refresh'"), "Danh sach tu cap nhat");
            check(!request("GET", base + "/orders/edit?id=" + ApiClient.encode(id), null).body().contains("http-equiv='refresh'"), "Khong refresh mat du lieu form");
            check(request("GET", base + "/orders/view?id=" + ApiClient.encode(id), null).body().contains("Bàn phím"), "Xem chi tiet");
            check(request("POST", base + "/orders/save", fields(id, "Khách đã sửa", "completed", "3")).statusCode() == 303, "Sua don");
            check(client.getOrder(id).get("status").equals("completed"), "Trang thai da sua");
            check(new OrderRepository(file).get(id).get("total").toString().equals("450000"), "Du lieu luu tren dia");
            check(request("GET", base + "/orders/delete?id=" + ApiClient.encode(id), null).statusCode() == 200, "Xac nhan xoa");
            check(client.listOrders().size() == 1, "GET xac nhan khong xoa du lieu");
            check(request("POST", base + "/orders/delete", "id=" + ApiClient.encode(id)).statusCode() == 303, "Xoa don");
            check(client.listOrders().isEmpty(), "Da xoa tren backend");
            check(request("POST", base + "/orders/save", fields("missing", "Test", "pending", "1")).statusCode() == 502, "Bao loi ghi, khong bao thanh cong gia");

            // Cùng ApiClient đi qua gateway/proxy/API_ID với key; không đổi logic CRUD.
            AtomicInteger called = new AtomicInteger();
            AtomicBoolean fail = new AtomicBoolean();
            gateway = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
            gateway.createContext("/", exchange -> {
                try {
                    check("mrk_test_only".equals(exchange.getRequestHeaders().getFirst("x-api-key")), "Key phai duoc gui tu Java");
                    check(exchange.getRequestURI().getPath().startsWith("/proxy/a-test/orders"), "Gateway path");
                    if (List.of("POST", "PUT").contains(exchange.getRequestMethod())) {
                        check("application/json".equals(exchange.getRequestHeaders().getFirst("Content-Type")), "Content-Type JSON");
                        Json.object(Json.parse(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8)));
                    }
                    called.incrementAndGet();
                    String body = "{\"orders\":[]}";
                    if (exchange.getRequestMethod().equals("DELETE")) exchange.sendResponseHeaders(204, -1);
                    else { byte[] bytes = body.getBytes(StandardCharsets.UTF_8); exchange.sendResponseHeaders(fail.get() ? 503 : 200, bytes.length); exchange.getResponseBody().write(bytes); }
                } finally { exchange.close(); }
            });
            gateway.start();
            ApiClient integrated = new ApiClient("http://127.0.0.1:" + gateway.getAddress().getPort() + "/proxy/a-test", "mrk_test_only");
            integrated.listOrders(); integrated.createOrder(Map.of("customerName", "Test"));
            integrated.updateOrder("id-1", Map.of("status", "completed")); integrated.deleteOrder("id-1");
            check(called.get() == 4, "Du 4 method qua gateway");
            fail.set(true);
            boolean failed = false;
            try { integrated.listOrders(); } catch (java.io.IOException error) { failed = true; }
            check(failed, "Gateway loi khong fallback truc tiep");
            check(called.get() == 5, "Khong retry ghi tu dong");
            System.out.println("PASS: Java HTML CRUD, validation, persistence, key privacy, gateway headers and errors.");
        } finally {
            if (web != null) web.stop(0);
            if (backend != null) backend.stop(0);
            if (gateway != null) gateway.stop(0);
            Files.deleteIfExists(temp.resolve("orders.json.tmp")); Files.deleteIfExists(file); Files.deleteIfExists(temp);
        }
    }
}
