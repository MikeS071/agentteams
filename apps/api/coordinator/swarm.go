package coordinator

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const workspaceBase = "/workspace/swarm"

// SpawnAgent creates a tmux session for a sub-task and launches its worker.
func (c *Coordinator) SpawnAgent(subtask *SubTask, channelCtx *ChannelContext) error {
	dir := filepath.Join(workspaceBase, subtask.ID)
	if err := os.MkdirAll(filepath.Join(dir, "output"), 0o755); err != nil {
		return fmt.Errorf("create workspace dir: %w", err)
	}

	// Write task brief
	if err := os.WriteFile(filepath.Join(dir, "TASK.md"), []byte(subtask.Brief), 0o644); err != nil {
		return fmt.Errorf("write task brief: %w", err)
	}
	if err := writeChannelContextFile(dir, channelCtx); err != nil {
		return err
	}

	sessionName := fmt.Sprintf("agent-%s", subtask.ID)
	subtask.TmuxSession = sessionName
	subtask.Status = "running"
	subtask.StartedAt = time.Now()

	// Placeholder worker command — future: launch real agent process
	workerCmd := fmt.Sprintf(
		`echo "Working on task..." && sleep 5 && touch %s/DONE`,
		dir,
	)

	cmd := exec.Command("tmux", "new-session", "-d", "-s", sessionName, workerCmd)
	if err := cmd.Run(); err != nil {
		subtask.Status = "failed"
		return fmt.Errorf("spawn tmux session %s: %w", sessionName, err)
	}

	slog.Info("spawned sub-agent", "tenant", c.TenantID, "subtask", subtask.ID, "session", sessionName)
	return nil
}

func writeChannelContextFile(dir string, ctx *ChannelContext) error {
	if ctx == nil {
		return nil
	}
	encoded, err := json.MarshalIndent(ctx, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal channel context: %w", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "CHANNEL_CONTEXT.json"), encoded, 0o644); err != nil {
		return fmt.Errorf("write channel context: %w", err)
	}
	return nil
}

// MonitorAgents polls for sub-task completions and sends updates on the returned channel.
func (c *Coordinator) MonitorAgents(ctx context.Context, subtasks []*SubTask) <-chan *SubTask {
	ch := make(chan *SubTask, len(subtasks))

	go func() {
		defer close(ch)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				allDone := true
				for _, st := range subtasks {
					if st.Status != "running" {
						continue
					}
					allDone = false

					dir := filepath.Join(workspaceBase, st.ID)
					doneFile := filepath.Join(dir, "DONE")

					// Check timeout
					if time.Since(st.StartedAt) > c.Timeout {
						st.Status = "timeout"
						slog.Warn("sub-agent timed out", "subtask", st.ID)
						ch <- st
						continue
					}

					// Check DONE marker
					if _, err := os.Stat(doneFile); err == nil {
						st.Status = "complete"
						slog.Info("sub-agent completed", "subtask", st.ID)
						ch <- st
						continue
					}

					// Check if tmux session still exists
					cmd := exec.Command("tmux", "has-session", "-t", st.TmuxSession)
					if err := cmd.Run(); err != nil {
						// Session gone without DONE marker → failed
						st.Status = "failed"
						slog.Warn("sub-agent session exited without DONE", "subtask", st.ID)
						ch <- st
					}
				}
				if allDone {
					return
				}
			}
		}
	}()

	return ch
}

// CollectOutput reads output files from a sub-task workspace.
func CollectOutput(subtask *SubTask) (string, error) {
	outputDir := filepath.Join(workspaceBase, subtask.ID, "output")
	entries, err := os.ReadDir(outputDir)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("read output dir: %w", err)
	}

	var sb strings.Builder
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		data, err := os.ReadFile(filepath.Join(outputDir, e.Name()))
		if err != nil {
			continue
		}
		sb.WriteString(fmt.Sprintf("--- %s ---\n", e.Name()))
		sb.Write(data)
		sb.WriteString("\n")
	}
	return sb.String(), nil
}

// Cleanup kills the tmux session and optionally removes workspace files.
func Cleanup(subtask *SubTask) error {
	if subtask.TmuxSession != "" {
		cmd := exec.Command("tmux", "kill-session", "-t", subtask.TmuxSession)
		_ = cmd.Run() // ignore error if already dead
	}
	dir := filepath.Join(workspaceBase, subtask.ID)
	return os.RemoveAll(dir)
}
