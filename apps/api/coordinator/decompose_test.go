package coordinator

import "testing"

func TestDecompose(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		task    string
		wantErr bool
		min     int
	}{
		{name: "numbered task", task: "1. Research\n2. Build\n3. Test", min: 3},
		{name: "and split", task: "research and build and test", min: 3},
		{name: "empty", task: " ", wantErr: true, min: 0},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			subtasks, err := Decompose(tt.task, "")
			if (err != nil) != tt.wantErr {
				t.Fatalf("Decompose err=%v wantErr=%v", err, tt.wantErr)
			}
			if !tt.wantErr && len(subtasks) < tt.min {
				t.Fatalf("expected at least %d subtasks, got %d", tt.min, len(subtasks))
			}
		})
	}
}

func TestRenderDecompositionPrompt(t *testing.T) {
	t.Parallel()
	if got := renderDecompositionPrompt("Task => {{task}}", "x"); got != "Task => x" {
		t.Fatalf("renderDecompositionPrompt=%q", got)
	}
}
