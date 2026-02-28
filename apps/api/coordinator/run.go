package coordinator

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
)

// Run executes a full swarm run: decompose → spawn → monitor → collect → merge.
func (c *Coordinator) Run(ctx context.Context, task string, runID string, channelCtx *ChannelContext, onEvent func(RunEvent)) (*SwarmRun, error) {
	subtasks, err := Decompose(task, "")
	if err != nil {
		return nil, fmt.Errorf("decompose: %w", err)
	}
	return c.RunWithSubTasks(ctx, task, runID, channelCtx, subtasks, onEvent)
}

// RunWithSubTasks executes a full swarm run with a precomputed decomposition plan.
func (c *Coordinator) RunWithSubTasks(ctx context.Context, task string, runID string, channelCtx *ChannelContext, subtasks []SubTask, onEvent func(RunEvent)) (*SwarmRun, error) {
	if runID == "" {
		runID = uuid.New().String()[:8]
	}

	run := &SwarmRun{
		RunID:          runID,
		TenantID:       c.TenantID,
		Task:           task,
		Status:         "running",
		ChannelContext: channelCtx,
		SubTasks:       subtasks,
	}
	if channelCtx != nil {
		run.SourceChannel = channelCtx.Channel
	}

	slog.Info("starting swarm run", "run", run.RunID, "tenant", c.TenantID, "subtasks", len(subtasks))

	// Build pointer slice for internal tracking
	ptrs := make([]*SubTask, len(subtasks))
	for i := range subtasks {
		ptrs[i] = &run.SubTasks[i]
	}

	// Spawn up to MaxAgents concurrently; queue the rest
	running := 0
	queue := 0
	for _, st := range ptrs {
		if running >= c.MaxAgents {
			queue = 1 // remaining are queued
			break
		}
		if err := c.SpawnAgent(st, channelCtx); err != nil {
			slog.Error("failed to spawn agent", "subtask", st.ID, "err", err)
			st.Status = "failed"
			emitEvent(onEvent, RunEvent{
				Type:      "subtask_update",
				RunID:     run.RunID,
				SubTaskID: st.ID,
				Status:    st.Status,
				Message:   "Failed to spawn sub-agent.",
			})
		} else {
			running++
			emitEvent(onEvent, RunEvent{
				Type:      "subtask_started",
				RunID:     run.RunID,
				SubTaskID: st.ID,
				Status:    st.Status,
				Message:   "Sub-agent started.",
			})
		}
		queue++
	}

	// Monitor and spawn queued tasks as slots free up
	monCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	ch := c.MonitorAgents(monCtx, ptrs)
	nextIdx := queue // index of next task to spawn

	for completed := range ch {
		_ = completed // status already updated in-place
		running--

		// Collect output for completed task
		if completed.Status == "complete" {
			output, err := CollectOutput(completed)
			if err == nil {
				completed.Output = output
			}
		}
		emitEvent(onEvent, RunEvent{
			Type:      "subtask_update",
			RunID:     run.RunID,
			SubTaskID: completed.ID,
			Status:    completed.Status,
			Message:   fmt.Sprintf("Subtask %s is %s.", completed.ID, completed.Status),
		})

		// Spawn next queued task if available
		for nextIdx < len(ptrs) && running < c.MaxAgents {
			st := ptrs[nextIdx]
			nextIdx++
			if err := c.SpawnAgent(st, channelCtx); err != nil {
				slog.Error("failed to spawn queued agent", "subtask", st.ID, "err", err)
				st.Status = "failed"
				emitEvent(onEvent, RunEvent{
					Type:      "subtask_update",
					RunID:     run.RunID,
					SubTaskID: st.ID,
					Status:    st.Status,
					Message:   "Failed to spawn queued sub-agent.",
				})
			} else {
				running++
				emitEvent(onEvent, RunEvent{
					Type:      "subtask_started",
					RunID:     run.RunID,
					SubTaskID: st.ID,
					Status:    st.Status,
					Message:   "Queued sub-agent started.",
				})
			}
		}
	}

	// Merge results
	var sb strings.Builder
	allOK := true
	for _, st := range run.SubTasks {
		if st.Status != "complete" {
			allOK = false
		}
		if st.Output != "" {
			sb.WriteString(fmt.Sprintf("## %s\n%s\n", st.ID, st.Output))
		}
	}

	run.Output = sb.String()
	if allOK {
		run.Status = "complete"
	} else {
		run.Status = "failed"
	}

	// Cleanup all sessions
	for i := range ptrs {
		_ = Cleanup(ptrs[i])
	}

	slog.Info("swarm run finished", "run", run.RunID, "status", run.Status)
	return run, nil
}

func emitEvent(onEvent func(RunEvent), evt RunEvent) {
	if onEvent != nil {
		onEvent(evt)
	}
}
