package workflows

import (
	"strings"
	"testing"
)

func TestCompileTaskBrief(t *testing.T) {
	t.Parallel()
	wf := Workflow{ID: "w1", Name: "Build API", Steps: []Step{{ID: "goal", Prompt: "Goal"}, {ID: "scope", Prompt: "Scope"}, {ID: "empty", Prompt: "Empty"}}}

	tests := []struct {
		name   string
		inputs map[string]string
		want   []string
	}{
		{name: "happy path", inputs: map[string]string{"goal": "ship", "scope": "backend"}, want: []string{"## Task: Build API", "### Goal", "ship", "### Scope"}},
		{name: "skips empty values", inputs: map[string]string{"goal": "ship", "empty": "   "}, want: []string{"### Goal", "ship"}},
		{name: "empty inputs keeps title", inputs: map[string]string{}, want: []string{"## Task: Build API"}},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			out := CompileTaskBrief(wf, tt.inputs)
			for _, want := range tt.want {
				if !strings.Contains(out, want) {
					t.Fatalf("CompileTaskBrief missing %q in %q", want, out)
				}
			}
		})
	}
}
