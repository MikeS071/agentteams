package orchestrator

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGenerateConfigAndCleanup(t *testing.T) {
	t.Setenv("TENANT_CONFIG_DIR", t.TempDir())

	cfg, err := GenerateConfig(context.Background(), TenantConfig{
		TenantID:       "tenant-test",
		PlatformAPIURL: "https://platform.local",
		PlatformAPIKey: "secret-key",
		LLMProxyURL:    "http://llm-proxy:8081",
	})
	if err != nil {
		t.Fatalf("GenerateConfig() error = %v", err)
	}
	if cfg.HostPath == "" {
		t.Fatal("GenerateConfig() returned empty host path")
	}
	if cfg.ContainerPath != containerConfigPath {
		t.Fatalf("container path = %q, want %q", cfg.ContainerPath, containerConfigPath)
	}

	if _, err := os.Stat(cfg.HostPath); err != nil {
		t.Fatalf("config file should exist: %v", err)
	}

	content, err := os.ReadFile(cfg.HostPath)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}
	text := string(content)
	for _, want := range []string{
		"tenant-test",
		"https://platform.local",
		"secret-key",
		"http://llm-proxy:8081",
		"port = 4200",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("config missing %q in:\n%s", want, text)
		}
	}

	if err := CleanupConfig("tenant-test"); err != nil {
		t.Fatalf("CleanupConfig() error = %v", err)
	}
	if _, err := os.Stat(cfg.HostPath); !os.IsNotExist(err) {
		t.Fatalf("expected config file to be removed, stat err = %v", err)
	}
}

func TestTenantConfigPathSanitizesTenantID(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("TENANT_CONFIG_DIR", dir)

	path, err := tenantConfigPath("tenant/../../bad")
	if err != nil {
		t.Fatalf("tenantConfigPath() error = %v", err)
	}
	if filepath.Dir(path) != dir {
		t.Fatalf("path escaped dir: %q", path)
	}
	if strings.Contains(filepath.Base(path), "/") {
		t.Fatalf("path not sanitized: %q", path)
	}
}
