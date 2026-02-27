package workflows

import (
	"fmt"
	"strings"
)

// CompileTaskBrief compiles workflow inputs into a structured markdown brief.
func CompileTaskBrief(workflow Workflow, inputs map[string]string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "## Task: %s\n\n", workflow.Name)

	for _, step := range workflow.Steps {
		value := strings.TrimSpace(inputs[step.ID])
		if value == "" {
			continue
		}
		fmt.Fprintf(&b, "### %s\n%s\n\n", step.Prompt, value)
	}

	return strings.TrimSpace(b.String()) + "\n"
}
