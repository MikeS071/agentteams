package workflows

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

var validStepTypes = map[string]struct{}{
	"text":        {},
	"choice":      {},
	"confirm":     {},
	"file_upload": {},
}

// Workflow defines a multi-step prompt template loaded from TOML.
type Workflow struct {
	ID          string `toml:"id" json:"id"`
	Name        string `toml:"name" json:"name"`
	Description string `toml:"description" json:"description"`
	Icon        string `toml:"icon" json:"icon"`
	Steps       []Step `toml:"steps" json:"steps"`
	CostHint    string `toml:"cost_hint" json:"cost_hint"`
}

// Step defines a single interactive workflow prompt.
type Step struct {
	ID      string   `toml:"id" json:"id"`
	Type    string   `toml:"type" json:"type"`
	Prompt  string   `toml:"prompt" json:"prompt"`
	Options []string `toml:"options" json:"options,omitempty"`
	Default string   `toml:"default" json:"default,omitempty"`
	Help    string   `toml:"help" json:"help,omitempty"`
}

// ParseWorkflowFile parses and validates a workflow TOML file.
func ParseWorkflowFile(path string) (Workflow, error) {
	var wf Workflow
	if _, err := toml.DecodeFile(path, &wf); err != nil {
		return Workflow{}, fmt.Errorf("decode workflow %s: %w", path, err)
	}
	if err := validateWorkflow(wf); err != nil {
		return Workflow{}, fmt.Errorf("validate workflow %s: %w", path, err)
	}
	return wf, nil
}

// LoadWorkflows parses all TOML workflow files in dir.
func LoadWorkflows(dir string) (map[string]Workflow, error) {
	pattern := filepath.Join(dir, "*.toml")
	files, err := filepath.Glob(pattern)
	if err != nil {
		return nil, fmt.Errorf("glob %s: %w", pattern, err)
	}
	if len(files) == 0 {
		return nil, fmt.Errorf("no workflow definitions found in %s", dir)
	}

	workflows := make(map[string]Workflow, len(files))
	for _, path := range files {
		wf, err := ParseWorkflowFile(path)
		if err != nil {
			return nil, err
		}
		if _, exists := workflows[wf.ID]; exists {
			return nil, fmt.Errorf("duplicate workflow id %q", wf.ID)
		}
		workflows[wf.ID] = wf
	}
	return workflows, nil
}

// LoadWorkflowsFromDefaultPaths loads workflows from WORKFLOWS_DIR or common repo-relative paths.
func LoadWorkflowsFromDefaultPaths() (map[string]Workflow, string, error) {
	candidates := []string{
		os.Getenv("WORKFLOWS_DIR"),
		filepath.Join("data", "workflows"),
		filepath.Join("..", "..", "data", "workflows"),
	}

	var tried []string
	for _, candidate := range candidates {
		if strings.TrimSpace(candidate) == "" {
			continue
		}
		tried = append(tried, candidate)
		if info, err := os.Stat(candidate); err != nil || !info.IsDir() {
			continue
		}
		workflows, err := LoadWorkflows(candidate)
		if err == nil {
			return workflows, candidate, nil
		}
	}

	return nil, "", fmt.Errorf("unable to load workflows from any path: %s", strings.Join(tried, ", "))
}

// SortedWorkflows returns a deterministic list of workflows ordered by ID.
func SortedWorkflows(workflows map[string]Workflow) []Workflow {
	items := make([]Workflow, 0, len(workflows))
	for _, wf := range workflows {
		items = append(items, wf)
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].ID < items[j].ID
	})
	return items
}

func validateWorkflow(wf Workflow) error {
	if strings.TrimSpace(wf.ID) == "" {
		return fmt.Errorf("missing id")
	}
	if strings.TrimSpace(wf.Name) == "" {
		return fmt.Errorf("missing name")
	}
	if strings.TrimSpace(wf.CostHint) == "" {
		return fmt.Errorf("missing cost_hint")
	}
	if len(wf.Steps) == 0 {
		return fmt.Errorf("missing steps")
	}

	seenStepIDs := make(map[string]struct{}, len(wf.Steps))
	for i, step := range wf.Steps {
		if strings.TrimSpace(step.ID) == "" {
			return fmt.Errorf("step %d missing id", i)
		}
		if _, exists := seenStepIDs[step.ID]; exists {
			return fmt.Errorf("duplicate step id %q", step.ID)
		}
		seenStepIDs[step.ID] = struct{}{}

		if _, ok := validStepTypes[step.Type]; !ok {
			return fmt.Errorf("step %q has invalid type %q", step.ID, step.Type)
		}
		if strings.TrimSpace(step.Prompt) == "" {
			return fmt.Errorf("step %q missing prompt", step.ID)
		}

		if step.Type == "choice" {
			if len(step.Options) == 0 {
				return fmt.Errorf("step %q requires options", step.ID)
			}
			if step.Default != "" {
				found := false
				for _, option := range step.Options {
					if option == step.Default {
						found = true
						break
					}
				}
				if !found {
					return fmt.Errorf("step %q default must match one of the options", step.ID)
				}
			}
		}
	}

	return nil
}
