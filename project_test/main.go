package main

import (
	"bufio"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// Đọc đúng định dạng .env do portal xuất; biến môi trường hệ thống được ưu tiên.
func loadEnv(path string) error {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		k = strings.TrimSpace(k)
		if !ok || !strings.HasPrefix(k, "MRAPI_") {
			continue
		}
		if _, exists := os.LookupEnv(k); !exists {
			if err := os.Setenv(k, strings.TrimSpace(v)); err != nil {
				return err
			}
		}
	}
	return s.Err()
}

func call(client *http.Client, base, apiID, key, path string) error {
	u, err := url.Parse(strings.TrimRight(base, "/"))
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.ForceQuery || u.Fragment != "" {
		return fmt.Errorf("MRAPI_GATEWAY_URL phải là URL HTTPS, gồm stage, không chứa credentials/query/fragment")
	}
	if apiID == "" || apiID == "YOUR_REGISTERED_API_ID" || strings.ContainsAny(apiID, "/\\.\r\n") {
		return fmt.Errorf("điền MRAPI_API_ID từ API đích đã đăng ký")
	}
	if key == "" || key == "PASTE_YOUR_SECRET_KEY_HERE" || strings.HasPrefix(key, "DEMO_ONLY") {
		return fmt.Errorf("điền API key thật từ portal vào MRAPI_API_KEY")
	}
	if !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") || strings.ContainsAny(path, "\\#\r\n") {
		return fmt.Errorf("đường dẫn phải bắt đầu bằng /, ví dụ /orders?limit=10")
	}
	prefix := u.String() + "/proxy/" + url.PathEscape(apiID) + "/"
	target, err := url.Parse(prefix + strings.TrimPrefix(path, "/"))
	if err != nil {
		return fmt.Errorf("đường dẫn không hợp lệ")
	}
	for _, segment := range strings.Split(target.Path, "/") {
		if segment == "." || segment == ".." {
			return fmt.Errorf("không dùng . hoặc .. trong đường dẫn")
		}
	}
	req, err := http.NewRequest(http.MethodGet, target.String(), nil)
	if err != nil {
		return fmt.Errorf("không tạo được request")
	}
	req.Header.Set("x-api-key", key)
	// Không chuyển key sang URL khác khi gateway trả redirect.
	c := *client
	c.CheckRedirect = func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }
	start := time.Now()
	res, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("không kết nối được gateway; kiểm tra URL, mạng và TLS")
	}
	defer res.Body.Close()
	body, err := io.ReadAll(io.LimitReader(res.Body, 64*1024+1))
	if err != nil {
		return fmt.Errorf("không đọc được phản hồi gateway")
	}
	truncated := len(body) > 64*1024
	if truncated {
		body = body[:64*1024]
	}
	fmt.Printf("HTTP %d | %d ms | region: %s\n", res.StatusCode, time.Since(start).Milliseconds(), res.Header.Get("X-Served-Region"))
	fmt.Println(strings.ReplaceAll(string(body), key, "[API KEY ĐÃ ẨN]"))
	if truncated {
		fmt.Println("(Chỉ hiển thị 64 KiB đầu)")
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("gateway trả HTTP %d", res.StatusCode)
	}
	return nil
}

func main() {
	err := loadEnv(".env")
	if err == nil {
		path := "/orders"
		if len(os.Args) > 1 {
			path = os.Args[1]
		}
		err = call(&http.Client{Timeout: 15 * time.Second}, os.Getenv("MRAPI_GATEWAY_URL"), os.Getenv("MRAPI_API_ID"), os.Getenv("MRAPI_API_KEY"), path)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Lỗi:", err)
		os.Exit(1)
	}
}
