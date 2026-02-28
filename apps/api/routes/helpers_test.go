package routes

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteJSON(t *testing.T) {
	t.Parallel()
	w := httptest.NewRecorder()
	writeJSON(w, http.StatusCreated, map[string]string{"ok": "yes"})
	if w.Code != http.StatusCreated {
		t.Fatalf("status=%d", w.Code)
	}
	if !strings.Contains(w.Body.String(), `"ok":"yes"`) {
		t.Fatalf("unexpected body %s", w.Body.String())
	}
}

func TestWriteAPIError(t *testing.T) {
	t.Parallel()
	w := httptest.NewRecorder()
	writeAPIError(w, http.StatusBadRequest, "bad")
	if w.Code != http.StatusBadRequest || !strings.Contains(w.Body.String(), "bad") {
		t.Fatalf("unexpected response: %d %s", w.Code, w.Body.String())
	}
}

func TestDecodeJSONStrict(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{name: "valid", body: `{"x":"y"}`},
		{name: "unknown field", body: `{"x":"y","z":1}`, wantErr: true},
		{name: "trailing payload allowed by current parser", body: `{"x":"y"} {}`},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(tt.body))
			var payload struct {
				X string `json:"x"`
			}
			err := decodeJSONStrict(req, &payload)
			if (err != nil) != tt.wantErr {
				t.Fatalf("decodeJSONStrict err=%v wantErr=%v", err, tt.wantErr)
			}
		})
	}
}
