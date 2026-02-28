package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestChannelHandlerMountAndBasicErrors(t *testing.T) {
	t.Parallel()
	h := NewChannelHandler(nil, nil, nil, nil)
	mux := http.NewServeMux()
	h.Mount(mux)

	tests := []struct {
		name   string
		method string
		path   string
		body   string
		status int
	}{
		{name: "inbound missing router", method: http.MethodPost, path: "/api/channels/inbound", body: `{}`, status: http.StatusServiceUnavailable},
		{name: "connect telegram missing stores", method: http.MethodPost, path: "/api/channels/telegram", body: `{}`, status: http.StatusServiceUnavailable},
		{name: "list channels missing db", method: http.MethodGet, path: "/api/channels", status: http.StatusServiceUnavailable},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			w := httptest.NewRecorder()
			mux.ServeHTTP(w, req)
			if w.Code != tt.status {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tt.status, w.Body.String())
			}
		})
	}
}
