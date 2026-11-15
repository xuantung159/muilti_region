import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** JSON nhỏ gọn cho demo, dùng Java thuần và không cần thư viện ngoài. */
public final class Json {
    @SuppressWarnings("unchecked")
    public static Map<String, Object> object(Object value) {
        if (!(value instanceof Map<?, ?>)) throw new IllegalArgumentException("Can JSON object");
        return (Map<String, Object>) value;
    }

    public static Object parse(String text) {
        Parser parser = new Parser(text);
        Object value = parser.value(0);
        parser.space();
        if (parser.pos != text.length()) throw new IllegalArgumentException("JSON du du lieu");
        return value;
    }

    public static String stringify(Object value) {
        if (value == null) return "null";
        if (value instanceof String text) {
            StringBuilder result = new StringBuilder("\"");
            for (char c : text.toCharArray()) {
                switch (c) {
                    case '"' -> result.append("\\\"");
                    case '\\' -> result.append("\\\\");
                    case '\n' -> result.append("\\n");
                    case '\r' -> result.append("\\r");
                    case '\t' -> result.append("\\t");
                    default -> { if (c < 32) result.append(String.format("\\u%04x", (int) c)); else result.append(c); }
                }
            }
            return result.append('"').toString();
        }
        if (value instanceof Number || value instanceof Boolean) return value.toString();
        if (value instanceof Map<?, ?> map) {
            List<String> pairs = new ArrayList<>();
            map.forEach((key, item) -> pairs.add(stringify(key.toString()) + ":" + stringify(item)));
            return "{" + String.join(",", pairs) + "}";
        }
        if (value instanceof List<?> list) return "[" + String.join(",", list.stream().map(Json::stringify).toList()) + "]";
        throw new IllegalArgumentException("Kieu JSON khong ho tro");
    }

    private static final class Parser {
        final String text;
        int pos;
        Parser(String text) { this.text = text; }
        void space() { while (pos < text.length() && " \r\n\t".indexOf(text.charAt(pos)) >= 0) pos++; }
        boolean take(char c) { space(); if (pos < text.length() && text.charAt(pos) == c) { pos++; return true; } return false; }
        void expect(char c) { if (!take(c)) throw new IllegalArgumentException("JSON khong hop le"); }
        Object value(int depth) {
            if (depth > 50) throw new IllegalArgumentException("JSON qua sau");
            space();
            if (pos >= text.length()) throw new IllegalArgumentException("JSON thieu du lieu");
            char c = text.charAt(pos);
            if (c == '"') return string();
            if (take('{')) {
                Map<String, Object> map = new LinkedHashMap<>();
                if (take('}')) return map;
                do { String key = string(); expect(':'); map.put(key, value(depth + 1)); } while (take(','));
                expect('}'); return map;
            }
            if (take('[')) {
                List<Object> list = new ArrayList<>();
                if (take(']')) return list;
                do { list.add(value(depth + 1)); } while (take(','));
                expect(']'); return list;
            }
            for (String literal : List.of("true", "false", "null")) {
                if (text.startsWith(literal, pos)) { pos += literal.length(); return literal.equals("null") ? null : Boolean.valueOf(literal); }
            }
            int start = pos;
            if (text.charAt(pos) == '-') pos++;
            if (pos >= text.length()) throw new IllegalArgumentException("JSON number");
            if (text.charAt(pos) == '0') pos++;
            else { int digits = pos; while (pos < text.length() && Character.isDigit(text.charAt(pos))) pos++; if (digits == pos) throw new IllegalArgumentException("JSON number"); }
            if (pos < text.length() && text.charAt(pos) == '.') {
                pos++; int digits = pos; while (pos < text.length() && Character.isDigit(text.charAt(pos))) pos++; if (digits == pos) throw new IllegalArgumentException("JSON number");
            }
            if (pos < text.length() && "eE".indexOf(text.charAt(pos)) >= 0) {
                pos++; if (pos < text.length() && "+-".indexOf(text.charAt(pos)) >= 0) pos++;
                int digits = pos; while (pos < text.length() && Character.isDigit(text.charAt(pos))) pos++; if (digits == pos) throw new IllegalArgumentException("JSON number");
            }
            return new java.math.BigDecimal(text.substring(start, pos));
        }
        String string() {
            expect('"'); StringBuilder result = new StringBuilder();
            while (pos < text.length()) {
                char c = text.charAt(pos++);
                if (c == '"') return result.toString();
                if (c < 32) throw new IllegalArgumentException("JSON string");
                if (c != '\\') { result.append(c); continue; }
                if (pos >= text.length()) throw new IllegalArgumentException("JSON escape");
                char escaped = text.charAt(pos++);
                switch (escaped) {
                    case '"', '\\', '/' -> result.append(escaped);
                    case 'b' -> result.append('\b'); case 'f' -> result.append('\f');
                    case 'n' -> result.append('\n'); case 'r' -> result.append('\r'); case 't' -> result.append('\t');
                    case 'u' -> { if (pos + 4 > text.length()) throw new IllegalArgumentException("JSON unicode"); result.append((char) Integer.parseInt(text.substring(pos, pos + 4), 16)); pos += 4; }
                    default -> throw new IllegalArgumentException("JSON escape");
                }
            }
            throw new IllegalArgumentException("JSON string chua dong");
        }
    }
}
