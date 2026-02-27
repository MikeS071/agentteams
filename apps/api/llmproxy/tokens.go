package llmproxy

// ExtractOpenAIUsage extracts token counts from an OpenAI response body map.
func ExtractOpenAIUsage(body map[string]any) (input, output int) {
	usage, ok := body["usage"].(map[string]any)
	if !ok {
		return 0, 0
	}
	input = jsonInt(usage, "prompt_tokens")
	output = jsonInt(usage, "completion_tokens")
	return
}

// ExtractAnthropicUsage extracts token counts from an Anthropic response body map.
func ExtractAnthropicUsage(body map[string]any) (input, output int) {
	usage, ok := body["usage"].(map[string]any)
	if !ok {
		return 0, 0
	}
	input = jsonInt(usage, "input_tokens")
	output = jsonInt(usage, "output_tokens")
	return
}

// ExtractGeminiUsage extracts token counts from a Gemini response body map.
func ExtractGeminiUsage(body map[string]any) (input, output int) {
	meta, ok := body["usageMetadata"].(map[string]any)
	if !ok {
		return 0, 0
	}
	input = jsonInt(meta, "promptTokenCount")
	output = jsonInt(meta, "candidatesTokenCount")
	return
}

// EstimateTokens is a rough fallback: ~4 chars per token.
func EstimateTokens(text string) int {
	n := len(text) / 4
	if n < 1 {
		n = 1
	}
	return n
}

func jsonInt(m map[string]any, key string) int {
	v, ok := m[key]
	if !ok {
		return 0
	}
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	default:
		return 0
	}
}
