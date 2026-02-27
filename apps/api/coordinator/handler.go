package coordinator

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"sync"
)

// Handler manages HTTP endpoints for the swarm coordinator.
type Handler struct {
	mu   sync.RWMutex
	runs map[string]*SwarmRun // tenantID → active run
}

// NewHandler creates a new coordinator HTTP handler.
func NewHandler() *Handler {
	return &Handler{
		runs: make(map[string]*SwarmRun),
	}
}

// Mount registers coordinator routes on the given mux.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/tenants/{id}/swarm/run", h.handleRun)
	mux.HandleFunc("GET /api/tenants/{id}/swarm/status", h.handleStatus)
	mux.HandleFunc("POST /api/tenants/{id}/swarm/cancel", h.handleCancel)
}

func (h *Handler) handleRun(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("id")
	if tenantID == "" {
		http.Error(w, `{"error":"missing tenant id"}`, http.StatusBadRequest)
		return
	}

	var body struct {
		Task string `json:"task"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Task == "" {
		http.Error(w, `{"error":"missing task field"}`, http.StatusBadRequest)
		return
	}

	h.mu.RLock()
	existing := h.runs[tenantID]
	h.mu.RUnlock()
	if existing != nil && existing.Status == "running" {
		http.Error(w, `{"error":"swarm already running for this tenant"}`, http.StatusConflict)
		return
	}

	coord := NewCoordinator(tenantID)

	// Return run ID immediately; execute in background
	run := &SwarmRun{
		RunID:    "", // will be set by Run
		TenantID: tenantID,
		Task:     body.Task,
		Status:   "running",
	}

	h.mu.Lock()
	h.runs[tenantID] = run
	h.mu.Unlock()

	go func() {
		result, err := coord.Run(context.Background(), body.Task)
		h.mu.Lock()
		defer h.mu.Unlock()
		if err != nil {
			slog.Error("swarm run failed", "tenant", tenantID, "err", err)
			run.Status = "failed"
			return
		}
		h.runs[tenantID] = result
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{
		"status":    "accepted",
		"tenant_id": tenantID,
	})
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("id")

	h.mu.RLock()
	run := h.runs[tenantID]
	h.mu.RUnlock()

	if run == nil {
		http.Error(w, `{"error":"no active swarm run"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(run)
}

func (h *Handler) handleCancel(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("id")

	h.mu.Lock()
	run := h.runs[tenantID]
	if run != nil && run.Status == "running" {
		for i := range run.SubTasks {
			if run.SubTasks[i].Status == "running" {
				_ = Cleanup(&run.SubTasks[i])
				run.SubTasks[i].Status = "failed"
			}
		}
		run.Status = "cancelled"
	}
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
}
