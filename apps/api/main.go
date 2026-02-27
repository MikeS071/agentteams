package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/agentteams/api/coordinator"
	"github.com/agentteams/api/llmproxy"
	"github.com/agentteams/api/orchestrator"
	"github.com/agentteams/api/terminal"

	_ "github.com/lib/pq"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Hello from AgentTeams API")
	})

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, `{"status":"ok"}`)
	})

	// Initialize database connection
	var db *sql.DB
	var orch orchestrator.TenantOrchestrator
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		var err error
		db, err = sql.Open("postgres", dsn)
		if err != nil {
			slog.Error("failed to connect to database", "err", err)
		} else {
			orchImpl, err := orchestrator.NewDockerOrchestrator(
				db,
				os.Getenv("PLATFORM_API_URL"),
				os.Getenv("PLATFORM_API_KEY"),
				os.Getenv("LLM_PROXY_URL"),
			)
			if err != nil {
				slog.Error("failed to initialize orchestrator", "err", err)
			} else {
				orch = orchImpl
			}

			reg, err := llmproxy.NewModelRegistry(db)
			if err != nil {
				slog.Error("failed to load model registry", "err", err)
			} else {
				proxy := llmproxy.NewProxy(db, reg, orch)
				proxy.Mount(mux)
				slog.Info("LLM proxy mounted")
			}
		}
	} else {
		slog.Warn("DATABASE_URL not set, LLM proxy and terminal disabled")
	}

	mux.HandleFunc("POST /api/tenants/{id}/resume", func(w http.ResponseWriter, r *http.Request) {
		if db == nil {
			http.Error(w, `{"error":"database is not configured"}`, http.StatusServiceUnavailable)
			return
		}
		if orch == nil {
			http.Error(w, `{"error":"orchestrator is not configured"}`, http.StatusServiceUnavailable)
			return
		}

		tenantID := r.PathValue("id")
		if tenantID == "" {
			http.Error(w, `{"error":"missing tenant id"}`, http.StatusBadRequest)
			return
		}

		balance, err := llmproxy.CheckCredits(db, tenantID)
		if err != nil {
			slog.Error("credit check failed before resume", "tenant", tenantID, "err", err)
			http.Error(w, `{"error":"billing error"}`, http.StatusInternalServerError)
			return
		}

		if balance <= 0 {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusPaymentRequired)
			_ = json.NewEncoder(w).Encode(map[string]string{"error": "insufficient credits"})
			return
		}

		if err := llmproxy.ResumeTenant(db, orch, tenantID); err != nil {
			slog.Error("resume tenant failed", "tenant", tenantID, "err", err)
			http.Error(w, `{"error":"failed to resume tenant"}`, http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "active"})
	})

	// Mount swarm coordinator
	coordHandler := coordinator.NewHandler()
	coordHandler.Mount(mux)
	slog.Info("coordinator handler mounted")

	// Mount terminal WebSocket handler
	if db != nil {
		mux.Handle("GET /api/tenants/{id}/terminal", terminal.Handler(db))
		slog.Info("terminal handler mounted")
	}

	log.Println("API server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
}
