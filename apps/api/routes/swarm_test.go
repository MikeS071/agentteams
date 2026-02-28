package routes

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/agentsquads/api/coordinator"
)

func TestMountSwarmRoutes(t *testing.T) {
	t.Parallel()
	mux := http.NewServeMux()
	MountSwarmRoutes(nil, nil)
	MountSwarmRoutes(mux, nil)

	h := coordinator.NewHandler(nil)
	MountSwarmRoutes(mux, h)

	req := httptest.NewRequest(http.MethodGet, "/api/swarm/tasks", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
