package main

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

func mountHandsProxyRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/hands/events", handleHandsEvents)
	mux.HandleFunc("POST /api/hands/{id}/approve/{actionId}", handleHandsApprove)
	mux.HandleFunc("POST /api/hands/{id}/reject/{actionId}", handleHandsReject)
}

func handleHandsEvents(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	}
	if tenantID == "" {
		writeAPIError(w, http.StatusBadRequest, "tenant_id is required")
		return
	}

	target, err := buildHandsTarget("/api/hands/events", nil)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	q := target.Query()
	q.Set("tenant_id", tenantID)
	target.RawQuery = q.Encode()

	forwardHandsRequest(w, r, http.MethodGet, target, tenantID)
}

func handleHandsApprove(w http.ResponseWriter, r *http.Request) {
	handID := strings.TrimSpace(r.PathValue("id"))
	actionID := strings.TrimSpace(r.PathValue("actionId"))
	tenantID := strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	}
	if handID == "" || actionID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing hand id or action id")
		return
	}
	if tenantID == "" {
		writeAPIError(w, http.StatusBadRequest, "tenant_id is required")
		return
	}

	target, err := buildHandsTarget(fmt.Sprintf("/api/hands/%s/approve/%s", url.PathEscape(handID), url.PathEscape(actionID)), nil)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	forwardHandsRequest(w, r, http.MethodPost, target, tenantID)
}

func handleHandsReject(w http.ResponseWriter, r *http.Request) {
	handID := strings.TrimSpace(r.PathValue("id"))
	actionID := strings.TrimSpace(r.PathValue("actionId"))
	tenantID := strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	}
	if handID == "" || actionID == "" {
		writeAPIError(w, http.StatusBadRequest, "missing hand id or action id")
		return
	}
	if tenantID == "" {
		writeAPIError(w, http.StatusBadRequest, "tenant_id is required")
		return
	}

	target, err := buildHandsTarget(fmt.Sprintf("/api/hands/%s/reject/%s", url.PathEscape(handID), url.PathEscape(actionID)), nil)
	if err != nil {
		writeAPIError(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	forwardHandsRequest(w, r, http.MethodPost, target, tenantID)
}

func buildHandsTarget(path string, rawQuery url.Values) (*url.URL, error) {
	base := strings.TrimSpace(os.Getenv("OPENFANG_API_URL"))
	if base == "" {
		return nil, fmt.Errorf("OPENFANG_API_URL is not configured")
	}

	baseURL, err := url.Parse(base)
	if err != nil {
		return nil, fmt.Errorf("OPENFANG_API_URL is invalid")
	}

	rel := &url.URL{Path: path}
	target := baseURL.ResolveReference(rel)
	if rawQuery != nil {
		target.RawQuery = rawQuery.Encode()
	}
	return target, nil
}

func forwardHandsRequest(w http.ResponseWriter, r *http.Request, method string, target *url.URL, tenantID string) {
	var body io.Reader
	if r.Body != nil {
		body = r.Body
	}

	req, err := http.NewRequestWithContext(r.Context(), method, target.String(), body)
	if err != nil {
		writeAPIError(w, http.StatusInternalServerError, "failed to create upstream request")
		return
	}

	if accept := strings.TrimSpace(r.Header.Get("Accept")); accept != "" {
		req.Header.Set("Accept", accept)
	}
	if contentType := strings.TrimSpace(r.Header.Get("Content-Type")); contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	req.Header.Set("X-Tenant-ID", tenantID)

	if apiKey := strings.TrimSpace(os.Getenv("OPENFANG_API_KEY")); apiKey != "" {
		req.Header.Set("X-API-Key", apiKey)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		writeAPIError(w, http.StatusBadGateway, "failed to reach OpenFang API")
		return
	}
	defer resp.Body.Close()

	if contentType := strings.TrimSpace(resp.Header.Get("Content-Type")); contentType != "" {
		w.Header().Set("Content-Type", contentType)
	}
	if cacheControl := strings.TrimSpace(resp.Header.Get("Cache-Control")); cacheControl != "" {
		w.Header().Set("Cache-Control", cacheControl)
	}
	if connection := strings.TrimSpace(resp.Header.Get("Connection")); connection != "" {
		w.Header().Set("Connection", connection)
	}

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
