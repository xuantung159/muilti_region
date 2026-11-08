package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRoutes(t *testing.T) {
	for _, path := range []string{"/health", "/orders"} {
		w := httptest.NewRecorder()
		routes().ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 200 || !strings.Contains(w.Header().Get("Content-Type"), "application/json") {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	routes().ServeHTTP(w, httptest.NewRequest("GET", "/.env", nil))
	if w.Code != 404 {
		t.Fatal("không được phục vụ file cấu hình")
	}
}
