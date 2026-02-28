package routes

import (
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/agentteams/api/orchestrator"
	"github.com/golang-jwt/jwt/v5"
)

// MountTenantRoutes registers tenant lifecycle routes.
func MountTenantRoutes(mux *http.ServeMux, db *sql.DB, orch orchestrator.TenantOrchestrator, serviceAPIKey, jwtSecret string) {
	mux.HandleFunc("POST /api/tenants/{id}/start", func(w http.ResponseWriter, r *http.Request) {
		if orch == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
			return
		}

		tenantID := strings.TrimSpace(r.PathValue("id"))
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id")
			return
		}

		if err := orch.StartTenant(r.Context(), tenantID); err != nil {
			writeAPIError(w, statusFromError(err), err.Error())
			return
		}

		status, err := orch.GetStatus(r.Context(), tenantID)
		if err != nil {
			writeAPIError(w, statusFromError(err), err.Error())
			return
		}

		writeJSON(w, http.StatusOK, status)
	})

	mux.HandleFunc("POST /api/tenants/{id}/stop", func(w http.ResponseWriter, r *http.Request) {
		if orch == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
			return
		}

		tenantID := strings.TrimSpace(r.PathValue("id"))
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id")
			return
		}

		if err := orch.StopTenant(r.Context(), tenantID); err != nil {
			writeAPIError(w, statusFromError(err), err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "stopped"})
	})

	mux.HandleFunc("DELETE /api/tenants/{id}", func(w http.ResponseWriter, r *http.Request) {
		if orch == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
			return
		}

		tenantID := strings.TrimSpace(r.PathValue("id"))
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id")
			return
		}

		if err := orch.DestroyTenant(r.Context(), tenantID); err != nil {
			writeAPIError(w, statusFromError(err), err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("GET /api/tenants/{id}/status", func(w http.ResponseWriter, r *http.Request) {
		if orch == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
			return
		}

		tenantID := strings.TrimSpace(r.PathValue("id"))
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id")
			return
		}

		status, err := orch.GetStatus(r.Context(), tenantID)
		if err != nil {
			writeAPIError(w, statusFromError(err), err.Error())
			return
		}

		writeJSON(w, http.StatusOK, status)
	})

	mux.HandleFunc("GET /api/tenants", func(w http.ResponseWriter, r *http.Request) {
		if orch == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
			return
		}
		if db == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "database is not configured")
			return
		}
		if !isAdminRequest(r, serviceAPIKey, jwtSecret) {
			writeAPIError(w, http.StatusForbidden, "admin access required")
			return
		}

		tenants, err := orch.ListTenants(r.Context())
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to list tenants")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"tenants": tenants})
	})
}

func isAdminRequest(r *http.Request, serviceAPIKey, jwtSecret string) bool {
	if serviceAPIKey != "" {
		incomingKey := strings.TrimSpace(r.Header.Get("X-Service-API-Key"))
		if incomingKey != "" && subtle.ConstantTimeCompare([]byte(incomingKey), []byte(serviceAPIKey)) == 1 {
			return true
		}
	}

	if jwtSecret == "" {
		return false
	}
	raw := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer"))
	if raw == "" {
		return false
	}

	token, err := jwt.Parse(raw, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(jwtSecret), nil
	})
	if err != nil || !token.Valid {
		return false
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return false
	}
	if isAdmin, ok := claims["isAdmin"].(bool); ok {
		return isAdmin
	}
	if isAdmin, ok := claims["is_admin"].(bool); ok {
		return isAdmin
	}
	return false
}

func statusFromError(err error) int {
	if err == nil {
		return http.StatusOK
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "tenant not found"):
		return http.StatusNotFound
	case strings.Contains(msg, "no container"):
		return http.StatusNotFound
	case strings.Contains(msg, "required") || strings.Contains(msg, "missing"):
		return http.StatusBadRequest
	default:
		return http.StatusInternalServerError
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
