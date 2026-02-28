package coordinator

import (
	"os"
	"strconv"
	"strings"
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

// SwarmConfig controls task decomposition and worker execution limits.
type SwarmConfig struct {
	DefaultMaxAgents            int
	DefaultTimeout              time.Duration
	DecompositionPromptTemplate string
}

// SubTask represents a unit of work for a sub-agent.
type SubTask struct {
	ID           string    `json:"id"`
	Brief        string    `json:"brief"`
	AssignedHand string    `json:"assigned_hand,omitempty"`
	Status       string    `json:"status"` // pending, running, complete, failed, timeout
	TmuxSession  string    `json:"tmux_session"`
	StartedAt    time.Time `json:"started_at,omitempty"`
	Output       string    `json:"output,omitempty"`
}

// SwarmRun tracks an active swarm execution.
type SwarmRun struct {
	RunID                       string          `json:"run_id"`
	TenantID                    string          `json:"tenant_id"`
	Task                        string          `json:"task"`
	Status                      string          `json:"status"` // running, complete, failed, cancelled
	TriggerType                 string          `json:"trigger_type,omitempty"`
	SourceChannel               string          `json:"source_channel,omitempty"`
	ChannelContext              *ChannelContext `json:"channel_context,omitempty"`
	SubTasks                    []SubTask       `json:"sub_tasks"`
	StartedAt                   time.Time       `json:"started_at"`
	DecompositionPromptTemplate string          `json:"decomposition_prompt_template,omitempty"`
	Output                      string          `json:"output,omitempty"`
}

// NewCoordinator creates a Coordinator with config from environment.
func NewCoordinator(tenantID string) *Coordinator {
	cfg := LoadSwarmConfigFromEnv()
	return NewCoordinatorWithLimits(tenantID, cfg.DefaultMaxAgents, cfg.DefaultTimeout)
}

// NewCoordinatorWithLimits creates a Coordinator with explicit limits.
func NewCoordinatorWithLimits(tenantID string, maxAgents int, timeout time.Duration) *Coordinator {
	return &Coordinator{
		TenantID:  tenantID,
		MaxAgents: clampPositive(maxAgents, 3),
		Timeout:   clampDuration(timeout, 30*time.Minute),
	}
}

// LoadSwarmConfigFromEnv loads global swarm defaults from environment variables.
func LoadSwarmConfigFromEnv() SwarmConfig {
	maxAgents := 3
	if v := strings.TrimSpace(os.Getenv("MAX_SWARM_AGENTS")); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			maxAgents = n
		}
	}

	timeout := 30 * time.Minute
	if v := strings.TrimSpace(os.Getenv("SWARM_AGENT_TIMEOUT")); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			timeout = d
		}
	}

	template := strings.TrimSpace(os.Getenv("SWARM_DECOMPOSITION_PROMPT_TEMPLATE"))
	if template == "" {
		template = "Break the task into clear subtasks assigned to specialist Hands. Task: {{task}}"
	}

	return SwarmConfig{
		DefaultMaxAgents:            maxAgents,
		DefaultTimeout:              timeout,
		DecompositionPromptTemplate: template,
	}
}

func clampPositive(v, fallback int) int {
	if v > 0 {
		return v
	}
	return fallback
}

func clampDuration(v, fallback time.Duration) time.Duration {
	if v > 0 {
		return v
	}
	return fallback
}
