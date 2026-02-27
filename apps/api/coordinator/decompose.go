package coordinator

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Decompose splits a complex task into sub-tasks using simple heuristics.
// Future: this will call an LLM for intelligent decomposition.
func Decompose(task string) ([]SubTask, error) {
	task = strings.TrimSpace(task)
	if task == "" {
		return nil, fmt.Errorf("empty task")
	}

	parts := splitTask(task)
	subtasks := make([]SubTask, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		id := fmt.Sprintf("sub-%s", uuid.New().String()[:8])
		subtasks = append(subtasks, SubTask{
			ID:     id,
			Brief:  p,
			Status: "pending",
		})
	}

	if len(subtasks) == 0 {
		id := fmt.Sprintf("sub-%s", uuid.New().String()[:8])
		subtasks = append(subtasks, SubTask{
			ID:     id,
			Brief:  task,
			Status: "pending",
		})
	}

	return subtasks, nil
}

// splitTask uses heuristics to break a task string into parts.
func splitTask(task string) []string {
	// Try numbered steps first: "1. ... 2. ... 3. ..."
	lines := strings.Split(task, "\n")
	var numbered []string
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if len(line) >= 3 && line[0] >= '1' && line[0] <= '9' && (line[1] == '.' || (line[1] >= '0' && line[1] <= '9' && len(line) > 2 && line[2] == '.')) {
			// Strip the number prefix
			idx := strings.Index(line, ".")
			if idx >= 0 && idx < len(line)-1 {
				numbered = append(numbered, strings.TrimSpace(line[idx+1:]))
			}
		}
	}
	if len(numbered) > 1 {
		return numbered
	}

	// Try splitting on " and " for compound tasks (only at top level)
	if strings.Contains(task, " and ") && !strings.Contains(task, "\n") {
		parts := strings.Split(task, " and ")
		if len(parts) > 1 && len(parts) <= 5 {
			return parts
		}
	}

	// Single task
	return []string{task}
}
