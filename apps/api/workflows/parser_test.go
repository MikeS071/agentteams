package workflows

import (
	"path/filepath"
	"runtime"
	"testing"
)

func TestParseStarterWorkflows(t *testing.T) {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("unable to resolve test file location")
	}

	workflowDir := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "data", "workflows"))
	workflows, err := LoadWorkflows(workflowDir)
	if err != nil {
		t.Fatalf("load workflows: %v", err)
	}

	required := []string{"research", "coder", "social"}
	for _, id := range required {
		if _, ok := workflows[id]; !ok {
			t.Fatalf("missing workflow %q", id)
		}
	}
}
