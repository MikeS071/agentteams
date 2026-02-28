package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDeployHandlerNilDB(t *testing.T) {
	t.Parallel()
	h := NewDeployHandler(nil)
	mux := http.NewServeMux()
	h.Mount(mux)

	tests := []struct {
		method string
		path   string
		body   string
	}{
		{method: http.MethodPost, path: "/api/deploy/vercel", body: `{}`},
		{method: http.MethodPost, path: "/api/deploy/supabase", body: `{}`},
		{method: http.MethodGet, path: "/api/deploy/status/abc", body: ``},
	}
	for _, tt := range tests {
		req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("%s %s: status=%d", tt.method, tt.path, w.Code)
		}
	}
}

func TestDeployValidationErrors(t *testing.T) {
	t.Parallel()
	h := NewDeployHandler(nil)

	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/deploy/vercel", strings.NewReader("{bad"))
	h.handleDeployVercel(w, req)
	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("status=%d", w.Code)
	}
}
