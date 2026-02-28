package routes

import (
	"strings"
	"testing"
)

func TestParseTypeFilter(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		raw  string
		want int
	}{
		{name: "multiple", raw: "a,b", want: 2},
		{name: "spaces", raw: " a , b ", want: 2},
		{name: "empty", raw: "", want: 0},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := parseTypeFilter(tt.raw)
			if tt.want == 0 && got != nil {
				t.Fatalf("expected nil filter")
			}
			if tt.want > 0 && len(got) != tt.want {
				t.Fatalf("len=%d want=%d", len(got), tt.want)
			}
		})
	}
}

func TestEventBlockFiltering(t *testing.T) {
	t.Parallel()
	block := []string{"event: hand\n", "data: {\"type\":\"hand\"}\n"}
	if !shouldForwardBlock(block, nil) {
		t.Fatalf("expected forward without filter")
	}
	allowed := map[string]struct{}{"hand": {}}
	if !shouldForwardBlock(block, allowed) {
		t.Fatalf("expected forward with matching type")
	}
	allowed = map[string]struct{}{"other": {}}
	if shouldForwardBlock(block, allowed) {
		t.Fatalf("expected filtered out")
	}
}

func TestExtractDataPayload(t *testing.T) {
	t.Parallel()
	payload := extractDataPayload([]string{"data: one\n", "id: 1\n", "data: two\n"})
	if strings.TrimSpace(payload) != "one\ntwo" {
		t.Fatalf("payload=%q", payload)
	}
}
