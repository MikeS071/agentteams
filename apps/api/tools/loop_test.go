package tools

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
)

func TestRunToolLoop(t *testing.T) {
	tests := []struct {
		name      string
		apiKey    string
		transport roundTripFunc
		wantErr   bool
		want      string
	}{
		{
			name:   "final response no tool call",
			apiKey: "k",
			transport: func(req *http.Request) (*http.Response, error) {
				body := `{"choices":[{"message":{"content":"done"},"finish_reason":"stop"}]}`
				return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
			},
			want: "done",
		},
		{
			name:   "tool call then final",
			apiKey: "k",
			transport: sequenceTransport([]string{
				`{"choices":[{"message":{"tool_calls":[{"id":"c1","type":"function","function":{"name":"memory_store","arguments":"{\"key\":\"k\",\"content\":\"v\",\"category\":\"note\"}"}}]},"finish_reason":"tool_calls"}]}`,
				`{"choices":[{"message":{"content":"after tool"},"finish_reason":"stop"}]}`,
			}),
			want: "after tool",
		},
		{
			name:    "missing api key",
			apiKey:  "",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			if tt.apiKey == "" {
				_ = os.Unsetenv("OPENAI_API_KEY")
			} else {
				_ = os.Setenv("OPENAI_API_KEY", tt.apiKey)
			}
			t.Cleanup(func() { _ = os.Unsetenv("OPENAI_API_KEY") })

			reg := NewRegistry()
			cfg := LoopConfig{Model: "openai/gpt-4.1-mini", TenantID: "t1", HTTPClient: &http.Client{Transport: tt.transport}, MaxIterations: 2}
			if tt.transport == nil {
				cfg.HTTPClient = &http.Client{}
			}
			out, err := RunToolLoop(context.Background(), reg, cfg, []Message{{Role: "user", Content: "hi"}}, reg.GetTools("research"))
			if (err != nil) != tt.wantErr {
				t.Fatalf("RunToolLoop err=%v wantErr=%v", err, tt.wantErr)
			}
			if tt.want != "" && out != tt.want {
				t.Fatalf("RunToolLoop output=%q want=%q", out, tt.want)
			}
		})
	}
}

func TestMapModelAndTruncate(t *testing.T) {
	t.Parallel()
	if got := mapModel("openai/gpt-4.1-mini"); got != "gpt-4.1-mini" {
		t.Fatalf("mapModel mini = %s", got)
	}
	if got := mapModel("unknown"); got != "gpt-4.1-mini" {
		t.Fatalf("mapModel default = %s", got)
	}
	if got := truncate("abcdef", 3); got != "abc..." {
		t.Fatalf("truncate=%q", got)
	}
}

func sequenceTransport(bodies []string) roundTripFunc {
	i := 0
	return func(*http.Request) (*http.Response, error) {
		if i >= len(bodies) {
			return &http.Response{StatusCode: 500, Body: io.NopCloser(strings.NewReader("{}")), Header: make(http.Header)}, nil
		}
		body := bodies[i]
		i++
		if !json.Valid([]byte(body)) {
			body = `{}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
	}
}
