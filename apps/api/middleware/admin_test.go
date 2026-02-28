package middleware

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/golang-jwt/jwt/v5"
)

func TestApplyAdmin(t *testing.T) {
	tests := []struct {
		name       string
		path       string
		secret     string
		token      string
		wantStatus int
		wantNext   bool
	}{
		{name: "non admin path bypassed", path: "/health", secret: "s", wantStatus: 200, wantNext: true},
		{name: "missing session", path: "/api/admin/tenants", secret: "s", wantStatus: 403},
		{name: "valid admin role", path: "/api/admin/tenants", secret: "s", token: signedToken(t, "s", jwt.MapClaims{"sub": "1", "email": "a@b.com", "role": "admin"}), wantStatus: 200, wantNext: true},
		{name: "non admin blocked", path: "/api/admin/tenants", secret: "s", token: signedToken(t, "s", jwt.MapClaims{"sub": "1", "email": "u@b.com", "role": "member"}), wantStatus: 403},
		{name: "allowlist email", path: "/api/admin/tenants", secret: "s", token: signedToken(t, "s", jwt.MapClaims{"sub": "1", "email": "michal.szalinski@gmail.com"}), wantStatus: 200, wantNext: true},
		{name: "missing secret config", path: "/api/admin/tenants", secret: "", token: "abc", wantStatus: 500},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			_ = os.Setenv("API_JWT_SECRET", tt.secret)
			t.Cleanup(func() { _ = os.Unsetenv("API_JWT_SECRET") })

			nextCalled := false
			h := ApplyAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				nextCalled = true
				if identity, ok := AdminFromContext(r.Context()); ok {
					_ = json.NewEncoder(w).Encode(identity)
					return
				}
				w.WriteHeader(http.StatusOK)
			}))

			req := httptest.NewRequest(http.MethodGet, tt.path, nil)
			if tt.token != "" {
				req.Header.Set("Authorization", "Bearer "+tt.token)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != tt.wantStatus {
				t.Fatalf("status = %d, want %d body=%s", w.Code, tt.wantStatus, w.Body.String())
			}
			if nextCalled != tt.wantNext {
				t.Fatalf("nextCalled=%v want %v", nextCalled, tt.wantNext)
			}
		})
	}
}

func TestAdminFromContextMissing(t *testing.T) {
	t.Parallel()
	if _, ok := AdminFromContext((httptest.NewRequest(http.MethodGet, "/", nil)).Context()); ok {
		t.Fatalf("expected no admin identity")
	}
}

func signedToken(t *testing.T, secret string, claims jwt.MapClaims) string {
	t.Helper()
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	s, err := tok.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("SignedString: %v", err)
	}
	return s
}
