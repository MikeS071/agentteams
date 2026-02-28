package orchestrator

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/BurntSushi/toml"
)

const (
	defaultConfigDir    = "agentteams-openfang-config"
	containerConfigPath = "/workspace/openfang.toml"
)

var tenantIDSanitizer = regexp.MustCompile(`[^a-zA-Z0-9_-]`)

// GeneratedConfig references the rendered host config path and mount target.
type GeneratedConfig struct {
	HostPath      string
	ContainerPath string
}

// GenerateConfig writes a tenant-specific OpenFang config file to disk.
func GenerateConfig(ctx context.Context, tenant TenantConfig) (GeneratedConfig, error) {
	if err := ctx.Err(); err != nil {
		return GeneratedConfig{}, err
	}
	if tenant.TenantID == "" {
		return GeneratedConfig{}, fmt.Errorf("tenant id is required")
	}

	hostPath, err := tenantConfigPath(tenant.TenantID)
	if err != nil {
		return GeneratedConfig{}, err
	}

	content := map[string]any{
		"tenant_id":        tenant.TenantID,
		"platform_api_url": tenant.PlatformAPIURL,
		"platform_api_key": tenant.PlatformAPIKey,
		"llm_proxy_url":    tenant.LLMProxyURL,
		"openfang": map[string]any{
			"port": tenantPort,
		},
	}

	f, err := os.Create(hostPath)
	if err != nil {
		return GeneratedConfig{}, fmt.Errorf("create config file: %w", err)
	}
	defer f.Close()

	if err := toml.NewEncoder(f).Encode(content); err != nil {
		return GeneratedConfig{}, fmt.Errorf("encode config file: %w", err)
	}

	return GeneratedConfig{
		HostPath:      hostPath,
		ContainerPath: containerConfigPath,
	}, nil
}

// CleanupConfig removes tenant config from the host filesystem.
func CleanupConfig(tenantID string) error {
	if tenantID == "" {
		return nil
	}
	hostPath, err := tenantConfigPath(tenantID)
	if err != nil {
		return err
	}
	if err := os.Remove(hostPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("remove config file: %w", err)
	}
	return nil
}

func tenantConfigPath(tenantID string) (string, error) {
	cfgDir := os.Getenv("TENANT_CONFIG_DIR")
	if cfgDir == "" {
		cfgDir = filepath.Join(os.TempDir(), defaultConfigDir)
	}
	if err := os.MkdirAll(cfgDir, 0o750); err != nil {
		return "", fmt.Errorf("create config dir: %w", err)
	}

	safeTenantID := tenantIDSanitizer.ReplaceAllString(tenantID, "_")
	return filepath.Join(cfgDir, safeTenantID+".toml"), nil
}
