package routes

import (
	"net/http"

	"github.com/agentteams/api/coordinator"
)

// MountSwarmRoutes registers swarm coordinator endpoints.
func MountSwarmRoutes(mux *http.ServeMux, handler *coordinator.Handler) {
	if mux == nil || handler == nil {
		return
	}
	handler.Mount(mux)
}
