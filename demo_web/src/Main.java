import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.text.NumberFormat;
import java.time.Instant;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.concurrent.Executors;

/** Web Java: HTML được dựng ở server, form HTML thông thường, không JavaScript. */
public final class Main {
    private static final Map<String, String> STATUSES = Map.of("pending", "Đang xử lý", "completed", "Đã hoàn thành", "cancelled", "Đã hủy");
    private final Path root;
    private final ApiClient api;
    private volatile List<Map<String, Object>> lastOrders = List.of();

    public Main(Path root, ApiClient api) { this.root = root; this.api = api; }

    public static void main(String[] args) throws Exception {
        Path root = Path.of(args.length > 0 ? args[0] : ".").toAbsolutePath().normalize();
        Properties config = new Properties();
        Path configFile = root.resolve("config.local.properties");
        if (!Files.exists(configFile)) Files.copy(root.resolve("config.example.properties"), configFile);
        try (var reader = Files.newBufferedReader(configFile)) { config.load(reader); }
        int port = Integer.parseInt(config.getProperty("server.port", "8080"));
        int backendPort = Integer.parseInt(config.getProperty("backend.port", "8081"));
        if (args.length > 1) port = Integer.parseInt(args[1]);
        ApiClient api = new ApiClient(config.getProperty("api.base-url", "http://127.0.0.1:" + backendPort), config.getProperty("api.key", ""));
        HttpServer backend = startBackend(backendPort, new OrderRepository(root.resolve("data/orders.json")));
        HttpServer web;
        try { web = new Main(root, api).startWeb(port); }
        catch (Exception error) { backend.stop(0); throw error; }
        Runtime.getRuntime().addShutdownHook(new Thread(() -> { web.stop(0); backend.stop(0); }));
        System.out.println("Mini Shop (Java): http://localhost:" + web.getAddress().getPort());
        System.out.println("Backend don hang: http://127.0.0.1:" + backend.getAddress().getPort());
    }

    public HttpServer startWeb(int port) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", this::web);
        server.setExecutor(Executors.newFixedThreadPool(8, Main::worker));
        server.start(); return server;
    }

    public static HttpServer startBackend(int port, OrderRepository repository) throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 0);
        server.createContext("/", exchange -> {
            try {
                String path = exchange.getRequestURI().getPath(), method = exchange.getRequestMethod();
                if (path.equals("/health") && method.equals("GET")) { json(exchange, 200, Map.of("status", "ok")); return; }
                if (path.equals("/orders")) {
                    if (method.equals("GET")) { json(exchange, 200, Map.of("orders", repository.list())); return; }
                    if (method.equals("POST")) { json(exchange, 201, Map.of("order", repository.save(null, Json.object(Json.parse(readBody(exchange)))))); return; }
                } else if (path.matches("/orders/[^/]+")) {
                    String id = path.substring("/orders/".length());
                    switch (method) {
                        case "GET" -> json(exchange, 200, Map.of("order", repository.get(id)));
                        case "PUT" -> json(exchange, 200, Map.of("order", repository.save(id, Json.object(Json.parse(readBody(exchange))))));
                        case "DELETE" -> { repository.delete(id); json(exchange, 204, null); }
                        default -> json(exchange, 405, Map.of("error", "Method không hỗ trợ"));
                    }
                    return;
                } else { json(exchange, 404, Map.of("error", "Không tìm thấy")); return; }
                json(exchange, 405, Map.of("error", "Method không hỗ trợ"));
            } catch (OrderRepository.NotFound error) { json(exchange, 404, Map.of("error", "Không tìm thấy đơn hàng")); }
            catch (IllegalArgumentException error) { json(exchange, 400, Map.of("error", "Dữ liệu không hợp lệ")); }
            catch (Exception error) { json(exchange, 500, Map.of("error", "Không xử lý được yêu cầu")); }
            finally { exchange.close(); }
        });
        server.setExecutor(Executors.newFixedThreadPool(4, Main::worker));
        server.start(); return server;
    }

    private static Thread worker(Runnable task) {
        Thread thread = new Thread(task); thread.setDaemon(true); return thread;
    }

    private void web(HttpExchange exchange) throws IOException {
        try {
            String route = exchange.getRequestURI().getPath(), method = exchange.getRequestMethod();
            Map<String, String> query = form(exchange.getRequestURI().getRawQuery());
            if (route.equals("/style.css") && method.equals("GET")) { send(exchange, 200, "text/css", Files.readString(root.resolve("style.css"))); return; }
            if ((route.equals("/") || route.equals("/orders")) && method.equals("GET")) { listPage(exchange, query); return; }
            if (route.equals("/orders/new") && method.equals("GET")) { editor(exchange, 200, Map.of(), "", ""); return; }
            if (method.equals("GET") && List.of("/orders/view", "/orders/edit", "/orders/delete").contains(route)) {
                String id = query.getOrDefault("id", "");
                Map<String, Object> order = api.getOrder(id);
                if (route.endsWith("edit")) editor(exchange, 200, order, id, "");
                else if (route.endsWith("delete")) deletePage(exchange, 200, id, "");
                else detailPage(exchange, order);
                return;
            }
            if (route.equals("/orders/save") && method.equals("POST")) {
                Map<String, String> fields = form(readBody(exchange));
                String id = fields.getOrDefault("id", "");
                Map<String, Object> order = fromForm(fields);
                try {
                    Map<String, Object> valid = OrderRepository.validate(order);
                    if (id.isEmpty()) api.createOrder(valid); else api.updateOrder(id, valid);
                } catch (IllegalArgumentException error) { editor(exchange, 400, order, id, "Vui lòng kiểm tra khách hàng, sản phẩm, số lượng và đơn giá."); return; }
                catch (Exception error) { editor(exchange, 502, order, id, "Chưa xác nhận được thay đổi. Kiểm tra danh sách trước khi gửi lại để tránh tạo trùng."); return; }
                redirect(exchange, "/?saved=1"); return;
            }
            if (route.equals("/orders/delete") && method.equals("POST")) {
                String id = form(readBody(exchange)).getOrDefault("id", "");
                try { api.deleteOrder(id); }
                catch (Exception error) { deletePage(exchange, 502, id, "Chưa xác nhận được thao tác xóa. Kiểm tra lại danh sách trước khi thử lại."); return; }
                redirect(exchange, "/?deleted=1"); return;
            }
            page(exchange, 404, "Không tìm thấy trang", "<p>Trang bạn yêu cầu không tồn tại.</p>" + link("/", "Về danh sách"), false);
        } catch (Exception error) {
            page(exchange, 502, "Chưa kết nối được cửa hàng", "<p>Tạm thời chưa tải được dữ liệu. Vui lòng thử lại sau.</p>" + link("/", "Về danh sách"), false);
        } finally { exchange.close(); }
    }

    private void listPage(HttpExchange exchange, Map<String, String> query) throws IOException {
        boolean stale = false;
        try { lastOrders = api.listOrders(); } catch (Exception error) { stale = true; }
        List<Map<String, Object>> orders = lastOrders;
        String search = query.getOrDefault("q", ""), filter = query.getOrDefault("status", "all");
        boolean auto = !query.getOrDefault("auto", "1").equals("0");
        String message = stale ? "Tạm thời chưa cập nhật được. Đang hiển thị dữ liệu lần tải thành công gần nhất."
                : query.containsKey("saved") ? "Đã lưu đơn hàng." : query.containsKey("deleted") ? "Đã xóa đơn hàng." : "Danh sách đơn hàng đã được cập nhật.";
        StringBuilder html = new StringBuilder("<div class='heading'><div><p class='eyebrow'>CỬA HÀNG CỦA BẠN</p><h1>Đơn hàng</h1><p>Theo dõi và quản lý đơn hàng của cửa hàng.</p></div><div class='actions'>" + link("/?auto=" + (auto ? "1" : "0"), "Làm mới") + "<a class='button primary' href='/orders/new'>+ Tạo đơn hàng</a></div></div>");
        html.append("<section class='stats'>").append(stat("Tổng đơn hàng", orders.size())).append(stat("Đang xử lý", orders.stream().filter(o -> "pending".equals(o.get("status"))).count())).append(stat("Đã hoàn thành", orders.stream().filter(o -> "completed".equals(o.get("status"))).count())).append("</section>");
        html.append("<form class='toolbar' method='get' action='/'><input name='q' aria-label='Tìm đơn hàng' placeholder='Tìm mã đơn hoặc khách hàng…' value='").append(escape(search)).append("'><select name='status' aria-label='Trạng thái'><option value='all'>Tất cả trạng thái</option>");
        for (String status : List.of("pending", "completed", "cancelled")) html.append(option(status, STATUSES.get(status), filter));
        html.append("</select><select name='auto' aria-label='Tự cập nhật'>").append(option("1", "Tự cập nhật: bật", auto ? "1" : "0")).append(option("0", "Tự cập nhật: tắt", auto ? "1" : "0")).append("</select><button>Tìm kiếm</button></form><p role='status' class='").append(stale ? "error" : "muted").append("'>").append(escape(message)).append("</p><section class='list'><div class='table-wrap'><table><thead><tr><th>Mã đơn</th><th>Khách hàng</th><th>Ngày đặt</th><th>Trạng thái</th><th>Tổng tiền</th><th>Thao tác</th></tr></thead><tbody>");
        int shown = 0;
        for (Map<String, Object> order : orders) {
            String id = text(order.get("id")), name = customer(order), status = text(order.get("status"));
            if (!(id + " " + name).toLowerCase(Locale.ROOT).contains(search.toLowerCase(Locale.ROOT)) || (!filter.equals("all") && !filter.equals(status))) continue;
            shown++;
            String encoded = ApiClient.encode(id);
            html.append("<tr><td>").append(escape(id)).append("</td><td>").append(escape(name)).append("</td><td>").append(escape(date(order.get("createdAt")))).append("</td><td><span class='badge ").append(STATUSES.containsKey(status) ? status : "unknown").append("'>").append(escape(STATUSES.getOrDefault(status, "Chưa có trạng thái"))).append("</span></td><td>").append(escape(money(order.get("total")))).append("</td><td>").append(link("/orders/view?id=" + encoded, "Xem")).append(link("/orders/edit?id=" + encoded, "Sửa")).append(link("/orders/delete?id=" + encoded, "Xóa")).append("</td></tr>");
        }
        html.append("</tbody></table></div>");
        if (shown == 0) html.append("<p id='empty'>").append(stale && orders.isEmpty() ? "Chưa tải được dữ liệu đơn hàng." : orders.isEmpty() ? "Chưa có đơn hàng. Hãy tạo đơn đầu tiên." : "Không tìm thấy đơn hàng phù hợp.").append("</p>");
        html.append("</section><footer>Mini Shop · Quản lý đơn hàng</footer>");
        page(exchange, 200, "Đơn hàng", html.toString(), auto);
    }

    private void editor(HttpExchange exchange, int status, Map<String, Object> order, String id, String error) throws IOException {
        Map<String, Object> item = firstItem(order);
        String title = id.isEmpty() ? "Tạo đơn hàng" : "Sửa đơn hàng";
        StringBuilder html = new StringBuilder("<section class='form-card'><h1>" + title + "</h1><form method='post' action='/orders/save'><input type='hidden' name='id' value='" + escape(id) + "'>");
        html.append(input("Tên khách hàng", "customerName", customer(order).equals("—") ? "" : customer(order), "text", "required maxlength='150'"));
        html.append(input("Số điện thoại", "phone", order.get("phone"), "tel", "maxlength='30'"));
        html.append(input("Sản phẩm", "product", item.get("name"), "text", "required maxlength='200'"));
        html.append("<div class='form-grid'>").append(input("Số lượng", "quantity", item.getOrDefault("quantity", 1), "number", "required min='1' max='10000' step='1'")).append(input("Đơn giá (VND)", "price", item.getOrDefault("price", order.get("total")), "number", "required min='0' max='1000000000' step='1'")).append("</div><label>Trạng thái<select name='status'>");
        for (String value : List.of("pending", "completed", "cancelled")) html.append(option(value, STATUSES.get(value), text(order.getOrDefault("status", "pending"))));
        html.append("</select></label><label>Ghi chú<textarea name='note' maxlength='1000' rows='3'>").append(escape(order.get("note"))).append("</textarea></label><p class='error' role='alert'>").append(escape(error)).append("</p><div class='actions'>").append(link("/", "Về danh sách")).append("<button class='primary'>Lưu đơn hàng</button></div></form></section>");
        page(exchange, status, title, html.toString(), false);
    }

    private void detailPage(HttpExchange exchange, Map<String, Object> order) throws IOException {
        StringBuilder html = new StringBuilder("<section class='form-card'><h1>Chi tiết đơn hàng</h1>");
        for (var entry : List.of(Map.entry("Mã đơn", text(order.get("id"))), Map.entry("Khách hàng", customer(order)), Map.entry("Ngày đặt", date(order.get("createdAt"))), Map.entry("Trạng thái", STATUSES.getOrDefault(text(order.get("status")), "Chưa có trạng thái")), Map.entry("Tổng tiền", money(order.get("total"))), Map.entry("Số điện thoại", text(order.get("phone"))), Map.entry("Ghi chú", text(order.get("note"))))) {
            html.append("<div class='detail-field'><span>").append(escape(entry.getKey())).append("</span>").append(escape(entry.getValue())).append("</div>");
        }
        if (order.get("items") instanceof List<?> items) for (Object item : items) {
            Map<String, Object> product = Json.object(item);
            html.append("<p>").append(escape(product.get("name"))).append(" × ").append(escape(product.get("quantity"))).append("</p>");
        }
        html.append("<div class='actions'>").append(link("/", "Về danh sách")).append(link("/orders/edit?id=" + ApiClient.encode(text(order.get("id"))), "Sửa đơn hàng")).append("</div></section>");
        page(exchange, 200, "Chi tiết đơn hàng", html.toString(), false);
    }

    private void deletePage(HttpExchange exchange, int status, String id, String error) throws IOException {
        page(exchange, status, "Xóa đơn hàng", "<section class='form-card'><h1>Xóa đơn hàng?</h1><p>Bạn muốn xóa đơn <strong>" + escape(id) + "</strong>? Thao tác này không thể hoàn tác.</p><p class='error' role='alert'>" + escape(error) + "</p><form method='post' action='/orders/delete'><input type='hidden' name='id' value='" + escape(id) + "'><div class='actions'>" + link("/", "Giữ lại") + "<button class='danger'>Xóa đơn hàng</button></div></form></section>", false);
    }

    private static Map<String, Object> fromForm(Map<String, String> fields) {
        Map<String, Object> result = new LinkedHashMap<>();
        for (String field : List.of("customerName", "phone", "note", "status")) result.put(field, fields.getOrDefault(field, ""));
        Map<String, Object> item = new LinkedHashMap<>();
        item.put("name", fields.getOrDefault("product", ""));
        // Giá trị không phải số vẫn giữ trong form để người dùng sửa.
        for (String field : List.of("quantity", "price")) {
            String value = fields.getOrDefault(field, "");
            try { item.put(field, new java.math.BigDecimal(value)); } catch (NumberFormatException error) { item.put(field, value); }
        }
        result.put("items", List.of(item)); return result;
    }

    private static Map<String, Object> firstItem(Map<String, Object> order) {
        return order.get("items") instanceof List<?> items && !items.isEmpty() ? Json.object(items.get(0)) : Map.of();
    }
    private static String input(String label, String name, Object value, String type, String attributes) {
        return "<label>" + label + "<input name='" + name + "' type='" + type + "' value='" + escape(value) + "' " + attributes + "></label>";
    }
    private static String option(String value, String label, String selected) { return "<option value='" + value + "'" + (value.equals(selected) ? " selected" : "") + ">" + label + "</option>"; }
    private static String stat(String label, long value) { return "<article><span>" + label + "</span><strong>" + value + "</strong></article>"; }
    private static String link(String url, String label) { return "<a class='button' href='" + escape(url) + "'>" + label + "</a>"; }
    private static String text(Object value) { return value == null ? "" : value.toString(); }
    private static String customer(Map<String, Object> order) {
        Object value = order.getOrDefault("customerName", order.get("customer"));
        if (value instanceof Map<?, ?> map) value = map.get("name");
        return value == null ? "—" : text(value);
    }
    private static String date(Object value) {
        try { return DateTimeFormatter.ofPattern("dd/MM/yyyy HH:mm").withZone(ZoneId.of("Asia/Ho_Chi_Minh")).format(Instant.parse(text(value))); }
        catch (Exception error) { return "—"; }
    }
    private static String money(Object value) {
        return value instanceof Number number ? NumberFormat.getCurrencyInstance(Locale.forLanguageTag("vi-VN")).format(number) : "—";
    }
    static String escape(Object value) { return text(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&#39;"); }
    private static Map<String, String> form(String raw) {
        Map<String, String> fields = new LinkedHashMap<>();
        if (raw != null && !raw.isEmpty()) for (String pair : raw.split("&")) {
            String[] entry = pair.split("=", 2);
            fields.put(URLDecoder.decode(entry[0], StandardCharsets.UTF_8), entry.length == 2 ? URLDecoder.decode(entry[1], StandardCharsets.UTF_8) : "");
        }
        return fields;
    }
    private static String readBody(HttpExchange exchange) throws IOException {
        byte[] bytes = exchange.getRequestBody().readNBytes(32769);
        if (bytes.length > 32768) throw new IllegalArgumentException("Request qua lon");
        return new String(bytes, StandardCharsets.UTF_8);
    }
    private void page(HttpExchange exchange, int status, String title, String body, boolean refresh) throws IOException {
        String html = "<!doctype html><html lang='vi'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>"
                + (refresh ? "<meta http-equiv='refresh' content='5'>" : "")
                + "<title>" + escape(title) + " | Mini Shop</title><link rel='stylesheet' href='/style.css'></head><body><header><div class='brand'>Mini Shop <span>Quản lý bán hàng</span></div></header><main>" + body + "</main></body></html>";
        send(exchange, status, "text/html", html);
    }
    private static void redirect(HttpExchange exchange, String location) throws IOException {
        exchange.getResponseHeaders().set("Location", location);
        exchange.sendResponseHeaders(303, -1);
    }
    private static void json(HttpExchange exchange, int status, Object body) throws IOException { send(exchange, status, "application/json", body == null ? "" : Json.stringify(body)); }
    private static void send(HttpExchange exchange, int status, String type, String body) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", type + "; charset=utf-8");
        exchange.getResponseHeaders().set("Cache-Control", "no-store");
        exchange.getResponseHeaders().set("X-Content-Type-Options", "nosniff");
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, status == 204 ? -1 : bytes.length);
        if (status != 204) exchange.getResponseBody().write(bytes);
    }
}
