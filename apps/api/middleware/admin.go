package middleware

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

var adminEmailAllowlist = map[string]struct{}{
	"michal.szalinski@gmail.com": {},
}

type adminContextKey string

const adminIdentityContextKey adminContextKey = "admin_identity"

// AdminIdentity is extracted from a verified JWT and attached to request context.
type AdminIdentity struct {
	ID      string `json:"id"`
	Email   string `json:"email"`
	Role    string `json:"role"`
	IsAdmin bool   `json:"is_admin"`
}

// ApplyAdmin enforces admin-only access on /api/admin/* routes.
func ApplyAdmin(next http.Handler) http.Handler {
	jwtSecret := strings.TrimSpace(os.Getenv("API_JWT_SECRET"))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isAdminPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		if jwtSecret == "" {
			writeError(w, http.StatusInternalServerError, "admin auth is not configured")
			return
		}

		tokenString := bearerToken(r.Header.Get("Authorization"))
		if tokenString == "" {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}

		claims, err := parseJWTClaims(tokenString, jwtSecret)
		if err != nil {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}

		identity := adminIdentityFromClaims(claims)
		if !isAdminClaims(identity, claims) {
			writeError(w, http.StatusForbidden, "forbidden")
			return
		}

		ctx := context.WithValue(r.Context(), adminIdentityContextKey, identity)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// AdminFromContext returns the admin identity injected by ApplyAdmin.
func AdminFromContext(ctx context.Context) (AdminIdentity, bool) {
	identity, ok := ctx.Value(adminIdentityContextKey).(AdminIdentity)
	return identity, ok
}

func isAdminPath(path string) bool {
	return path == "/api/admin" || strings.HasPrefix(path, "/api/admin/")
}

func bearerToken(header string) string {
	header = strings.TrimSpace(header)
	if header == "" {
		return ""
	}
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return strings.TrimSpace(parts[1])
}

func parseJWTClaims(tokenString, secret string) (jwt.MapClaims, error) {
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256", "HS384", "HS512"}))
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

func adminIdentityFromClaims(claims jwt.MapClaims) AdminIdentity {
	email := strings.ToLower(strings.TrimSpace(firstStringClaim(claims, "email", "upn")))
	role := strings.ToLower(strings.TrimSpace(firstStringClaim(claims, "role")))

	return AdminIdentity{
		ID:      strings.TrimSpace(firstStringClaim(claims, "sub", "user_id", "userId")),
		Email:   email,
		Role:    role,
		IsAdmin: boolClaim(claims, "is_admin") || boolClaim(claims, "isAdmin"),
	}
}

func isAdminClaims(identity AdminIdentity, claims jwt.MapClaims) bool {
	if identity.IsAdmin {
		return true
	}

	if isAdminRole(identity.Role) {
		return true
	}

	if hasAdminRoleClaim(claims) {
		return true
	}

	_, allowlisted := adminEmailAllowlist[identity.Email]
	return allowlisted
}

func hasAdminRoleClaim(claims jwt.MapClaims) bool {
	rolesValue, ok := claims["roles"]
	if !ok {
		return false
	}

	switch roles := rolesValue.(type) {
	case []any:
		for _, raw := range roles {
			if isAdminRole(strings.TrimSpace(strings.ToLower(toString(raw)))) {
				return true
			}
		}
	case []string:
		for _, role := range roles {
			if isAdminRole(strings.TrimSpace(strings.ToLower(role))) {
				return true
			}
		}
	case string:
		for _, role := range strings.Split(roles, ",") {
			if isAdminRole(strings.TrimSpace(strings.ToLower(role))) {
				return true
			}
		}
	}

	return false
}

func isAdminRole(role string) bool {
	switch role {
	case "admin", "platform_admin", "platform-admin", "super_admin", "super-admin", "superadmin":
		return true
	default:
		return false
	}
}

func firstStringClaim(claims jwt.MapClaims, keys ...string) string {
	for _, key := range keys {
		if value, ok := claims[key]; ok {
			if str := strings.TrimSpace(toString(value)); str != "" {
				return str
			}
		}
	}
	return ""
}

func boolClaim(claims jwt.MapClaims, key string) bool {
	value, ok := claims[key]
	if !ok {
		return false
	}

	switch typed := value.(type) {
	case bool:
		return typed
	case float64:
		return typed != 0
	case string:
		v := strings.TrimSpace(strings.ToLower(typed))
		return v == "1" || v == "true" || v == "yes"
	default:
		return false
	}
}

func toString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return fmt.Sprintf("%.0f", typed)
	case bool:
		if typed {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
