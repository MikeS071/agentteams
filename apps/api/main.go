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
	"github.com/agentteams/api/channels/adapters"
	"github.com/agentteams/api/coordinator"
	"github.com/agentteams/api/llmproxy"
	"github.com/agentteams/api/orchestrator"
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
	var telegramAdapter *adapters.TelegramAdapter

	if dsn := os.Getenv("DATABASE_URL"); dsn != "" {
		var err error
		db, err = sql.Open("postgres", dsn)
		if err != nil {
			slog.Error("failed to connect to database", "err", err)
		} else {
			redisClient := initRedisClient()
			channelLinks = channels.NewLinkStore(db)
			channelRouter = channels.NewRouter(db, redisClient)
			telegramAdapter = adapters.NewTelegramAdapter(channelLinks)

			if redisClient != nil {
				fanout := channels.NewFanout(redisClient, channelLinks, telegramAdapter)
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
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
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
			if isInboundValidationError(err) {
				status = http.StatusBadRequest
			}
			writeAPIError(w, status, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, out)
	})

	mux.HandleFunc("POST /api/channels/telegram/connect", func(w http.ResponseWriter, r *http.Request) {
		if channelLinks == nil || telegramAdapter == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "telegram adapter is not configured")
			return
		}

		var req struct {
			TenantID      string `json:"tenant_id"`
			TenantIDAlt   string `json:"tenantId"`
			BotToken      string `json:"bot_token"`
			BotTokenAlt   string `json:"botToken"`
			WebhookURL    string `json:"webhook_url"`
			WebhookURLAlt string `json:"webhookUrl"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		tenantID := strings.TrimSpace(req.TenantID)
		if tenantID == "" {
			tenantID = strings.TrimSpace(req.TenantIDAlt)
		}
		botToken := strings.TrimSpace(req.BotToken)
		if botToken == "" {
			botToken = strings.TrimSpace(req.BotTokenAlt)
		}
		webhookURL := strings.TrimSpace(req.WebhookURL)
		if webhookURL == "" {
			webhookURL = strings.TrimSpace(req.WebhookURLAlt)
		}
		if webhookURL == "" {
			webhookURL = resolvePublicWebhookURL(r)
		}

		if tenantID == "" || botToken == "" {
			writeAPIError(w, http.StatusBadRequest, "tenant_id and bot_token are required")
			return
		}

		identity, err := telegramAdapter.ConnectTenant(r.Context(), tenantID, botToken, webhookURL)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]any{
			"status":      "connected",
			"tenant_id":   tenantID,
			"webhook_url": webhookURL,
			"bot": map[string]any{
				"id":       identity.ID,
				"username": identity.Username,
			},
		})
	})

	mux.HandleFunc("POST /api/channels/telegram/disconnect", func(w http.ResponseWriter, r *http.Request) {
		if channelLinks == nil || telegramAdapter == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "telegram adapter is not configured")
			return
		}

		var req struct {
			TenantID    string `json:"tenant_id"`
			TenantIDAlt string `json:"tenantId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeAPIError(w, http.StatusBadRequest, "invalid JSON body")
			return
		}

		tenantID := strings.TrimSpace(req.TenantID)
		if tenantID == "" {
			tenantID = strings.TrimSpace(req.TenantIDAlt)
		}
		if tenantID == "" {
			writeAPIError(w, http.StatusBadRequest, "tenant_id is required")
			return
		}

		if err := telegramAdapter.DisconnectTenant(r.Context(), tenantID); err != nil {
			writeAPIError(w, http.StatusInternalServerError, "failed to disconnect telegram")
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "disconnected"})
	})

	mux.HandleFunc("POST /api/channels/telegram/webhook", func(w http.ResponseWriter, r *http.Request) {
		if channelRouter == nil || channelLinks == nil || telegramAdapter == nil {
			writeAPIError(w, http.StatusServiceUnavailable, "telegram webhook is not configured")
			return
		}

		secret := strings.TrimSpace(r.Header.Get("X-Telegram-Bot-Api-Secret-Token"))
		if secret == "" {
			writeAPIError(w, http.StatusUnauthorized, "missing webhook secret")
			return
		}

		cfg, err := channelLinks.GetTelegramConfigByWebhookSecret(secret)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				writeAPIError(w, http.StatusUnauthorized, "unknown webhook secret")
				return
			}
			writeAPIError(w, http.StatusInternalServerError, "failed to load telegram configuration")
			return
		}

		if err := telegramAdapter.VerifyWebhook(r, cfg.WebhookSecret); err != nil {
			writeAPIError(w, http.StatusUnauthorized, err.Error())
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "failed to read webhook body")
			return
		}

		inboundMessages, err := telegramAdapter.ParseWebhook(r.Context(), cfg.TenantID, body)
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(inboundMessages) == 0 {
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "processed": 0})
			return
		}

		processed := 0
		for _, inbound := range inboundMessages {
			if chatID := strings.TrimSpace(inbound.Metadata["telegram_chat_id"]); chatID != "" {
				if err := channelLinks.LinkChannel(cfg.TenantID, "telegram", chatID); err != nil {
					slog.Error("failed to update telegram chat link", "tenant", cfg.TenantID, "chat_id", chatID, "err", err)
				}
			}

			if _, err := channelRouter.Route(r.Context(), inbound); err != nil {
				slog.Error("failed to route telegram inbound", "tenant", cfg.TenantID, "err", err)
				continue
			}
			processed++
		}

		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "processed": processed})
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

	coordHandler := coordinator.NewHandler()
	coordHandler.Mount(mux)
	slog.Info("coordinator handler mounted")

	if db != nil {
		mux.Handle("GET /api/tenants/{id}/terminal", terminal.Handler(db))
		slog.Info("terminal handler mounted")
	}

	log.Println("API server listening on :8080")
	log.Fatal(http.ListenAndServe(":8080", mux))
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
	return strings.Contains(msg, "required") || strings.Contains(msg, "not found")
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeAPIError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func resolvePublicWebhookURL(r *http.Request) string {
	if explicit := strings.TrimSpace(os.Getenv("PUBLIC_API_URL")); explicit != "" {
		return strings.TrimRight(explicit, "/") + "/api/channels/telegram/webhook"
	}

	scheme := strings.TrimSpace(r.Header.Get("X-Forwarded-Proto"))
	if scheme == "" {
		if r.TLS != nil {
			scheme = "https"
		} else {
			scheme = "http"
		}
	}

	host := strings.TrimSpace(r.Header.Get("X-Forwarded-Host"))
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	return scheme + "://" + host + "/api/channels/telegram/webhook"
}
