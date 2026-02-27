package workflows

import (
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
)

var (
	ErrWorkflowNotFound = errors.New("workflow not found")
	ErrRunNotFound      = errors.New("workflow run not found")
	ErrRunNotInProgress = errors.New("workflow run is not in progress")
	ErrRunIncomplete    = errors.New("workflow run is not complete")
)

// WorkflowRun tracks one active workflow execution.
type WorkflowRun struct {
	ID          string            `json:"id"`
	WorkflowID  string            `json:"workflow_id"`
	TenantID    string            `json:"tenant_id"`
	CurrentStep int               `json:"current_step"`
	Inputs      map[string]string `json:"inputs"`
	Status      string            `json:"status"`
}

// Runner manages active in-memory workflow runs.
type Runner struct {
	mu        sync.RWMutex
	workflows map[string]Workflow
	runs      map[string]*WorkflowRun
}

func NewRunner(workflows map[string]Workflow) *Runner {
	cloned := make(map[string]Workflow, len(workflows))
	for id, workflow := range workflows {
		cloned[id] = workflow
	}
	return &Runner{
		workflows: cloned,
		runs:      make(map[string]*WorkflowRun),
	}
}

// Start creates a new run for the given workflow and tenant.
func (r *Runner) Start(workflowID, tenantID string) (*WorkflowRun, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, fmt.Errorf("tenant id is required")
	}

	r.mu.Lock()
	defer r.mu.Unlock()

	if _, ok := r.workflows[workflowID]; !ok {
		return nil, ErrWorkflowNotFound
	}

	run := &WorkflowRun{
		ID:          uuid.NewString(),
		WorkflowID:  workflowID,
		TenantID:    tenantID,
		CurrentStep: 0,
		Inputs:      map[string]string{},
		Status:      "in_progress",
	}
	r.runs[run.ID] = run

	return cloneRun(run), nil
}

// SubmitStep stores input for the current step and advances the run.
func (r *Runner) SubmitStep(runID string, input string) (*Step, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	run, ok := r.runs[runID]
	if !ok {
		return nil, false, ErrRunNotFound
	}
	if run.Status != "in_progress" {
		return nil, false, ErrRunNotInProgress
	}

	workflow, ok := r.workflows[run.WorkflowID]
	if !ok {
		return nil, false, ErrWorkflowNotFound
	}
	if run.CurrentStep >= len(workflow.Steps) {
		return nil, true, nil
	}

	step := workflow.Steps[run.CurrentStep]
	normalized, err := normalizeInput(step, input)
	if err != nil {
		return nil, false, err
	}
	run.Inputs[step.ID] = normalized
	run.CurrentStep++

	if run.CurrentStep >= len(workflow.Steps) {
		return nil, true, nil
	}

	next := workflow.Steps[run.CurrentStep]
	return &next, false, nil
}

// Confirm compiles a final task brief and marks the run as confirmed.
func (r *Runner) Confirm(runID string) (string, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	run, ok := r.runs[runID]
	if !ok {
		return "", ErrRunNotFound
	}
	if run.Status != "in_progress" {
		return "", ErrRunNotInProgress
	}

	workflow, ok := r.workflows[run.WorkflowID]
	if !ok {
		return "", ErrWorkflowNotFound
	}
	if run.CurrentStep < len(workflow.Steps) {
		return "", ErrRunIncomplete
	}

	brief := CompileTaskBrief(workflow, run.Inputs)
	run.Status = "confirmed"
	return brief, nil
}

// GetRun returns the current run state.
func (r *Runner) GetRun(runID string) (*WorkflowRun, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	run, ok := r.runs[runID]
	if !ok {
		return nil, ErrRunNotFound
	}
	return cloneRun(run), nil
}

// GetCurrentStep returns the next step to fill in, or nil if completed.
func (r *Runner) GetCurrentStep(runID string) (*Step, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	run, ok := r.runs[runID]
	if !ok {
		return nil, ErrRunNotFound
	}

	workflow, ok := r.workflows[run.WorkflowID]
	if !ok {
		return nil, ErrWorkflowNotFound
	}
	if run.CurrentStep >= len(workflow.Steps) {
		return nil, nil
	}

	step := workflow.Steps[run.CurrentStep]
	return &step, nil
}

// ListWorkflows returns all loaded workflows in deterministic order.
func (r *Runner) ListWorkflows() []Workflow {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return SortedWorkflows(r.workflows)
}

func normalizeInput(step Step, input string) (string, error) {
	value := strings.TrimSpace(input)
	if value == "" && strings.TrimSpace(step.Default) != "" {
		value = strings.TrimSpace(step.Default)
	}

	switch step.Type {
	case "text", "file_upload":
		if value == "" {
			return "", fmt.Errorf("step %q requires input", step.ID)
		}
		return value, nil
	case "choice":
		if value == "" {
			return "", fmt.Errorf("step %q requires one of the configured options", step.ID)
		}
		for _, option := range step.Options {
			if option == value {
				return value, nil
			}
		}
		return "", fmt.Errorf("step %q input must match one of the configured options", step.ID)
	case "confirm":
		if value == "" {
			value = "Yes"
		}
		return value, nil
	default:
		return "", fmt.Errorf("unsupported step type %q", step.Type)
	}
}

func cloneRun(run *WorkflowRun) *WorkflowRun {
	inputs := make(map[string]string, len(run.Inputs))
	for k, v := range run.Inputs {
		inputs[k] = v
	}
	return &WorkflowRun{
		ID:          run.ID,
		WorkflowID:  run.WorkflowID,
		TenantID:    run.TenantID,
		CurrentStep: run.CurrentStep,
		Inputs:      inputs,
		Status:      run.Status,
	}
}
