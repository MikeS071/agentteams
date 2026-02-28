package orchestrator

import (
	"testing"

	"github.com/docker/docker/api/types/container"
)

func TestMapContainerStateStringToTenantStatus(t *testing.T) {
	tests := []struct {
		state string
		want  string
	}{
		{state: "running", want: "running"},
		{state: "created", want: "creating"},
		{state: "restarting", want: "creating"},
		{state: "paused", want: "stopped"},
		{state: "exited", want: "stopped"},
		{state: "dead", want: "error"},
		{state: "unknown", want: "error"},
	}

	for _, tt := range tests {
		t.Run(tt.state, func(t *testing.T) {
			if got := mapContainerStateStringToTenantStatus(tt.state); got != tt.want {
				t.Fatalf("mapContainerStateStringToTenantStatus(%q) = %q, want %q", tt.state, got, tt.want)
			}
		})
	}
}

func TestMapContainerStateToTenantStatus(t *testing.T) {
	if got := mapContainerStateToTenantStatus(nil); got != "error" {
		t.Fatalf("mapContainerStateToTenantStatus(nil) = %q, want error", got)
	}

	state := &container.State{Status: "running"}
	if got := mapContainerStateToTenantStatus(state); got != "running" {
		t.Fatalf("mapContainerStateToTenantStatus(running) = %q, want running", got)
	}
}
