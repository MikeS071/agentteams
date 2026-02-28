package orchestrator

import (
	"strings"
	"testing"

	"github.com/BurntSushi/toml"
)

type parsedOpenFangConfig struct {
	Server struct {
		Port        int  `toml:"port"`
		AuthEnabled bool `toml:"auth_enabled"`
	} `toml:"server"`
	LLM struct {
		DefaultModel string `toml:"default_model"`
		Providers    struct {
			OpenAI struct {
				APIKey string `toml:"api_key"`
			} `toml:"openai"`
			Anthropic struct {
				APIKey string `toml:"api_key"`
			} `toml:"anthropic"`
		} `toml:"providers"`
	} `toml:"llm"`
	Hands struct {
		Enabled []string `toml:"enabled"`
	} `toml:"hands"`
}

func TestGenerateConfig(t *testing.T) {
	cfg := TenantConfig{
		TenantID:      "tenant-123",
		DefaultModel:  "gpt-4o",
		OpenAIKey:     "openai-test-key",
		AnthropicKey:  "anthropic-test-key",
		DashboardPort: 4200,
		AuthDisabled:  true,
		EnabledHands:  []string{"researcher", "lead", "collector", "predictor", "twitter", "browser", "clip"},
	}

	rendered, err := GenerateConfig(cfg)
	if err != nil {
		t.Fatalf("GenerateConfig returned error: %v", err)
	}

	mustContain := []string{
		"[server]",
		"port = 4200",
		"auth_enabled = false",
		"[llm]",
		"default_model = \"gpt-4o\"",
		"[llm.providers.openai]",
		"api_key = \"openai-test-key\"",
		"[llm.providers.anthropic]",
		"api_key = \"anthropic-test-key\"",
		"[hands]",
		"enabled = [\"researcher\", \"lead\", \"collector\", \"predictor\", \"twitter\", \"browser\", \"clip\"]",
	}
	for _, expected := range mustContain {
		if !strings.Contains(rendered, expected) {
			t.Fatalf("rendered config missing %q\n%s", expected, rendered)
		}
	}

	var parsed parsedOpenFangConfig
	if _, err := toml.Decode(rendered, &parsed); err != nil {
		t.Fatalf("rendered TOML was not parseable: %v\n%s", err, rendered)
	}

	if parsed.Server.Port != 4200 {
		t.Fatalf("expected server port 4200, got %d", parsed.Server.Port)
	}
	if parsed.Server.AuthEnabled {
		t.Fatalf("expected auth_enabled=false, got true")
	}
	if parsed.LLM.DefaultModel != "gpt-4o" {
		t.Fatalf("expected default model gpt-4o, got %q", parsed.LLM.DefaultModel)
	}
	if parsed.LLM.Providers.OpenAI.APIKey != "openai-test-key" {
		t.Fatalf("unexpected openai api key: %q", parsed.LLM.Providers.OpenAI.APIKey)
	}
	if parsed.LLM.Providers.Anthropic.APIKey != "anthropic-test-key" {
		t.Fatalf("unexpected anthropic api key: %q", parsed.LLM.Providers.Anthropic.APIKey)
	}
	if len(parsed.Hands.Enabled) != 7 {
		t.Fatalf("expected 7 enabled hands, got %d", len(parsed.Hands.Enabled))
	}
}
