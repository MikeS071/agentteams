package coordinator

import (
	"errors"
	"os"
	"testing"
)

func TestCollectOutput(t *testing.T) {
	t.Parallel()
	sub := &SubTask{ID: "does-not-exist"}
	out, err := CollectOutput(sub)
	if err != nil {
		t.Fatalf("CollectOutput: %v", err)
	}
	if out != "" {
		t.Fatalf("expected empty output, got %q", out)
	}
}

func TestCleanup(t *testing.T) {
	t.Parallel()
	sub := &SubTask{ID: "sub-cleanup-nonexistent"}
	if err := Cleanup(sub); err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Cleanup: %v", err)
	}
}

func TestBridgeHelpers(t *testing.T) {
	t.Parallel()
	task, trigger, ok := parseExplicitCommand("/agent run do thing")
	if !ok || task != "do thing" || trigger != "command" {
		t.Fatalf("parseExplicitCommand unexpected: %q %q %v", task, trigger, ok)
	}

	if _, ok := heuristicClassification("hello"); ok {
		t.Fatalf("expected no heuristic match")
	}
	if task, ok := heuristicClassification("please use agents for this"); !ok || task == "" {
		t.Fatalf("expected heuristic match")
	}
}
