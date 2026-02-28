package workflows

import (
	"errors"
	"testing"
)

func sampleWorkflow() map[string]Workflow {
	return map[string]Workflow{
		"wf": {
			ID:   "wf",
			Name: "WF",
			Steps: []Step{
				{ID: "s1", Type: "text", Prompt: "S1"},
				{ID: "s2", Type: "choice", Prompt: "S2", Options: []string{"a", "b"}},
			},
		},
	}
}

func TestRunnerLifecycle(t *testing.T) {
	t.Parallel()
	r := NewRunner(sampleWorkflow())

	run, err := r.Start("wf", "tenant-1")
	if err != nil {
		t.Fatalf("Start: %v", err)
	}

	next, done, err := r.SubmitStep(run.ID, "input")
	if err != nil || done {
		t.Fatalf("SubmitStep 1 err=%v done=%v", err, done)
	}
	if next == nil || next.ID != "s2" {
		t.Fatalf("unexpected next step: %#v", next)
	}

	next, done, err = r.SubmitStep(run.ID, "a")
	if err != nil || !done || next != nil {
		t.Fatalf("SubmitStep 2 err=%v done=%v next=%#v", err, done, next)
	}

	brief, err := r.Confirm(run.ID)
	if err != nil {
		t.Fatalf("Confirm: %v", err)
	}
	if brief == "" {
		t.Fatalf("expected compiled brief")
	}

	stored, err := r.GetRun(run.ID)
	if err != nil || stored.Status != "confirmed" {
		t.Fatalf("GetRun err=%v run=%#v", err, stored)
	}
}

func TestRunnerErrorPaths(t *testing.T) {
	t.Parallel()
	r := NewRunner(sampleWorkflow())

	if _, err := r.Start("missing", "tenant"); !errors.Is(err, ErrWorkflowNotFound) {
		t.Fatalf("expected ErrWorkflowNotFound, got %v", err)
	}
	if _, err := r.Start("wf", ""); err == nil {
		t.Fatalf("expected tenant required error")
	}
	if _, _, err := r.SubmitStep("missing", "x"); !errors.Is(err, ErrRunNotFound) {
		t.Fatalf("expected ErrRunNotFound, got %v", err)
	}
}

func TestRunnerNormalizeInput(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		step    Step
		input   string
		wantErr bool
	}{
		{name: "text", step: Step{ID: "a", Type: "text"}, input: "x"},
		{name: "choice invalid", step: Step{ID: "b", Type: "choice", Options: []string{"yes"}}, input: "no", wantErr: true},
		{name: "confirm default", step: Step{ID: "c", Type: "confirm"}, input: ""},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := normalizeInput(tt.step, tt.input)
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeInput err=%v wantErr=%v", err, tt.wantErr)
			}
		})
	}
}
