// JDK 17+, run: java Main.java. No Maven or external libraries.
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;

public class Main {
    public static void main(String[] args) {
        try {
            Map<String, String> config = new HashMap<>();
            Path env = Path.of(".env");
            if (Files.exists(env)) {
                for (String line : Files.readAllLines(env, StandardCharsets.UTF_8)) {
                    String[] pair = line.replace("\uFEFF", "").split("=", 2);
                    if (pair.length == 2 && pair[0].trim().startsWith("MRAPI_"))
                        config.put(pair[0].trim(), pair[1].trim());
                }
            }
            config.putAll(System.getenv());
            String base = config.getOrDefault("MRAPI_GATEWAY_URL", "").replaceAll("/+$", "");
            String apiId = config.getOrDefault("MRAPI_API_ID", "");
            String key = config.getOrDefault("MRAPI_API_KEY", "");
            URI origin = URI.create(base);
            if (!"https".equals(origin.getScheme()) || origin.getHost() == null ||
                origin.getUserInfo() != null || origin.getQuery() != null || origin.getFragment() != null ||
                !apiId.matches("[A-Za-z0-9_-]+") || !key.startsWith("mrk_"))
                throw new IllegalArgumentException("Invalid config");
            HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(15)).build();
            HttpRequest request = HttpRequest.newBuilder(URI.create(base + "/proxy/" + apiId + "/todos/1"))
                .header("x-api-key", key).timeout(Duration.ofSeconds(15)).GET().build();
            long start = System.nanoTime();
            HttpResponse<InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            try (InputStream stream = response.body()) {
                String body = new String(stream.readNBytes(65536), StandardCharsets.UTF_8).replace(key, "[API KEY ĐÃ ẨN]");
                System.out.printf("HTTP %d | %d ms | region: %s%n", response.statusCode(),
                    (System.nanoTime() - start) / 1_000_000, response.headers().firstValue("x-served-region").orElse(""));
                System.out.println(body);
            }
            if (response.statusCode() < 200 || response.statusCode() >= 300) System.exit(1);
        } catch (Exception error) {
            System.err.println("Lỗi: kiểm tra .env, URL gateway, kết nối mạng và TLS.");
            System.exit(1);
        }
    }
}
