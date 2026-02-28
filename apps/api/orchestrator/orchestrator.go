package orchestrator

import (
	"context"
)

// TenantOrchestrator manages tenant container lifecycle.
type TenantOrchestrator interface {
	CreateTenant(ctx context.Context, tenant TenantConfig) (ContainerInfo, error)
	StartTenant(ctx context.Context, tenantID string) error
	StopTenant(ctx context.Context, tenantID string) error
	DestroyTenant(ctx context.Context, tenantID string) error
	GetStatus(ctx context.Context, tenantID string) (TenantStatus, error)
	ListTenants(ctx context.Context) ([]TenantStatus, error)
}

// TenantConfig stores tenant-scoped runtime config.
type TenantConfig struct {
	TenantID       string
	PlatformAPIURL string
	PlatformAPIKey string
	LLMProxyURL    string
}

// ContainerInfo represents a tenant container identity and runtime status.
type ContainerInfo struct {
	ContainerID string `json:"container_id"`
	Port        int    `json:"port"`
	Status      string `json:"status"`
}

// TenantStatus combines Docker state and OpenFang health for a tenant.
type TenantStatus struct {
	TenantID    string `json:"tenant_id"`
	ContainerID string `json:"container_id"`
	Port        int    `json:"port"`
	Status      string `json:"status"` // running, stopped, creating, error
	OpenFangOK  bool   `json:"openfang_ok"`
}
