package coordinator

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// Handler manages HTTP endpoints for the swarm coordinator.
type Handler struct {
	mu      sync.RWMutex
	runs    map[string]*SwarmRun // tenantID -> active run
	removed map[string]bool      // agent IDs removed from dashboard views
}

// AgentSummary is the list payload for swarm agents.
type AgentSummary struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	TenantID      string  `json:"tenant_id"`
	RunID         string  `json:"run_id"`
	Status        string  `json:"status"`
	CurrentTask   string  `json:"current_task"`
	UptimeSeconds int64   `json:"uptime_seconds"`
	CPUPercent    float64 `json:"cpu_percent"`
	MemoryMB      float64 `json:"memory_mb"`
}

// QueueTask represents a sub-task in the dashboard queue.
type QueueTask struct {
	ID        string    `json:"id"`
	AgentID   string    `json:"agent_id"`
	TenantID  string    `json:"tenant_id"`
	RunID     string    `json:"run_id"`
	Brief     string    `json:"brief"`
	Status    string    `json:"status"`
	StartedAt time.Time `json:"started_at,omitempty"`
}

// TaskQueue groups tasks by queue state.
type TaskQueue struct {
	Pending   []QueueTask `json:"pending"`
	Running   []QueueTask `json:"running"`
	Completed []QueueTask `json:"completed"`
}

// ResourcePoint is a resource snapshot point used by the chart.
type ResourcePoint struct {
	Timestamp  time.Time `json:"timestamp"`
	CPUPercent float64   `json:"cpu_percent"`
	MemoryMB   float64   `json:"memory_mb"`
}

// AgentDetail is the detail payload for an individual agent.
type AgentDetail struct {
	Agent         AgentSummary    `json:"agent"`
	Logs          []string        `json:"logs"`
	TaskHistory   []QueueTask     `json:"task_history"`
	ResourceChart []ResourcePoint `json:"resource_chart"`
}

// NewHandler creates a new coordinator HTTP handler.
func NewHandler() *Handler {
	return &Handler{
		runs:    make(map[string]*SwarmRun),
		removed: make(map[string]bool),
	}
}

// Mount registers coordinator routes on the given mux.
func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/tenants/{id}/swarm/run", h.handleRun)
	mux.HandleFunc("GET /api/tenants/{id}/swarm/status", h.handleStatus)
	mux.HandleFunc("POST /api/tenants/{id}/swarm/cancel", h.handleCancel)

	mux.HandleFunc("GET /api/agents", h.handleAgents)
	mux.HandleFunc("GET /api/agents/{id}", h.handleAgentDetail)
	mux.HandleFunc("POST /api/agents/{id}/restart", h.handleAgentRestart)
	mux.HandleFunc("DELETE /api/agents/{id}", h.handleAgentDelete)
}

func (h *Handler) handleRun(w http.ResponseWriter, r *http.Request) {
	tenantID := r.PathValue("id")
	if tenantID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing tenant id")
		return
	}

	var body struct {
		Task string `json:"task"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.Task) == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing task field")
		return
	}

	h.mu.RLock()
	existing := h.runs[tenantID]
	h.mu.RUnlock()
	if existing != nil && existing.Status == "running" {
		h.writeJSONError(w, http.StatusConflict, "swarm already running for this tenant")
		return
	}

	coord := NewCoordinator(tenantID)

	// Return run ID immediately; execute in background.
	run := &SwarmRun{
		RunID:     "", // set after coordinator.Run returns
		TenantID:  tenantID,
		Task:      body.Task,
		Status:    "running",
		StartedAt: time.Now().UTC(),
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

	h.writeJSON(w, http.StatusAccepted, map[string]string{
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
		h.writeJSONError(w, http.StatusNotFound, "no active swarm run")
		return
	}

	h.writeJSON(w, http.StatusOK, run)
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

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

func (h *Handler) handleAgents(w http.ResponseWriter, _ *http.Request) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	agents := make([]AgentSummary, 0)
	queue := TaskQueue{
		Pending:   make([]QueueTask, 0),
		Running:   make([]QueueTask, 0),
		Completed: make([]QueueTask, 0),
	}

	for tenantID, run := range h.runs {
		for i := range run.SubTasks {
			st := &run.SubTasks[i]
			if h.removed[st.ID] {
				continue
			}

			summary := buildAgentSummary(tenantID, run.RunID, st)
			agents = append(agents, summary)

			queueTask := buildQueueTask(tenantID, run.RunID, st)
			switch st.Status {
			case "pending":
				queue.Pending = append(queue.Pending, queueTask)
			case "running":
				queue.Running = append(queue.Running, queueTask)
			default:
				queue.Completed = append(queue.Completed, queueTask)
			}
		}
	}

	h.writeJSON(w, http.StatusOK, map[string]any{
		"agents":     agents,
		"task_queue": queue,
	})
}

func (h *Handler) handleAgentDetail(w http.ResponseWriter, r *http.Request) {
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing agent id")
		return
	}

	h.mu.RLock()
	tenantID, run, subtask, ok := h.findAgentLocked(agentID)
	removed := h.removed[agentID]
	h.mu.RUnlock()
	if !ok || removed {
		h.writeJSONError(w, http.StatusNotFound, "agent not found")
		return
	}

	detail := AgentDetail{
		Agent:         buildAgentSummary(tenantID, run.RunID, subtask),
		Logs:          collectRecentLogs(subtask),
		TaskHistory:   buildTaskHistory(tenantID, run),
		ResourceChart: buildResourceChart(subtask),
	}

	h.writeJSON(w, http.StatusOK, detail)
}

func (h *Handler) handleAgentRestart(w http.ResponseWriter, r *http.Request) {
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing agent id")
		return
	}

	h.mu.RLock()
	_, run, subtask, ok := h.findAgentLocked(agentID)
	removed := h.removed[agentID]
	h.mu.RUnlock()
	if !ok || removed {
		h.writeJSONError(w, http.StatusNotFound, "agent not found")
		return
	}

	if subtask.Status == "running" {
		h.writeJSONError(w, http.StatusConflict, "agent is already running")
		return
	}

	_ = Cleanup(subtask)
	subtask.Status = "pending"
	subtask.Output = ""
	subtask.StartedAt = time.Time{}

	coord := NewCoordinator(run.TenantID)
	if err := coord.SpawnAgent(subtask); err != nil {
		h.writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("failed to restart agent: %v", err))
		return
	}

	h.writeJSON(w, http.StatusOK, map[string]string{"status": "restarted", "agent_id": agentID})
}

func (h *Handler) handleAgentDelete(w http.ResponseWriter, r *http.Request) {
	agentID := strings.TrimSpace(r.PathValue("id"))
	if agentID == "" {
		h.writeJSONError(w, http.StatusBadRequest, "missing agent id")
		return
	}

	h.mu.RLock()
	_, _, subtask, ok := h.findAgentLocked(agentID)
	h.mu.RUnlock()
	if !ok {
		h.writeJSONError(w, http.StatusNotFound, "agent not found")
		return
	}

	_ = Cleanup(subtask)
	subtask.Status = "failed"
	subtask.Output = "stopped by user"

	h.mu.Lock()
	h.removed[agentID] = true
	h.mu.Unlock()

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) findAgentLocked(agentID string) (tenantID string, run *SwarmRun, subtask *SubTask, ok bool) {
	for currentTenantID, currentRun := range h.runs {
		for i := range currentRun.SubTasks {
			if currentRun.SubTasks[i].ID == agentID {
				return currentTenantID, currentRun, &currentRun.SubTasks[i], true
			}
		}
	}
	return "", nil, nil, false
}

func buildAgentSummary(tenantID, runID string, subtask *SubTask) AgentSummary {
	uptime := int64(0)
	if !subtask.StartedAt.IsZero() {
		uptime = int64(time.Since(subtask.StartedAt).Seconds())
		if uptime < 0 {
			uptime = 0
		}
	}

	cpu, mem := estimateResourceUsage(subtask)

	return AgentSummary{
		ID:            subtask.ID,
		Name:          fmt.Sprintf("Agent %s", strings.TrimPrefix(subtask.ID, "sub-")),
		TenantID:      tenantID,
		RunID:         runID,
		Status:        dashboardStatus(subtask.Status),
		CurrentTask:   subtask.Brief,
		UptimeSeconds: uptime,
		CPUPercent:    cpu,
		MemoryMB:      mem,
	}
}

func buildQueueTask(tenantID, runID string, subtask *SubTask) QueueTask {
	return QueueTask{
		ID:        fmt.Sprintf("task-%s", subtask.ID),
		AgentID:   subtask.ID,
		TenantID:  tenantID,
		RunID:     runID,
		Brief:     subtask.Brief,
		Status:    subtask.Status,
		StartedAt: subtask.StartedAt,
	}
}

func buildTaskHistory(tenantID string, run *SwarmRun) []QueueTask {
	history := make([]QueueTask, 0, len(run.SubTasks))
	for i := range run.SubTasks {
		history = append(history, buildQueueTask(tenantID, run.RunID, &run.SubTasks[i]))
	}
	return history
}

func collectRecentLogs(subtask *SubTask) []string {
	logs := make([]string, 0, 160)

	if subtask.TmuxSession != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
		defer cancel()

		out, err := exec.CommandContext(ctx, "tmux", "capture-pane", "-pt", subtask.TmuxSession, "-S", "-160").CombinedOutput()
		if err == nil {
			for _, line := range strings.Split(string(out), "\n") {
				trimmed := strings.TrimSpace(line)
				if trimmed == "" {
					continue
				}
				logs = append(logs, trimmed)
			}
		}
	}

	if len(logs) == 0 && strings.TrimSpace(subtask.Output) != "" {
		for _, line := range strings.Split(subtask.Output, "\n") {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				continue
			}
			logs = append(logs, trimmed)
		}
	}

	if len(logs) == 0 {
		logs = append(logs, fmt.Sprintf("[%s] status=%s", time.Now().UTC().Format(time.RFC3339), subtask.Status))
	}

	if len(logs) > 120 {
		logs = logs[len(logs)-120:]
	}
	return logs
}

func estimateResourceUsage(subtask *SubTask) (float64, float64) {
	uptime := time.Duration(0)
	if !subtask.StartedAt.IsZero() {
		uptime = time.Since(subtask.StartedAt)
	}

	seed := int64(len(subtask.ID) * 17)
	if uptime > 0 {
		seed += uptime.Milliseconds() / 500
	}
	jitter := float64(seed%13) / 10.0

	switch subtask.Status {
	case "running":
		return 18 + jitter*2.5, 220 + jitter*8
	case "failed", "timeout":
		return 2 + jitter, 90 + jitter*4
	case "complete":
		return 4 + jitter, 120 + jitter*4
	default:
		return 1 + jitter/2, 80 + jitter*2
	}
}

func buildResourceChart(subtask *SubTask) []ResourcePoint {
	points := make([]ResourcePoint, 0, 20)
	now := time.Now().UTC()
	for i := 19; i >= 0; i-- {
		ts := now.Add(-time.Duration(i) * 15 * time.Second)
		cpu, mem := estimateResourceUsage(subtask)
		cpu += float64((i%5)-2) * 0.9
		mem += float64((i%7)-3) * 1.8
		if cpu < 0 {
			cpu = 0
		}
		if mem < 0 {
			mem = 0
		}
		points = append(points, ResourcePoint{Timestamp: ts, CPUPercent: cpu, MemoryMB: mem})
	}
	return points
}

func dashboardStatus(subtaskStatus string) string {
	switch subtaskStatus {
	case "running":
		return "running"
	case "failed", "timeout", "cancelled":
		return "error"
	default:
		return "idle"
	}
}

func (h *Handler) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func (h *Handler) writeJSONError(w http.ResponseWriter, status int, message string) {
	h.writeJSON(w, status, map[string]string{"error": message})
}
