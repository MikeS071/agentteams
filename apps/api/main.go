package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/agentteams/api/channels"
	"github.com/agentteams/api/coordinator"
	"github.com/agentteams/api/llmproxy"
	"github.com/agentteams/api/orchestrator"
	"github.com/agentteams/api/routes"
	"github.com/agentteams/api/terminal"
	"github.com/agentteams/api/workflows"

	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

func main() {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /", func(w http.ResponseWriter, _ *http.Request) {
		fmt.Fprintln(w, "Hello from AgentTeams API")
	})

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	workflowDefs, workflowDir, err := workflows.LoadWorkflowsFromDefaultPaths()
	if err != nil {
		slog.Error("failed to load workflow templates", "err", err)
	} else {
		workflowRunner := workflows.NewRunner(workflowDefs)
		workflowHandler := workflows.NewHandler(workflowRunner)
		workflowHandler.Mount(mux)
		slog.Info("workflow handler mounted", "dir", workflowDir, "count", len(workflowDefs))
	}

	// Initialize database connection
	var db *sql.DB
	var orch orchestrator.TenantOrchestrator
	var channelRouter *channels.Router
	var channelLinks *channels.LinkStore
	var redisClient *redis.Client

	coordHandler := coordinator.NewHandler(nil)

	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		var err error
		db, err = sql.Open("postgres", dsn)
		if err != nil {
			slog.Error("failed to connect to database", "err", err)
		} else {
			redisClient = initRedisClient()
			coordHandler = coordinator.NewHandler(redisClient)
			channelLinks = channels.NewLinkStore(db)
			channelRouter = channels.NewRouter(db, redisClient)
			channelRouter.SetAgentBridge(coordinator.NewBridge(coordHandler))

			if redisClient != nil {
				fanout := channels.NewFanout(redisClient, channelLinks)
				go func() {
					if err := fanout.Start(context.Background()); err != nil {
						slog.Error("channel fanout stopped", "err", err)
					}
				}()
			}

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

	routes.MountTenantRoutes(
		mux,
		db,
		orch,
		strings.TrimSpace(os.Getenv("SERVICE_API_KEY")),
		strings.TrimSpace(os.Getenv("API_JWT_SECRET")),
	)

	mux.HandleFunc("POST /api/channels/inbound", func(w http.ResponseWriter, r *http.Request) {
		if channelRouter == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "channel router is not configured")
			return
		}

		var req struct {
			TenantID    string            `json:"tenant_id"`
			TenantIDAlt string            `json:"tenantId"`
			Content     string            `json:"content"`
			Channel     string            `json:"channel"`
			Metadata    map[string]string `json:"metadata"`
		}
		if err := decodeJSONStrict(r, &req); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		tenantID := strings.TrimSpace(req.TenantID)
		if tenantID == "" {
			tenantID = strings.TrimSpace(req.TenantIDAlt)
		}

		out, err := channelRouter.Route(r.Context(), channels.InboundMessage{
			TenantID: tenantID,
			Content:  req.Content,
			Channel:  req.Channel,
			Metadata: req.Metadata,
		})
		if err != nil {
			status := http.StatusInternalServerError
			if isInboundConflictError(err) {
				status = http.StatusConflict
			} else if isInboundValidationError(err) {
				status = http.StatusBadRequest
			}
			writeAPIError(w, status, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, out)
	})

	mux.HandleFunc("GET /api/tenants/{id}/channels", func(w http.ResponseWriter, r *http.Request) {
		if channelLinks == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "channel links are not configured")
			return
		}

		tenantID := strings.TrimSpace(r.PathValue("id"))
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id")
			return
		}

		linked, err := channelLinks.GetChannels(tenantID)
		if err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to get channels")
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{"channels": linked})
	})

	mux.HandleFunc("POST /api/tenants/{id}/channels", func(w http.ResponseWriter, r *http.Request) {
		if channelLinks == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "channel links are not configured")
			return
		}

		tenantID := strings.TrimSpace(r.PathValue("id"))
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id")
			return
		}

		var req struct {
			Channel          string `json:"channel"`
			ChannelUserID    string `json:"channel_user_id"`
			ChannelUserIDAlt string `json:"channelUserId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		channelUserID := strings.TrimSpace(req.ChannelUserID)
		if channelUserID == "" {
			channelUserID = strings.TrimSpace(req.ChannelUserIDAlt)
		}
		if channelUserID == "" {
			writeAPIError(w, http.StatusBadRequest, "channel user id is required")
			return
		}

		if err := channelLinks.LinkChannel(tenantID, req.Channel, channelUserID); err != nil {
			if errors.Is(err, channels.ErrInvalidChannel) {
				writeAPIError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeAPIError(w, http.StatusInternalServerError, "failed to link channel")
			return
		}

		writeJSON(w, http.StatusCreated, map[string]string{"status": "linked"})
	})

	mux.HandleFunc("DELETE /api/tenants/{id}/channels/{channel}", func(w http.ResponseWriter, r *http.Request) {
		if channelLinks == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "channel links are not configured")
			return
		}

		tenantID := strings.TrimSpace(r.PathValue("id"))
		channel := strings.TrimSpace(r.PathValue("channel"))
		if tenantID == "" || channel == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id or channel")
			return
		}

		if err := channelLinks.UnlinkChannel(tenantID, channel); err != nil {
			if errors.Is(err, channels.ErrInvalidChannel) {
				writeAPIError(w, http.StatusBadRequest, err.Error())
				return
			}
			writeAPIError(w, http.StatusInternalServerError, "failed to unlink channel")
			return
		}

		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("POST /api/tenants/{id}/resume", func(w http.ResponseWriter, r *http.Request) {
		if db == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "database is not configured")
			return
		}
		if orch == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "orchestrator is not configured")
			return
		}

		tenantID := r.PathValue("id")
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "missing tenant id")
			return
		}

		balance, err := llmproxy.CheckCredits(db, tenantID)
		if err != nil {
			slog.Error("credit check failed before resume", "tenant", tenantID, "err", err)
			writeAPIError(w, http.StatusInternalServerError, "billing error")
			return
		}

		if balance <= 0 {
			writeAPIError(w, http.StatusPaymentRequired, "insufficient credits")
			return
		}

		if err := llmproxy.ResumeTenant(db, orch, tenantID); err != nil {
			slog.Error("resume tenant failed", "tenant", tenantID, "err", err)
			writeAPIError(w, http.StatusInternalServerError, "failed to resume tenant")
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "active"})
	})

	coordHandler.Mount(mux)
	slog.Info("coordinator handler mounted")

	if db != nil {
		mux.Handle("GET /api/tenants/{id}/terminal", terminal.Handler(db))
		slog.Info("terminal handler mounted")
	}

	log.Println("API server listening on :8080")
	handler := applyRequestBodyLimit(applyAuth(mux))
	log.Fatal(http.ListenAndServe(":8080", handler))
}

func initRedisClient() *redis.Client {
	redisURL := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if redisURL == "" {
		redisURL = "redis://localhost:6379"
	}

	opts, err := redis.ParseURL(redisURL)
	if err != nil {
		slog.Error("failed to parse REDIS_URL", "redis_url", redisURL, "err", err)
		return nil
	}

	client := redis.NewClient(opts)
	if err := client.Ping(context.Background()).Err(); err != nil {
		slog.Error("failed to connect to redis", "redis_url", redisURL, "err", err)
	}
	return client
}

func isInboundValidationError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, channels.ErrInvalidChannel) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "required") || strings.Contains(msg, "not found") || strings.Contains(msg, "missing")
}

func isInboundConflictError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "already running")
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func decodeJSONStrict(r *http.Request, dest any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return errors.New("request body must contain a single JSON object")
	}
	return nil
}
