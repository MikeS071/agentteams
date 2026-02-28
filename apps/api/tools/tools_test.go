package tools

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestNewRegistryAndGetTools(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	if len(r.GetTools("research")) < 3 {
		t.Fatalf("expected research tools")
	}
	if len(r.GetTools("unknown")) == 0 {
		t.Fatalf("expected default tools")
	}
}

func TestExecuteUnknownTool(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	if _, err := r.Execute(context.Background(), "missing", nil); err == nil {
		t.Fatalf("expected unknown tool error")
	}
}

func TestWebFetch(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if req.URL.Path == "/404" {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("<html><body><main>Hello <b>world</b></main></body></html>"))
	}))
	defer ts.Close()

	tests := []struct {
		name    string
		args    string
		wantErr bool
		want    string
	}{
		{name: "happy path", args: `{"url":"` + ts.URL + `"}`, want: "Hello world"},
		{name: "http error status", args: `{"url":"` + ts.URL + `/404"}`, want: "HTTP 404"},
		{name: "missing url", args: `{}`, wantErr: true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			out, err := r.handleWebFetch(context.Background(), json.RawMessage(tt.args))
			if (err != nil) != tt.wantErr {
				t.Fatalf("handleWebFetch err=%v wantErr=%v", err, tt.wantErr)
			}
			if tt.want != "" && !strings.Contains(out, tt.want) {
				t.Fatalf("output %q missing %q", out, tt.want)
			}
		})
	}
}

func TestWebSearch(t *testing.T) {
	t.Parallel()
	r := NewRegistry()

	t.Cleanup(func() { _ = os.Unsetenv("BRAVE_API_KEY") })
	_ = os.Setenv("BRAVE_API_KEY", "k")
	r.client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.Host, "api.search.brave.com") {
			body := `{"web":{"results":[{"title":"A","url":"https://a","description":"d"}]}}`
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("")), Header: make(http.Header)}, nil
	})}

	out, err := r.handleWebSearch(context.Background(), json.RawMessage(`{"query":"golang","count":1}`))
	if err != nil {
		t.Fatalf("handleWebSearch: %v", err)
	}
	if !strings.Contains(out, "https://a") {
		t.Fatalf("unexpected output: %s", out)
	}

	if _, err := r.handleWebSearch(context.Background(), json.RawMessage(`{"count":1}`)); err == nil {
		t.Fatalf("expected query required error")
	}
}

func TestMemoryStoreRecall(t *testing.T) {
	t.Parallel()
	r := NewRegistry()
	ctx := WithMemoryContext(context.Background(), "t1", "c1")
	workingMemory = map[string]map[string]string{}

	if _, err := r.handleMemoryStore(ctx, json.RawMessage(`{"key":"k1","content":"hello","category":"note"}`)); err != nil {
		t.Fatalf("handleMemoryStore: %v", err)
	}

	out, err := r.handleMemoryRecall(ctx, json.RawMessage(`{"key":"k1"}`))
	if err != nil {
		t.Fatalf("handleMemoryRecall: %v", err)
	}
	if !strings.Contains(out, "hello") {
		t.Fatalf("unexpected memory recall: %s", out)
	}

	list, err := r.handleMemoryRecall(ctx, json.RawMessage(`{"key":"*"}`))
	if err != nil {
		t.Fatalf("list memory: %v", err)
	}
	if !strings.Contains(list, "k1") {
		t.Fatalf("expected key listing, got: %s", list)
	}
}
