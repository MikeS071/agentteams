package orchestrator

import (
	"context"
	"time"
)

// TenantOrchestrator manages tenant container lifecycle.
type TenantOrchestrator interface {
	Create(ctx context.Context, tenantID string) (*Container, error)
	Start(ctx context.Context, tenantID string) error
	Stop(ctx context.Context, tenantID string) error
	Delete(ctx context.Context, tenantID string) error
	Status(ctx context.Context, tenantID string) (*ContainerStatus, error)
	Exec(ctx context.Context, tenantID string, cmd []string) (string, error)
}

// Container represents a tenant's running container.
type Container struct {
	ID       string `json:"id"`
	TenantID string `json:"tenant_id"`
	Status   string `json:"status"`
	IP       string `json:"ip"`
	Port     int    `json:"port"`
}

// ContainerStatus holds runtime info about a tenant container.
type ContainerStatus struct {
	Running   bool      `json:"running"`
	StartedAt time.Time `json:"started_at"`
	Health    string    `json:"health"` // healthy, unhealthy, starting
	MemoryMB  int64     `json:"memory_mb"`
	CPUPct    float64   `json:"cpu_pct"`
}
