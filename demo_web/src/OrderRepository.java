import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Backend mẫu: lưu đơn hàng trên đĩa, đọc được data/orders.json của bản cũ. */
public final class OrderRepository {
    private final Path file;
    private List<Map<String, Object>> orders = new ArrayList<>();

    public OrderRepository(Path file) throws IOException {
        this.file = file;
        Files.createDirectories(file.toAbsolutePath().getParent());
        if (Files.exists(file)) {
            Object data = Json.parse(Files.readString(file));
            if (!(data instanceof List<?> rows)) throw new IOException("File orders khong hop le");
            for (Object row : rows) orders.add(Json.object(row));
        }
    }

    public synchronized List<Map<String, Object>> list() { return new ArrayList<>(orders); }
    public synchronized Map<String, Object> get(String id) {
        return orders.stream().filter(order -> id.equals(order.get("id"))).findFirst().orElseThrow(() -> new NotFound());
    }

    public synchronized Map<String, Object> save(String id, Map<String, Object> input) throws IOException {
        Map<String, Object> order = validate(input);
        List<Map<String, Object>> next = new ArrayList<>(orders);
        if (id == null) {
            order.put("id", "DH-" + UUID.randomUUID());
            order.put("createdAt", Instant.now().toString());
            next.add(0, order);
        } else {
            Map<String, Object> old = get(id);
            order.put("id", id); order.put("createdAt", old.get("createdAt")); order.put("updatedAt", Instant.now().toString());
            next.set(next.indexOf(old), order);
        }
        persist(next); return order;
    }

    public synchronized void delete(String id) throws IOException {
        Map<String, Object> old = get(id);
        List<Map<String, Object>> next = new ArrayList<>(orders);
        next.remove(old); persist(next);
    }

    private void persist(List<Map<String, Object>> next) throws IOException {
        Path temp = file.resolveSibling(file.getFileName() + ".tmp");
        Files.writeString(temp, Json.stringify(next));
        try { Files.move(temp, file, StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING); }
        catch (java.nio.file.AtomicMoveNotSupportedException error) { Files.move(temp, file, StandardCopyOption.REPLACE_EXISTING); }
        orders = next;
    }

    public static Map<String, Object> validate(Map<String, Object> input) {
        Map<String, Object> order = new LinkedHashMap<>();
        order.put("customerName", text(input.get("customerName"), 150, true));
        order.put("phone", text(input.get("phone"), 30, false));
        order.put("note", text(input.get("note"), 1000, false));
        String status = text(input.get("status"), 20, true);
        if (!List.of("pending", "completed", "cancelled").contains(status)) throw new IllegalArgumentException("Trạng thái không hợp lệ");
        order.put("status", status);
        if (!(input.get("items") instanceof List<?> items) || items.size() != 1) throw new IllegalArgumentException("Cần một sản phẩm");
        Map<String, Object> item = Json.object(items.get(0));
        String name = text(item.get("name"), 200, true);
        long quantity = integer(item.get("quantity"), 1, 10000);
        long price = integer(item.get("price"), 0, 1000000000);
        order.put("items", List.of(Map.of("name", name, "quantity", quantity, "price", price)));
        order.put("total", quantity * price); order.put("currency", "VND");
        return order;
    }

    private static String text(Object value, int max, boolean required) {
        if (value == null && !required) return "";
        if (!(value instanceof String text) || text.length() > max || (required && text.isBlank())) throw new IllegalArgumentException("Thông tin bị thiếu hoặc quá dài");
        return text.trim();
    }
    private static long integer(Object value, long min, long max) {
        try {
            if (!(value instanceof Number)) throw new NumberFormatException();
            long number = new java.math.BigDecimal(value.toString()).longValueExact();
            if (number < min || number > max) throw new NumberFormatException();
            return number;
        } catch (ArithmeticException | NumberFormatException error) { throw new IllegalArgumentException("Số lượng hoặc đơn giá không hợp lệ"); }
    }
    public static final class NotFound extends RuntimeException { }
}
