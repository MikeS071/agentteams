package orchestrator

import (
	"context"
	"testing"
)

type testOrchestrator struct{}

func (testOrchestrator) Create(context.Context, string) (*Container, error) { return &Container{}, nil }
func (testOrchestrator) Start(context.Context, string) error                { return nil }
func (testOrchestrator) Stop(context.Context, string) error                 { return nil }
func (testOrchestrator) Delete(context.Context, string) error               { return nil }
func (testOrchestrator) Status(context.Context, string) (*ContainerStatus, error) {
	return &ContainerStatus{}, nil
}
func (testOrchestrator) Exec(context.Context, string, []string) (string, error) { return "", nil }

func TestTenantOrchestratorInterface(t *testing.T) {
	t.Parallel()
	var _ TenantOrchestrator = testOrchestrator{}
}
