package main

import (
	"encoding/json"
	"log"
	"net/http"
	"time"
)

func routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok", "service": "project-test"})
	})
	mux.HandleFunc("GET /orders", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"orders": []map[string]any{{"id": "TEST-001", "total": 250000, "currency": "VND"}}, "source": "project_test"})
	})
	return mux
}

func main() {
	server := &http.Server{Addr: "127.0.0.1:8080", Handler: routes(), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 10 * time.Second, IdleTimeout: 30 * time.Second}
	log.Println("Test backend: http://127.0.0.1:8080/orders")
	log.Fatal(server.ListenAndServe())
}
