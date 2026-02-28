package coordinator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/agentteams/api/channels"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const maxRunHistoryPerTenant = 100

// RunRequest represents a coordinator run request, including optional channel context.
type RunRequest struct {
	Task           string          `json:"task"`
	TriggerType    string          `json:"trigger_type,omitempty"`
	ChannelContext *ChannelContext `json:"channel_context,omitempty"`
}

// Handler manages HTTP endpoints for the swarm coordinator.
type Handler struct {
	mu      sync.RWMutex
	runs    map[string]*SwarmRun   // tenantID -> latest run
	history map[string][]*SwarmRun // tenantID -> latest runs
	redis   *redis.Client
}

// NewHandler creates a new coordinator HTTP handler.
func NewHandler(redisClient *redis.Client) *Handler {
	return &Handler{
		runs:    make(map[string]*SwarmRun),
		history: make(map[string][]*SwarmRun),
		redis:   redisClient,
	}
}

// Mount registers coordinator routes on the given mux.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/tenants/{id}/swarm/run", h.handleRun)
	mux.HandleFunc("POST /api/tenants/{id}/swarm/channel-run", h.handleRun)
	mux.HandleFunc("GET /api/tenants/{id}/swarm/status", h.handleStatus)
	mux.HandleFunc("GET /api/tenants/{id}/swarm/runs", h.handleRuns)
	mux.HandleFunc("POST /api/tenants/{id}/swarm/cancel", h.handleCancel)
}

// StartRun starts a swarm run and streams lifecycle updates via channel fanout when channel context exists.
func (h *Handler) StartRun(ctx context.Context, tenantID string, req RunRequest) (*SwarmRun, error) {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return nil, errors.New("missing tenant id")
	}
	req.Task = strings.TrimSpace(req.Task)
	if req.Task == "" {
		return nil, errors.New("missing task field")
	}
	if req.TriggerType == "" {
		req.TriggerType = "manual"
	}

	h.mu.RLock()
	existing := h.runs[tenantID]
	h.mu.RUnlock()
	if existing != nil && existing.Status == "running" {
		return nil, errors.New("swarm already running for this tenant")
	}

	run := &SwarmRun{
		RunID:          uuid.New().String()[:8],
		TenantID:       tenantID,
		Task:           req.Task,
		Status:         "running",
		TriggerType:    req.TriggerType,
		ChannelContext: req.ChannelContext,
		StartedAt:      time.Now().UTC(),
	}
	if req.ChannelContext != nil {
		run.SourceChannel = req.ChannelContext.Channel
	}

	h.mu.Lock()
	h.runs[tenantID] = run
	h.prependHistoryLocked(tenantID, run)
	h.mu.Unlock()

	h.publishRunUpdate(ctx, run, RunEvent{
		Type:    "queued",
		RunID:   run.RunID,
		Status:  run.Status,
		Message: "Agent swarm run accepted.",
	}, true)

	coord := NewCoordinator(tenantID)
	go func() {
		result, err := coord.Run(context.Background(), req.Task, run.RunID, req.ChannelContext, func(evt RunEvent) {
			h.publishRunUpdate(context.Background(), run, evt, false)
		})

		h.mu.Lock()
		defer h.mu.Unlock()
		if err != nil {
			slog.Error("swarm run failed", "tenant", tenantID, "run", run.RunID, "err", err)
			run.Status = "failed"
			h.publishRunUpdate(context.Background(), run, RunEvent{
				Type:    "failed",
				RunID:   run.RunID,
				Status:  run.Status,
				Message: "Swarm execution failed. Reply with /agent run <task> to retry.",
			}, true)
			return
		}

		run.Status = result.Status
		run.SubTasks = result.SubTasks
		run.Output = result.Output
		h.runs[tenantID] = run

		finalMessage := strings.TrimSpace(result.Output)
		if finalMessage == "" {
			if result.Status == "complete" {
				finalMessage = "Agent swarm completed."
			} else {
				finalMessage = "Agent swarm completed with issues. Reply with more detail if you want a retry."
			}
		}
		h.publishRunUpdate(context.Background(), run, RunEvent{
			Type:    result.Status,
			RunID:   run.RunID,
			Status:  result.Status,
			Message: finalMessage,
		}, true)
	}()

	return cloneRun(run), nil
}

func (h *Handler) handleRun(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		http.Error(w, `{"error":"missing tenant id"}`, http.StatusBadRequest)
		return
	}

	var body RunRequest
	if err := decodeJSONStrict(r, &body); err != nil {
		http.Error(w, `{"error":"invalid JSON body"}`, http.StatusBadRequest)
		return
	}
	body.Task = strings.TrimSpace(body.Task)
	if body.Task == "" {
		http.Error(w, `{"error":"missing task field"}`, http.StatusBadRequest)
		return
	}
	if len(body.Task) > 10000 {
		http.Error(w, `{"error":"task is too long"}`, http.StatusBadRequest)
		return
	}

	run, err := h.StartRun(r.Context(), tenantID, body)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "already running") {
			status = http.StatusConflict
		}
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), status)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":    "accepted",
		"tenant_id": tenantID,
		"run_id":    run.RunID,
	})
}

func (h *Handler) handleStatus(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		http.Error(w, `{"error":"missing tenant id"}`, http.StatusBadRequest)
		return
	}

	h.mu.RLock()
	run := h.runs[tenantID]
	h.mu.RUnlock()

	if run == nil {
		http.Error(w, `{"error":"no active swarm run"}`, http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(run)
}

func (h *Handler) handleRuns(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		http.Error(w, `{"error":"missing tenant id"}`, http.StatusBadRequest)
		return
	}

	h.mu.RLock()
	history := h.history[tenantID]
	result := make([]*SwarmRun, 0, len(history))
	for _, run := range history {
		result = append(result, cloneRun(run))
	}
	h.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"runs": result})
}

func (h *Handler) handleCancel(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		http.Error(w, `{"error":"missing tenant id"}`, http.StatusBadRequest)
		return
	}

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
		h.publishRunUpdate(context.Background(), run, RunEvent{
			Type:    "cancelled",
			RunID:   run.RunID,
			Status:  run.Status,
			Message: "Agent swarm run cancelled.",
		}, true)
	}
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
}

func decodeJSONStrict(r *http.Request, dst any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dst); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}

func (h *Handler) prependHistoryLocked(tenantID string, run *SwarmRun) {
	history := h.history[tenantID]
	history = append([]*SwarmRun{run}, history...)
	if len(history) > maxRunHistoryPerTenant {
		history = history[:maxRunHistoryPerTenant]
	}
	h.history[tenantID] = history
}

func cloneRun(run *SwarmRun) *SwarmRun {
	if run == nil {
		return nil
	}
	clone := *run
	if run.SubTasks != nil {
		clone.SubTasks = append([]SubTask(nil), run.SubTasks...)
	}
	if run.ChannelContext != nil {
		ctxCopy := *run.ChannelContext
		if run.ChannelContext.Metadata != nil {
			ctxCopy.Metadata = make(map[string]string, len(run.ChannelContext.Metadata))
			for k, v := range run.ChannelContext.Metadata {
				ctxCopy.Metadata[k] = v
			}
		}
		clone.ChannelContext = &ctxCopy
	}
	return &clone
}

func (h *Handler) publishRunUpdate(ctx context.Context, run *SwarmRun, evt RunEvent, final bool) {
	if h.redis == nil || run == nil || run.ChannelContext == nil {
		return
	}

	content := strings.TrimSpace(evt.Message)
	if content == "" {
		content = fmt.Sprintf("Run %s: %s", run.RunID, evt.Type)
	}

	metadata := map[string]string{
		"run_id":       run.RunID,
		"event":        evt.Type,
		"trigger_type": run.TriggerType,
		"status":       run.Status,
	}
	if evt.SubTaskID != "" {
		metadata["subtask_id"] = evt.SubTaskID
	}
	if run.ChannelContext.ThreadID != "" {
		metadata["thread_id"] = run.ChannelContext.ThreadID
	}
	if run.ChannelContext.UserID != "" {
		metadata["user_id"] = run.ChannelContext.UserID
	}
	if run.ChannelContext.UserName != "" {
		metadata["user_name"] = run.ChannelContext.UserName
	}

	out := channels.OutboundMessage{
		TenantID:       run.TenantID,
		Content:        content,
		Channel:        run.ChannelContext.Channel,
		ConversationID: run.ChannelContext.ConversationID,
		Stream:         !final,
		Metadata:       metadata,
	}

	payload, err := json.Marshal(out)
	if err != nil {
		slog.Error("failed to marshal swarm channel update", "run", run.RunID, "err", err)
		return
	}

	topic := fmt.Sprintf("tenant:%s:response", run.TenantID)
	if err := h.redis.Publish(ctx, topic, payload).Err(); err != nil {
		slog.Error("failed to publish swarm channel update", "run", run.RunID, "err", err)
	}
}
