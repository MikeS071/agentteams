package coordinator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/agentsquads/api/channels"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

const maxRunHistoryPerTenant = 100

// RunRequest represents a coordinator run request, including optional channel context.
type RunRequest struct {
	TenantID       string          `json:"tenant_id,omitempty"`
	Task           string          `json:"task"`
	TriggerType    string          `json:"trigger_type,omitempty"`
	ChannelContext *ChannelContext `json:"channel_context,omitempty"`
}

// Handler manages HTTP endpoints for the swarm coordinator.
type Handler struct {
	mu          sync.RWMutex
	runs        map[string]*SwarmRun   // tenantID -> latest run
	history     map[string][]*SwarmRun // tenantID -> latest runs
	tasks       map[string]*SwarmRun   // taskID(runID) -> run
	taskOrder   []string               // newest first
	subscribers map[string]map[chan []byte]struct{}
	redis       *redis.Client
	cfg         SwarmConfig
}

// NewHandler creates a new coordinator HTTP handler.
func NewHandler(redisClient *redis.Client) *Handler {
	return &Handler{
		runs:        make(map[string]*SwarmRun),
		history:     make(map[string][]*SwarmRun),
		tasks:       make(map[string]*SwarmRun),
		taskOrder:   make([]string, 0, maxRunHistoryPerTenant),
		subscribers: make(map[string]map[chan []byte]struct{}),
		redis:       redisClient,
		cfg:         LoadSwarmConfigFromEnv(),
	}
}

// Mount registers coordinator routes on the given mux.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/tenants/{id}/swarm/run", h.handleRun)
	mux.HandleFunc("POST /api/tenants/{id}/swarm/channel-run", h.handleRun)
	mux.HandleFunc("GET /api/tenants/{id}/swarm/status", h.handleStatus)
	mux.HandleFunc("GET /api/tenants/{id}/swarm/runs", h.handleRuns)
	mux.HandleFunc("POST /api/tenants/{id}/swarm/cancel", h.handleCancel)

	mux.HandleFunc("POST /api/swarm/tasks", h.handleCreateTask)
	mux.HandleFunc("GET /api/swarm/tasks", h.handleListTasks)
	mux.HandleFunc("GET /api/swarm/tasks/{id}", h.handleGetTask)
	mux.HandleFunc("GET /api/swarm/tasks/{id}/events", h.handleTaskEvents)
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

	subtasks, err := Decompose(req.Task, h.cfg.DecompositionPromptTemplate)
	if err != nil {
		return nil, fmt.Errorf("decompose: %w", err)
	}

	run := &SwarmRun{
		RunID:                       uuid.New().String()[:8],
		TenantID:                    tenantID,
		Task:                        req.Task,
		Status:                      "running",
		TriggerType:                 req.TriggerType,
		ChannelContext:              req.ChannelContext,
		SubTasks:                    subtasks,
		StartedAt:                   time.Now().UTC(),
		DecompositionPromptTemplate: h.cfg.DecompositionPromptTemplate,
	}
	if req.ChannelContext != nil {
		run.SourceChannel = req.ChannelContext.Channel
	}

	h.mu.Lock()
	h.runs[tenantID] = run
	h.prependHistoryLocked(tenantID, run)
	h.tasks[run.RunID] = run
	h.taskOrder = append([]string{run.RunID}, h.taskOrder...)
	h.mu.Unlock()

	h.publishRunUpdate(ctx, run, RunEvent{
		Type:    "queued",
		RunID:   run.RunID,
		Status:  run.Status,
		Message: "Agent swarm run accepted.",
	}, true)
	h.publishTaskSnapshot(run, "queued")

	coord := NewCoordinatorWithLimits(tenantID, h.maxAgentsForTenant(tenantID), h.cfg.DefaultTimeout)
	go func() {
		result, err := coord.RunWithSubTasks(context.Background(), req.Task, run.RunID, req.ChannelContext, subtasks, func(evt RunEvent) {
			h.applySubTaskEvent(run.RunID, evt)
			h.publishRunUpdate(context.Background(), run, evt, false)
		})

		if err != nil {
			h.mu.Lock()
			slog.Error("swarm run failed", "tenant", tenantID, "run", run.RunID, "err", err)
			run.Status = "failed"
			h.mu.Unlock()
			h.publishRunUpdate(context.Background(), run, RunEvent{
				Type:    "failed",
				RunID:   run.RunID,
				Status:  run.Status,
				Message: "Swarm execution failed. Reply with /agent run <task> to retry.",
			}, true)
			h.publishTaskSnapshot(run, "failed")
			return
		}

		h.mu.Lock()
		run.Status = result.Status
		run.SubTasks = result.SubTasks
		run.Output = result.Output
		h.runs[tenantID] = run
		h.tasks[run.RunID] = run
		h.mu.Unlock()

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
		h.publishTaskSnapshot(run, result.Status)
	}()

	return cloneRun(run), nil
}

func (h *Handler) handleRun(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing tenant id")
		return
	}

	var body RunRequest
	if err := decodeJSONStrict(r, &body); err != nil {
		h.writeJSONError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	body.Task = strings.TrimSpace(body.Task)
	if body.Task == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing task field")
		return
	}
	if len(body.Task) > 10000 {
		h.writeJSONError(w, http.StatusBadRequest, "task is too long")
		return
	}

	run, err := h.StartRun(r.Context(), tenantID, body)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "already running") {
			status = http.StatusConflict
		}
		h.writeJSONError(w, status, err.Error())
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
		h.writeJSONError(w, http.StatusBadRequest, "missing tenant id")
		return
	}

	h.mu.RLock()
	run := h.runs[tenantID]
	h.mu.RUnlock()

	if run == nil {
		h.writeJSONError(w, http.StatusNotFound, "no active swarm run")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cloneRun(run))
}

func (h *Handler) handleRuns(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.PathValue("id"))
	if tenantID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing tenant id")
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
		h.writeJSONError(w, http.StatusBadRequest, "missing tenant id")
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
		h.publishTaskSnapshot(run, "cancelled")
	}
	h.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
}

func (h *Handler) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var body RunRequest
	if err := decodeJSONStrict(r, &body); err != nil {
		h.writeJSONError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	tenantID := strings.TrimSpace(body.TenantID)
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	}
	if tenantID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing tenant_id")
		return
	}

	run, err := h.StartRun(r.Context(), tenantID, body)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "already running") {
			status = http.StatusConflict
		}
		h.writeJSONError(w, status, err.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"status":    "accepted",
		"task_id":   run.RunID,
		"tenant_id": run.TenantID,
	})
}

func (h *Handler) handleListTasks(w http.ResponseWriter, r *http.Request) {
	tenantID := strings.TrimSpace(r.URL.Query().Get("tenant_id"))
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.URL.Query().Get("tenantId"))
	}
	if tenantID == "" {
		tenantID = strings.TrimSpace(r.Header.Get("X-Tenant-ID"))
	}

	h.mu.RLock()
	result := make([]*SwarmRun, 0, len(h.taskOrder))
	for _, taskID := range h.taskOrder {
		run := h.tasks[taskID]
		if run == nil {
			continue
		}
		if tenantID != "" && run.TenantID != tenantID {
			continue
		}
		result = append(result, cloneRun(run))
	}
	h.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"tasks": result})
}

func (h *Handler) handleGetTask(w http.ResponseWriter, r *http.Request) {
	taskID := strings.TrimSpace(r.PathValue("id"))
	if taskID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing task id")
		return
	}

	h.mu.RLock()
	run := h.tasks[taskID]
	h.mu.RUnlock()
	if run == nil {
		h.writeJSONError(w, http.StatusNotFound, "swarm task not found")
		return
	}
	if tenantID := strings.TrimSpace(r.Header.Get("X-Tenant-ID")); tenantID != "" && run.TenantID != tenantID {
		h.writeJSONError(w, http.StatusNotFound, "swarm task not found")
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(cloneRun(run))
}

func (h *Handler) handleTaskEvents(w http.ResponseWriter, r *http.Request) {
	taskID := strings.TrimSpace(r.PathValue("id"))
	if taskID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing task id")
		return
	}

	h.mu.RLock()
	run := h.tasks[taskID]
	h.mu.RUnlock()
	if run == nil {
		h.writeJSONError(w, http.StatusNotFound, "swarm task not found")
		return
	}
	if tenantID := strings.TrimSpace(r.Header.Get("X-Tenant-ID")); tenantID != "" && run.TenantID != tenantID {
		h.writeJSONError(w, http.StatusNotFound, "swarm task not found")
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		h.writeJSONError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	sub, unsubscribe := h.subscribe(taskID)
	defer unsubscribe()

	h.writeSSE(w, "snapshot", run)
	flusher.Flush()

	heartbeat := time.NewTicker(20 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-heartbeat.C:
			_, _ = w.Write([]byte(": keep-alive\n\n"))
			flusher.Flush()
		case payload := <-sub:
			_, _ = w.Write(payload)
			flusher.Flush()
		}
	}
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

func (h *Handler) maxAgentsForTenant(tenantID string) int {
	key := sanitizeForEnv(tenantID)
	if key != "" {
		envKey := "MAX_SWARM_AGENTS_" + key
		if raw := strings.TrimSpace(os.Getenv(envKey)); raw != "" {
			if n, err := strconv.Atoi(raw); err == nil && n > 0 {
				return n
			}
		}
	}
	return h.cfg.DefaultMaxAgents
}

func sanitizeForEnv(input string) string {
	if strings.TrimSpace(input) == "" {
		return ""
	}
	var b strings.Builder
	for _, r := range strings.ToUpper(input) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			continue
		}
		b.WriteRune('_')
	}
	return b.String()
}

func (h *Handler) applySubTaskEvent(taskID string, evt RunEvent) {
	h.mu.Lock()
	run := h.tasks[taskID]
	if run == nil {
		h.mu.Unlock()
		return
	}
	for i := range run.SubTasks {
		if run.SubTasks[i].ID == evt.SubTaskID {
			if evt.Status != "" {
				run.SubTasks[i].Status = evt.Status
			}
			break
		}
	}
	clone := cloneRun(run)
	h.mu.Unlock()

	h.writeSSEPayload(taskID, "update", clone)
}

func (h *Handler) publishTaskSnapshot(run *SwarmRun, event string) {
	if run == nil {
		return
	}
	h.writeSSEPayload(run.RunID, event, cloneRun(run))
}

func (h *Handler) writeSSEPayload(taskID, event string, run *SwarmRun) {
	payload, err := json.Marshal(map[string]any{
		"event": event,
		"task":  run,
	})
	if err != nil {
		return
	}

	msg := append([]byte("event: "+event+"\n"), []byte("data: ")...)
	msg = append(msg, payload...)
	msg = append(msg, []byte("\n\n")...)

	h.mu.RLock()
	subscribers := h.subscribers[taskID]
	chans := make([]chan []byte, 0, len(subscribers))
	for ch := range subscribers {
		chans = append(chans, ch)
	}
	h.mu.RUnlock()

	for _, ch := range chans {
		select {
		case ch <- msg:
		default:
		}
	}
}

func (h *Handler) subscribe(taskID string) (chan []byte, func()) {
	ch := make(chan []byte, 32)
	h.mu.Lock()
	if h.subscribers[taskID] == nil {
		h.subscribers[taskID] = make(map[chan []byte]struct{})
	}
	h.subscribers[taskID][ch] = struct{}{}
	h.mu.Unlock()

	return ch, func() {
		h.mu.Lock()
		subs := h.subscribers[taskID]
		delete(subs, ch)
		if len(subs) == 0 {
			delete(h.subscribers, taskID)
		}
		h.mu.Unlock()
		close(ch)
	}
}

func (h *Handler) writeSSE(w http.ResponseWriter, event string, run *SwarmRun) {
	payload, err := json.Marshal(map[string]any{
		"event": event,
		"task":  cloneRun(run),
	})
	if err != nil {
		return
	}
	_, _ = w.Write([]byte("event: " + event + "\n"))
	_, _ = w.Write([]byte("data: "))
	_, _ = w.Write(payload)
	_, _ = w.Write([]byte("\n\n"))
}

func (h *Handler) writeJSONError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": message})
}
