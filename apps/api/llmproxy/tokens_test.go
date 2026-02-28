package llmproxy

import "testing"

func TestExtractOpenAIUsage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		body    map[string]any
		wantIn  int
		wantOut int
	}{
		{name: "happy path", body: map[string]any{"usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 34}}, wantIn: 12, wantOut: 34},
		{name: "missing usage", body: map[string]any{}, wantIn: 0, wantOut: 0},
		{name: "float values", body: map[string]any{"usage": map[string]any{"prompt_tokens": float64(7), "completion_tokens": float64(8)}}, wantIn: 7, wantOut: 8},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotIn, gotOut := ExtractOpenAIUsage(tt.body)
			if gotIn != tt.wantIn || gotOut != tt.wantOut {
				t.Fatalf("ExtractOpenAIUsage() = (%d,%d), want (%d,%d)", gotIn, gotOut, tt.wantIn, tt.wantOut)
			}
		})
	}
}

func TestExtractAnthropicUsage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		body    map[string]any
		wantIn  int
		wantOut int
	}{
		{name: "happy path", body: map[string]any{"usage": map[string]any{"input_tokens": 4, "output_tokens": 9}}, wantIn: 4, wantOut: 9},
		{name: "missing usage", body: map[string]any{}, wantIn: 0, wantOut: 0},
		{name: "wrong types", body: map[string]any{"usage": map[string]any{"input_tokens": "4", "output_tokens": true}}, wantIn: 0, wantOut: 0},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotIn, gotOut := ExtractAnthropicUsage(tt.body)
			if gotIn != tt.wantIn || gotOut != tt.wantOut {
				t.Fatalf("ExtractAnthropicUsage() = (%d,%d), want (%d,%d)", gotIn, gotOut, tt.wantIn, tt.wantOut)
			}
		})
	}
}

func TestExtractGeminiUsage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		body    map[string]any
		wantIn  int
		wantOut int
	}{
		{name: "happy path", body: map[string]any{"usageMetadata": map[string]any{"promptTokenCount": 13, "candidatesTokenCount": 27}}, wantIn: 13, wantOut: 27},
		{name: "missing metadata", body: map[string]any{}, wantIn: 0, wantOut: 0},
		{name: "partial metadata", body: map[string]any{"usageMetadata": map[string]any{"promptTokenCount": 5}}, wantIn: 5, wantOut: 0},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			gotIn, gotOut := ExtractGeminiUsage(tt.body)
			if gotIn != tt.wantIn || gotOut != tt.wantOut {
				t.Fatalf("ExtractGeminiUsage() = (%d,%d), want (%d,%d)", gotIn, gotOut, tt.wantIn, tt.wantOut)
			}
		})
	}
}

func TestEstimateTokens(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		text string
		want int
	}{
		{name: "empty string minimum one", text: "", want: 1},
		{name: "unicode string", text: "こんにちは世界", want: 5},
		{name: "very long string", text: string(make([]byte, 4000)), want: 1000},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := EstimateTokens(tt.text)
			if got != tt.want {
				t.Fatalf("EstimateTokens() = %d, want %d", got, tt.want)
			}
		})
	}
}
