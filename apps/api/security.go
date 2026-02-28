package main

import (
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

const maxRequestBodyBytes int64 = 1 << 20 // 1 MiB

func applyRequestBodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodPost, http.MethodPut, http.MethodPatch:
			r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)
		}
		next.ServeHTTP(w, r)
	})
}

func applyAuth(next http.Handler) http.Handler {
	serviceAPIKey := strings.TrimSpace(os.Getenv("SERVICE_API_KEY"))
	jwtSecret := strings.TrimSpace(os.Getenv("API_JWT_SECRET"))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !isProtectedPath(r.URL.Path) {
			next.ServeHTTP(w, r)
			return
		}

		if serviceAPIKey == "" && jwtSecret == "" {
			writeAPIError(w, http.StatusInternalServerError, "API auth is not configured")
			return
		}

		if serviceAPIKey != "" {
			incomingKey := strings.TrimSpace(r.Header.Get("X-Service-API-Key"))
			if incomingKey != "" && subtle.ConstantTimeCompare([]byte(incomingKey), []byte(serviceAPIKey)) == 1 {
				next.ServeHTTP(w, r)
				return
			}
		}

		if jwtSecret != "" {
			token := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
			if token != "" {
				if err := validateJWT(token, jwtSecret); err == nil {
					next.ServeHTTP(w, r)
					return
				}
			}
		}

		writeAPIError(w, http.StatusUnauthorized, "Unauthorized")
	})
}

func isProtectedPath(path string) bool {
	if path == "/" || path == "/health" {
		return false
	}
	return strings.HasPrefix(path, "/api/") || strings.HasPrefix(path, "/v1/")
}

func validateJWT(tokenString, secret string) error {
	token, err := jwt.Parse(tokenString, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(secret), nil
	})
	if err != nil {
		return err
	}
	if !token.Valid {
		return errors.New("invalid token")
	}
	return nil
}
