package coordinator

import (
	"os"
	"testing"
	"time"
)

func TestNewCoordinatorWithLimits(t *testing.T) {
	t.Parallel()
	c := NewCoordinatorWithLimits("t1", 0, 0)
	if c.MaxAgents != 3 {
		t.Fatalf("MaxAgents=%d want 3", c.MaxAgents)
	}
	if c.Timeout != 30*time.Minute {
		t.Fatalf("Timeout=%s", c.Timeout)
	}
}

func TestLoadSwarmConfigFromEnv(t *testing.T) {
	_ = os.Setenv("MAX_SWARM_AGENTS", "5")
	_ = os.Setenv("SWARM_AGENT_TIMEOUT", "10m")
	_ = os.Setenv("SWARM_DECOMPOSITION_PROMPT_TEMPLATE", "Task: {{task}}")
	t.Cleanup(func() {
		_ = os.Unsetenv("MAX_SWARM_AGENTS")
		_ = os.Unsetenv("SWARM_AGENT_TIMEOUT")
		_ = os.Unsetenv("SWARM_DECOMPOSITION_PROMPT_TEMPLATE")
	})

	cfg := LoadSwarmConfigFromEnv()
	if cfg.DefaultMaxAgents != 5 {
		t.Fatalf("DefaultMaxAgents=%d", cfg.DefaultMaxAgents)
	}
	if cfg.DefaultTimeout != 10*time.Minute {
		t.Fatalf("DefaultTimeout=%s", cfg.DefaultTimeout)
	}
	if cfg.DecompositionPromptTemplate == "" {
		t.Fatalf("expected prompt template")
	}
}

func TestClampHelpers(t *testing.T) {
	t.Parallel()
	if got := clampPositive(-1, 7); got != 7 {
		t.Fatalf("clampPositive=%d", got)
	}
	if got := clampDuration(0, time.Second); got != time.Second {
		t.Fatalf("clampDuration=%s", got)
	}
}
