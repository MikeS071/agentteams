package orchestrator

import (
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCheckOpenFangHealth(t *testing.T) {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/health" {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer ts.Close()

	host, port, err := splitHostPort(ts.Listener.Addr().String())
	if err != nil {
		t.Fatalf("splitHostPort() error = %v", err)
	}

	if ok := CheckOpenFangHealth(host, port); !ok {
		t.Fatal("CheckOpenFangHealth() = false, want true")
	}
	if ok := CheckOpenFangHealth(host, port+1); ok {
		t.Fatal("CheckOpenFangHealth() on closed port = true, want false")
	}
}

func splitHostPort(addr string) (string, int, error) {
	host, rawPort, err := net.SplitHostPort(addr)
	if err != nil {
		return "", 0, err
	}
	var port int
	if _, err := fmt.Sscanf(rawPort, "%d", &port); err != nil {
		return "", 0, err
	}
	return host, port, nil
}
