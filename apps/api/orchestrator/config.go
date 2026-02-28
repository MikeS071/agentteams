package orchestrator

import (
	"archive/tar"
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/BurntSushi/toml"
	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

const (
	defaultOpenFangModel = "gpt-4o"
	configReadyFile      = "config.ready"
	configTomlFile       = "config.toml"
)

var defaultHands = []string{
	"researcher",
	"lead",
	"collector",
	"predictor",
	"twitter",
	"browser",
	"clip",
}

// TenantConfig represents a tenant-specific OpenFang runtime configuration.
type TenantConfig struct {
	TenantID      string
	DefaultModel  string
	OpenAIKey     string
	AnthropicKey  string
	DashboardPort int
	AuthDisabled  bool
	EnabledHands  []string // all 7 by default
}

type openFangConfig struct {
	Server openFangServerConfig `toml:"server"`
	LLM    openFangLLMConfig    `toml:"llm"`
	Hands  openFangHandsConfig  `toml:"hands"`
}

type openFangServerConfig struct {
	Port        int  `toml:"port"`
	AuthEnabled bool `toml:"auth_enabled"`
}

type openFangLLMConfig struct {
	DefaultModel string                  `toml:"default_model"`
	Providers    openFangProviderConfigs `toml:"providers"`
}

type openFangProviderConfigs struct {
	OpenAI    openFangProviderConfig `toml:"openai"`
	Anthropic openFangProviderConfig `toml:"anthropic"`
}

type openFangProviderConfig struct {
	APIKey string `toml:"api_key"`
}

type openFangHandsConfig struct {
	Enabled []string `toml:"enabled"`
}

// GenerateConfig renders OpenFang TOML config content from TenantConfig.
func GenerateConfig(cfg TenantConfig) (string, error) {
	cfg = applyTenantConfigDefaults(cfg)

	rendered := openFangConfig{
		Server: openFangServerConfig{
			Port:        cfg.DashboardPort,
			AuthEnabled: !cfg.AuthDisabled,
		},
		LLM: openFangLLMConfig{
			DefaultModel: cfg.DefaultModel,
			Providers: openFangProviderConfigs{
				OpenAI:    openFangProviderConfig{APIKey: cfg.OpenAIKey},
				Anthropic: openFangProviderConfig{APIKey: cfg.AnthropicKey},
			},
		},
		Hands: openFangHandsConfig{
			Enabled: append([]string(nil), cfg.EnabledHands...),
		},
	}

	var buf bytes.Buffer
	if err := toml.NewEncoder(&buf).Encode(rendered); err != nil {
		return "", fmt.Errorf("encode openfang config: %w", err)
	}
	return buf.String(), nil
}

// InjectConfig writes OpenFang config into a running tenant container.
func InjectConfig(containerID string, cfg TenantConfig) error {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return fmt.Errorf("docker client: %w", err)
	}
	defer cli.Close()

	return injectConfig(context.Background(), cli, containerID, cfg)
}

func injectConfig(ctx context.Context, cli *client.Client, containerID string, cfg TenantConfig) error {
	content, err := GenerateConfig(cfg)
	if err != nil {
		return err
	}

	archive, err := buildConfigArchive(content)
	if err != nil {
		return err
	}

	if err := cli.CopyToContainer(ctx, containerID, "/root", archive, container.CopyToContainerOptions{}); err != nil {
		return fmt.Errorf("copy openfang config to container: %w", err)
	}
	return nil
}

func buildConfigArchive(content string) (*bytes.Buffer, error) {
	buf := new(bytes.Buffer)
	tw := tar.NewWriter(buf)

	writeEntry := func(name string, mode int64, body string, dir bool) error {
		header := &tar.Header{
			Name: name,
			Mode: mode,
		}
		if dir {
			header.Typeflag = tar.TypeDir
		} else {
			header.Size = int64(len(body))
		}
		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		if dir {
			return nil
		}
		_, err := tw.Write([]byte(body))
		return err
	}

	if err := writeEntry(".openfang", 0o755, "", true); err != nil {
		return nil, fmt.Errorf("write archive dir: %w", err)
	}
	if err := writeEntry(".openfang/"+configTomlFile, 0o600, content, false); err != nil {
		return nil, fmt.Errorf("write config.toml archive entry: %w", err)
	}
	if err := writeEntry(".openfang/"+configReadyFile, 0o600, "ready\n", false); err != nil {
		return nil, fmt.Errorf("write ready marker archive entry: %w", err)
	}

	if err := tw.Close(); err != nil {
		return nil, fmt.Errorf("close config archive: %w", err)
	}
	return buf, nil
}

func applyTenantConfigDefaults(cfg TenantConfig) TenantConfig {
	if cfg.DefaultModel == "" {
		cfg.DefaultModel = defaultOpenFangModel
	}
	if cfg.DashboardPort <= 0 {
		cfg.DashboardPort = tenantPort
	}
	if len(cfg.EnabledHands) == 0 {
		cfg.EnabledHands = append([]string(nil), defaultHands...)
	}
	return cfg
}

func (o *DockerOrchestrator) tenantConfigFor(tenantID string) TenantConfig {
	defaultModel := strings.TrimSpace(os.Getenv("OPENFANG_DEFAULT_MODEL"))
	if defaultModel == "" {
		defaultModel = strings.TrimSpace(os.Getenv("LLM_MODEL"))
	}
	if defaultModel == "" {
		defaultModel = defaultOpenFangModel
	}

	return applyTenantConfigDefaults(TenantConfig{
		TenantID:      tenantID,
		DefaultModel:  defaultModel,
		OpenAIKey:     strings.TrimSpace(os.Getenv("OPENAI_API_KEY")),
		AnthropicKey:  strings.TrimSpace(os.Getenv("ANTHROPIC_API_KEY")),
		DashboardPort: tenantPort,
		AuthDisabled:  true,
		EnabledHands:  append([]string(nil), defaultHands...),
	})
}
