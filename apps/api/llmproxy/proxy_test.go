package llmproxy

import (
	"bytes"
	"database/sql"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestNewProxy(t *testing.T) {
	t.Parallel()
	p := NewProxy(nil, &ModelRegistry{}, nil)
	if p == nil || p.Client == nil {
		t.Fatalf("NewProxy() returned nil fields")
	}
}

func TestProxyHandleChatCompletions(t *testing.T) {
	tests := []struct {
		name       string
		body       string
		tenantID   string
		registry   *ModelRegistry
		setupDB    func(sqlmock.Sqlmock)
		client     *http.Client
		wantStatus int
		wantBody   string
	}{
		{
			name:       "missing tenant header",
			body:       `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`,
			registry:   &ModelRegistry{models: map[string]*Model{}},
			wantStatus: http.StatusUnauthorized,
			wantBody:   "missing X-Tenant-ID",
		},
		{
			name:       "bad model",
			body:       `{"model":"missing","messages":[{"role":"user","content":"hi"}]}`,
			tenantID:   "t1",
			registry:   &ModelRegistry{models: map[string]*Model{}},
			wantStatus: http.StatusBadRequest,
			wantBody:   "model not found",
		},
		{
			name:     "insufficient credits returns 402",
			body:     `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`,
			tenantID: "t1",
			registry: &ModelRegistry{models: map[string]*Model{"gpt-4o": {ID: "gpt-4o", Provider: "openai"}}},
			setupDB: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"balance_cents"}).AddRow(0)
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("t1").WillReturnRows(rows)
			},
			wantStatus: http.StatusPaymentRequired,
			wantBody:   "Insufficient credits",
		},
		{
			name:     "upstream unauthorized no api key",
			body:     `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`,
			tenantID: "t1",
			registry: &ModelRegistry{models: map[string]*Model{"gpt-4o": {ID: "gpt-4o", Provider: "openai"}}},
			setupDB: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("t1").WillReturnRows(sqlmock.NewRows([]string{"balance_cents"}).AddRow(100))
			},
			client: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				if strings.TrimSpace(req.Header.Get("Authorization")) == "Bearer" {
					return &http.Response{StatusCode: http.StatusUnauthorized, Body: io.NopCloser(strings.NewReader(`{"error":"no key"}`)), Header: make(http.Header)}, nil
				}
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"usage":{"prompt_tokens":1,"completion_tokens":1}}`)), Header: make(http.Header)}, nil
			})},
			wantStatus: http.StatusBadGateway,
			wantBody:   "upstream error",
		},
		{
			name:     "timeout response",
			body:     `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`,
			tenantID: "t1",
			registry: &ModelRegistry{models: map[string]*Model{"gpt-4o": {ID: "gpt-4o", Provider: "openai"}}},
			setupDB: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("t1").WillReturnRows(sqlmock.NewRows([]string{"balance_cents"}).AddRow(100))
			},
			client: &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
				return nil, errors.New("timeout")
			})},
			wantStatus: http.StatusBadGateway,
			wantBody:   "timeout",
		},
		{
			name:     "successful route and billing",
			body:     `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`,
			tenantID: "t1",
			registry: &ModelRegistry{models: map[string]*Model{"gpt-4o": {ID: "gpt-4o", Provider: "openai", ProviderCostInputM: 100, ProviderCostOutputM: 100, MarkupPct: 0}}},
			setupDB: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("t1").WillReturnRows(sqlmock.NewRows([]string{"balance_cents"}).AddRow(100))
				mock.ExpectBegin()
				mock.ExpectExec("INSERT INTO usage_logs").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("UPDATE credits SET balance_cents").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("t1").WillReturnRows(sqlmock.NewRows([]string{"balance_cents"}).AddRow(50))
			},
			client: &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
				return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader(`{"id":"1","choices":[{"message":{"role":"assistant","content":"ok"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1000,"completion_tokens":1000}}`)), Header: make(http.Header)}, nil
			})},
			wantStatus: http.StatusOK,
			wantBody:   "choices",
		},
	}

	_ = os.Unsetenv("OPENAI_API_KEY")

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			var (
				db   = (*sql.DB)(nil)
				mock sqlmock.Sqlmock
				err  error
			)
			if tt.setupDB != nil {
				db, mock, err = sqlmock.New()
				if err != nil {
					t.Fatalf("sqlmock.New: %v", err)
				}
				defer db.Close()
				tt.setupDB(mock)
			}

			proxy := &Proxy{DB: db, Registry: tt.registry, Client: tt.client}
			if proxy.Client == nil {
				proxy.Client = &http.Client{}
			}

			req := httptest.NewRequest(http.MethodPost, "/v1/chat/completions", bytes.NewBufferString(tt.body))
			if tt.tenantID != "" {
				req.Header.Set("X-Tenant-ID", tt.tenantID)
			}
			w := httptest.NewRecorder()
			proxy.handleChatCompletions(w, req)

			resp := w.Result()
			if resp.StatusCode != tt.wantStatus {
				t.Fatalf("status = %d, want %d body=%s", resp.StatusCode, tt.wantStatus, w.Body.String())
			}
			if tt.wantBody != "" && !strings.Contains(w.Body.String(), tt.wantBody) {
				t.Fatalf("body %q does not contain %q", w.Body.String(), tt.wantBody)
			}
			if mock != nil {
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatalf("expectations: %v", err)
				}
			}
		})
	}
}
