package routes

import (
	"bufio"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/client"
	"github.com/docker/go-connections/nat"
	"github.com/golang-jwt/jwt/v5"
)

const (
	defaultOpenFangPort  = 4200
	openFangSSEPath      = "/v1/events/stream"
	maxReconnectAttempts = 3
)

var reconnectBackoffs = []time.Duration{500 * time.Millisecond, 1 * time.Second, 2 * time.Second}

// Event represents a streamed OpenFang event payload.
type Event struct {
	Type      string          `json:"type"`
	HandID    string          `json:"hand_id,omitempty"`
	Data      json.RawMessage `json:"data"`
	Timestamp time.Time       `json:"timestamp"`
}

// EventsHandler proxies tenant-scoped OpenFang SSE events to authenticated API clients.
type EventsHandler struct {
	DB        *sql.DB
	Client    *http.Client
	JWTSecret string
}

// NewEventsHandler creates a handler for /api/events/stream.
func NewEventsHandler(db *sql.DB) *EventsHandler {
	return &EventsHandler{
		DB:        db,
		Client:    &http.Client{},
		JWTSecret: strings.TrimSpace(os.Getenv("API_JWT_SECRET")),
	}
}

// Mount registers events routes on the provided mux.
func (h *EventsHandler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/events/stream", h.handleStream)
}

func (h *EventsHandler) handleStream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming is not supported", http.StatusInternalServerError)
		return
	}

	tenantID, err := h.extractTenantIDFromJWT(r)
	if err != nil {
		writeAPIError(w, http.StatusUnauthorized, err.Error())
		return
	}

	allowedTypes := parseTypeFilter(r.URL.Query().Get("types"))

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")
	flusher.Flush()

	retries := 0
	for {
		connected, err := h.proxyOnce(r.Context(), w, flusher, tenantID, allowedTypes)
		if err == nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			return
		}
		if r.Context().Err() != nil {
			return
		}

		if connected {
			retries = 0
		}

		if !shouldReconnect(err) {
			slog.Warn("events upstream closed without retry", "tenant", tenantID, "err", err)
			writeSSEError(w, flusher, "upstream stream unavailable")
			return
		}
		if retries >= maxReconnectAttempts {
			slog.Warn("events upstream reconnect attempts exhausted", "tenant", tenantID, "err", err)
			writeSSEError(w, flusher, "upstream stream disconnected")
			return
		}

		waitFor := reconnectBackoffs[min(retries, len(reconnectBackoffs)-1)]
		retries++
		timer := time.NewTimer(waitFor)
		select {
		case <-r.Context().Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

func (h *EventsHandler) proxyOnce(
	ctx context.Context,
	w io.Writer,
	flusher http.Flusher,
	tenantID string,
	allowedTypes map[string]struct{},
) (bool, error) {
	upstreamURL, err := h.resolveUpstreamURL(ctx, tenantID)
	if err != nil {
		return false, err
	}

	upstreamReq, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		return false, fmt.Errorf("build upstream request: %w", err)
	}
	upstreamReq.Header.Set("Accept", "text/event-stream")

	resp, err := h.Client.Do(upstreamReq)
	if err != nil {
		return false, fmt.Errorf("connect upstream: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return false, &upstreamStatusError{StatusCode: resp.StatusCode, Body: strings.TrimSpace(string(body))}
	}

	return true, h.forwardSSE(ctx, w, flusher, resp.Body, allowedTypes)
}

func (h *EventsHandler) forwardSSE(
	ctx context.Context,
	w io.Writer,
	flusher http.Flusher,
	body io.Reader,
	allowedTypes map[string]struct{},
) error {
	reader := bufio.NewReader(body)
	block := make([]string, 0, 8)

	for {
		if err := ctx.Err(); err != nil {
			return err
		}

		line, err := reader.ReadString('\n')
		if err != nil {
			if errors.Is(err, io.EOF) {
				if len(block) > 0 {
					if err := writeEventBlock(w, flusher, block, allowedTypes); err != nil {
						return err
					}
				}
				return io.EOF
			}
			return fmt.Errorf("read upstream stream: %w", err)
		}

		trimmed := strings.TrimRight(line, "\r\n")
		if trimmed == "" {
			if err := writeEventBlock(w, flusher, block, allowedTypes); err != nil {
				return err
			}
			block = block[:0]
			continue
		}
		block = append(block, line)
	}
}

func writeEventBlock(w io.Writer, flusher http.Flusher, block []string, allowedTypes map[string]struct{}) error {
	if len(block) == 0 {
		return nil
	}
	if !shouldForwardBlock(block, allowedTypes) {
		return nil
	}

	for _, line := range block {
		if !strings.HasSuffix(line, "\n") {
			line += "\n"
		}
		if _, err := io.WriteString(w, line); err != nil {
			return err
		}
	}
	if _, err := io.WriteString(w, "\n"); err != nil {
		return err
	}
	flusher.Flush()
	return nil
}

func parseTypeFilter(raw string) map[string]struct{} {
	types := make(map[string]struct{})
	for _, part := range strings.Split(raw, ",") {
		t := strings.ToLower(strings.TrimSpace(part))
		if t != "" {
			types[t] = struct{}{}
		}
	}
	if len(types) == 0 {
		return nil
	}
	return types
}

func shouldForwardBlock(block []string, allowedTypes map[string]struct{}) bool {
	if len(allowedTypes) == 0 {
		return true
	}

	eventType, hasTypedEvent := eventTypeForBlock(block)
	if !hasTypedEvent {
		// Keep-alive/comments should still pass through while filtering.
		return true
	}

	_, ok := allowedTypes[eventType]
	return ok
}

func eventTypeForBlock(block []string) (string, bool) {
	for _, rawLine := range block {
		line := strings.TrimSpace(strings.TrimRight(rawLine, "\r\n"))
		if strings.HasPrefix(line, "event:") {
			t := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(line, "event:")))
			if t != "" {
				return t, true
			}
		}
	}

	data := extractDataPayload(block)
	if data == "" {
		return "", false
	}

	var evt Event
	if err := json.Unmarshal([]byte(data), &evt); err != nil {
		return "", false
	}
	if strings.TrimSpace(evt.Type) == "" {
		return "", false
	}
	return strings.ToLower(strings.TrimSpace(evt.Type)), true
}

func extractDataPayload(block []string) string {
	var parts []string
	for _, rawLine := range block {
		line := strings.TrimRight(rawLine, "\r\n")
		if strings.HasPrefix(line, "data:") {
			parts = append(parts, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	return strings.Join(parts, "\n")
}

func (h *EventsHandler) resolveUpstreamURL(ctx context.Context, tenantID string) (string, error) {
	port, err := h.resolveTenantPort(ctx, tenantID)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("http://localhost:%d%s", port, openFangSSEPath), nil
}

func (h *EventsHandler) resolveTenantPort(ctx context.Context, tenantID string) (int, error) {
	if fixedPort, ok := readPortEnv("OPENFANG_EVENTS_PORT"); ok {
		return fixedPort, nil
	}

	defaultPort := defaultOpenFangPort
	if configuredPort, ok := readPortEnv("OPENFANG_CONTAINER_PORT"); ok {
		defaultPort = configuredPort
	}

	if h.DB == nil {
		return defaultPort, nil
	}

	containerID, err := lookupTenantContainerID(ctx, h.DB, tenantID)
	if err != nil {
		return 0, err
	}
	if containerID == "" {
		return defaultPort, nil
	}

	hostPort, err := lookupPublishedContainerPort(ctx, containerID, defaultPort)
	if err != nil {
		slog.Warn("failed to resolve tenant host port from Docker; falling back to default",
			"tenant", tenantID,
			"container", containerID,
			"default_port", defaultPort,
			"err", err,
		)
		return defaultPort, nil
	}
	return hostPort, nil
}

func lookupTenantContainerID(ctx context.Context, db *sql.DB, tenantID string) (string, error) {
	var containerID sql.NullString
	err := db.QueryRowContext(ctx, `SELECT container_id FROM tenants WHERE id = $1`, tenantID).Scan(&containerID)
	if err == sql.ErrNoRows {
		return "", errors.New("tenant not found")
	}
	if err != nil {
		return "", fmt.Errorf("resolve tenant container: %w", err)
	}
	if !containerID.Valid {
		return "", nil
	}
	return strings.TrimSpace(containerID.String), nil
}

func lookupPublishedContainerPort(ctx context.Context, containerID string, containerPort int) (int, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return 0, fmt.Errorf("docker client: %w", err)
	}
	defer cli.Close()

	info, err := cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return 0, fmt.Errorf("docker inspect: %w", err)
	}
	if info.NetworkSettings == nil {
		return 0, errors.New("container network settings are missing")
	}

	portKey := nat.Port(fmt.Sprintf("%d/tcp", containerPort))
	bindings := info.NetworkSettings.Ports[portKey]
	if len(bindings) == 0 {
		return 0, fmt.Errorf("no host binding for %s", portKey)
	}

	for _, binding := range bindings {
		hostPortText := strings.TrimSpace(binding.HostPort)
		if hostPortText == "" {
			continue
		}
		hostPort, err := strconv.Atoi(hostPortText)
		if err != nil {
			continue
		}
		if hostPort > 0 {
			return hostPort, nil
		}
	}

	return 0, fmt.Errorf("invalid host port binding for %s", portKey)
}

func (h *EventsHandler) extractTenantIDFromJWT(r *http.Request) (string, error) {
	token := strings.TrimSpace(r.Header.Get("Authorization"))
	if token == "" || !strings.HasPrefix(strings.ToLower(token), "bearer ") {
		return "", errors.New("missing bearer token")
	}
	token = strings.TrimSpace(token[len("Bearer "):])
	if token == "" {
		return "", errors.New("missing bearer token")
	}

	jwtSecret := strings.TrimSpace(h.JWTSecret)
	if jwtSecret == "" {
		jwtSecret = strings.TrimSpace(os.Getenv("API_JWT_SECRET"))
	}
	if jwtSecret == "" {
		return "", errors.New("API JWT auth is not configured")
	}

	parsed, err := jwt.Parse(token, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(jwtSecret), nil
	})
	if err != nil || !parsed.Valid {
		return "", errors.New("invalid bearer token")
	}

	claims, ok := parsed.Claims.(jwt.MapClaims)
	if !ok {
		return "", errors.New("invalid bearer token claims")
	}

	for _, key := range []string{"tenant_id", "tenantId"} {
		if value := claimString(claims[key]); value != "" {
			return value, nil
		}
	}

	return "", errors.New("tenant_id claim is required")
}

func claimString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case fmt.Stringer:
		return strings.TrimSpace(v.String())
	default:
		return ""
	}
}

func readPortEnv(envKey string) (int, bool) {
	raw := strings.TrimSpace(os.Getenv(envKey))
	if raw == "" {
		return 0, false
	}
	port, err := strconv.Atoi(raw)
	if err != nil || port <= 0 {
		return 0, false
	}
	return port, true
}

func shouldReconnect(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}

	var statusErr *upstreamStatusError
	if errors.As(err, &statusErr) {
		return statusErr.StatusCode >= http.StatusInternalServerError || statusErr.StatusCode == http.StatusTooManyRequests
	}
	return true
}

type upstreamStatusError struct {
	StatusCode int
	Body       string
}

func (e *upstreamStatusError) Error() string {
	if e.Body == "" {
		return fmt.Sprintf("upstream status %d", e.StatusCode)
	}
	return fmt.Sprintf("upstream status %d: %s", e.StatusCode, e.Body)
}

func writeSSEError(w io.Writer, flusher http.Flusher, message string) {
	payload, _ := json.Marshal(map[string]string{"error": message})
	_, _ = io.WriteString(w, "event: error\n")
	_, _ = io.WriteString(w, fmt.Sprintf("data: %s\n\n", payload))
	flusher.Flush()
}

