package coordinator

import (
	"os"
	"strconv"
	"time"
)

// ChannelContext carries origin metadata for channel-triggered swarm tasks.
type ChannelContext struct {
	Channel        string            `json:"channel"`
	ConversationID string            `json:"conversation_id,omitempty"`
	ThreadID       string            `json:"thread_id,omitempty"`
	UserID         string            `json:"user_id,omitempty"`
	UserName       string            `json:"user_name,omitempty"`
	Metadata       map[string]string `json:"metadata,omitempty"`
}

// RunEvent reports lifecycle updates for streaming progress.
type RunEvent struct {
	Type      string `json:"type"` // queued, subtask_started, subtask_update, complete, failed
	RunID     string `json:"run_id"`
	SubTaskID string `json:"subtask_id,omitempty"`
	Status    string `json:"status,omitempty"`
	Message   string `json:"message,omitempty"`
}

// Coordinator manages a swarm of sub-agents for a tenant.
type Coordinator struct {
	TenantID  string
	MaxAgents int
	Timeout   time.Duration
}

// SubTask represents a unit of work for a sub-agent.
type SubTask struct {
	ID          string    `json:"id"`
	Brief       string    `json:"brief"`
	Status      string    `json:"status"` // pending, running, complete, failed, timeout
	TmuxSession string    `json:"tmux_session"`
	StartedAt   time.Time `json:"started_at,omitempty"`
	Output      string    `json:"output,omitempty"`
}

// SwarmRun tracks an active swarm execution.
type SwarmRun struct {
	RunID          string          `json:"run_id"`
	TenantID       string          `json:"tenant_id"`
	Task           string          `json:"task"`
	Status         string          `json:"status"` // running, complete, failed, cancelled
	TriggerType    string          `json:"trigger_type,omitempty"`
	SourceChannel  string          `json:"source_channel,omitempty"`
	ChannelContext *ChannelContext `json:"channel_context,omitempty"`
	SubTasks       []SubTask       `json:"sub_tasks"`
	StartedAt      time.Time       `json:"started_at"`
	Output         string          `json:"output,omitempty"`
}

// NewCoordinator creates a Coordinator with config from environment.
func NewCoordinator(tenantID string) *Coordinator {
	maxAgents := 3
	if v := os.Getenv("MAX_SWARM_AGENTS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxAgents = n
		}
	}

	timeout := 30 * time.Minute
	if v := os.Getenv("SWARM_AGENT_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			timeout = d
		}
	}

	return &Coordinator{
		TenantID:  tenantID,
		MaxAgents: maxAgents,
		Timeout:   timeout,
	}
}
