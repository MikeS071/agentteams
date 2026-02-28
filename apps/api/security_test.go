package main

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestApplyRequestBodyLimit(t *testing.T) {
	t.Parallel()
	h := applyRequestBodyLimit(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, err := r.Body.Read(make([]byte, maxRequestBodyBytes+10))
		if err != nil && strings.Contains(err.Error(), "http: request body too large") {
			w.WriteHeader(http.StatusRequestEntityTooLarge)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodPost, "/api/x", strings.NewReader(strings.Repeat("a", int(maxRequestBodyBytes)+10)))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status=%d", w.Code)
	}
}

func TestApplyAuth(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		serviceKey string
		jwtSecret  string
		headers    map[string]string
		wantStatus int
		wantNext   bool
	}{
		{name: "public path", path: "/health", wantStatus: 200, wantNext: true},
		{name: "missing config", path: "/api/x", wantStatus: 500},
		{name: "service api key", path: "/api/x", serviceKey: "k1", headers: map[string]string{"X-Service-API-Key": "k1"}, wantStatus: 200, wantNext: true},
		{name: "jwt auth", path: "/api/x", jwtSecret: "s1", headers: map[string]string{"Authorization": "Bearer " + signJWT(t, "s1")}, wantStatus: 200, wantNext: true},
		{name: "unauthorized", path: "/api/x", serviceKey: "k1", headers: map[string]string{"X-Service-API-Key": "bad"}, wantStatus: 401},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			if tt.serviceKey == "" {
				_ = os.Unsetenv("SERVICE_API_KEY")
			} else {
				_ = os.Setenv("SERVICE_API_KEY", tt.serviceKey)
			}
			if tt.jwtSecret == "" {
				_ = os.Unsetenv("API_JWT_SECRET")
			} else {
				_ = os.Setenv("API_JWT_SECRET", tt.jwtSecret)
			}
			t.Cleanup(func() {
				_ = os.Unsetenv("SERVICE_API_KEY")
				_ = os.Unsetenv("API_JWT_SECRET")
			})

			next := false
			h := applyAuth(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				next = true
				w.WriteHeader(http.StatusOK)
			}))
			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			for k, v := range tt.headers {
				req.Header.Set(k, v)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != tt.wantStatus {
				t.Fatalf("status=%d want=%d", w.Code, tt.wantStatus)
			}
			if next != tt.wantNext {
				t.Fatalf("next=%v want=%v", next, tt.wantNext)
			}
		})
	}
}

func TestIsProtectedPathAndValidateJWT(t *testing.T) {
	t.Parallel()
	if isProtectedPath("/") || isProtectedPath("/health") || isProtectedPath("/api/channels/telegram/webhook") {
		t.Fatalf("public paths should be unprotected")
	}
	if !isProtectedPath("/api/tenants") {
		t.Fatalf("expected protected api path")
	}
	if err := validateJWT(signJWT(t, "s"), "s"); err != nil {
		t.Fatalf("validateJWT: %v", err)
	}
	if err := validateJWT("bad", "s"); err == nil {
		t.Fatalf("expected invalid jwt error")
	}
}

func signJWT(t *testing.T, secret string) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{"sub": "u1"})
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return s
}
