package main

import (
	"database/sql"
	"fmt"
	"log"
	"log/slog"
	"net/http"
	"os"

	"github.com/agentteams/api/coordinator"
	"github.com/agentteams/api/llmproxy"
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
	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		var err error
		db, err = sql.Open("postgres", dsn)
		if err != nil {
			slog.Error("failed to connect to database", "err", err)
		} else {
			reg, err := llmproxy.NewModelRegistry(db)
			if err != nil {
				slog.Error("failed to load model registry", "err", err)
			} else {
				proxy := llmproxy.NewProxy(db, reg)
				proxy.Mount(mux)
				slog.Info("LLM proxy mounted")
			}
		}
	} else {
		slog.Warn("DATABASE_URL not set, LLM proxy and terminal disabled")
	}

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
