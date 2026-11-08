package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestGateway(t *testing.T) {
	for _, status := range []int{200, 401, 403, 502} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/demo/proxy/api-test/orders" || r.URL.Query().Get("limit") != "2" {
					t.Errorf("sai route: %s", r.URL)
				}
				if r.Header.Get("x-api-key") != "mrk_test" || r.Header.Get("Authorization") != "" {
					t.Error("sai header xác thực")
				}
				w.WriteHeader(status)
				_, _ = w.Write([]byte(`{"orders":[]}`))
			}))
			defer s.Close()
			err := call(s.Client(), s.URL+"/demo", "api-test", "mrk_test", "/orders?limit=2")
			if (err == nil) != (status == 200) {
				t.Fatalf("status=%d, err=%v", status, err)
			}
		})
	}
}

func TestNoRedirectOrUnsafeConfig(t *testing.T) {
	s := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/unexpected" {
			t.Error("không được theo redirect")
		}
		http.Redirect(w, r, "/unexpected", http.StatusFound)
	}))
	defer s.Close()
	if err := call(s.Client(), s.URL, "api-test", "mrk_test", "/orders"); err == nil {
		t.Fatal("redirect phải trả lỗi")
	}
	for _, path := range []string{"//other.example", "/../admin", "/%2e%2e/admin"} {
		if err := call(s.Client(), s.URL, "api-test", "mrk_test", path); err == nil {
			t.Fatalf("chấp nhận đường dẫn: %s", path)
		}
	}
	if err := call(s.Client(), s.URL, "api-test", "DEMO_ONLY_test", "/orders"); err == nil {
		t.Fatal("không được dùng key demo")
	}
}

func TestPortalEnv(t *testing.T) {
	const key = "MRAPI_API_KEY"
	old, existed := os.LookupEnv(key)
	_ = os.Unsetenv(key)
	t.Cleanup(func() {
		if existed {
			_ = os.Setenv(key, old)
		} else {
			_ = os.Unsetenv(key)
		}
	})
	p := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(p, []byte("# portal export\nMRAPI_API_KEY=mrk_from_portal\n"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := loadEnv(p); err != nil {
		t.Fatal(err)
	}
	if os.Getenv(key) != "mrk_from_portal" {
		t.Fatal("không đọc được key từ file portal")
	}
	t.Setenv(key, "mrk_from_server")
	if err := loadEnv(p); err != nil {
		t.Fatal(err)
	}
	if os.Getenv(key) != "mrk_from_server" {
		t.Fatal("phải ưu tiên biến môi trường server")
	}
}
