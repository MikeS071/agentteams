package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminHandlerMountAndEndpointsWithNilDB(t *testing.T) {
	t.Parallel()
	h := NewAdminHandler(nil, nil)
	mux := http.NewServeMux()
	h.Mount(mux)

	paths := []string{
		"/api/admin/tenants",
		"/api/admin/tenants/t1",
		"/api/admin/stats",
		"/api/admin/models",
	}

	for _, p := range paths {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, req)
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("path %s expected 503 got %d body=%s", p, w.Code, w.Body.String())
		}
	}
}
