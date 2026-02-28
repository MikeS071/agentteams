// Package terminal provides a WebSocket-to-Docker exec bridge for web terminals.
package terminal

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
	"github.com/gorilla/websocket"
)

const (
	pingInterval = 30 * time.Second
	writeWait    = 10 * time.Second
	pongWait     = 60 * time.Second
	defaultCols  = 80
	defaultRows  = 24
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     checkWebSocketOrigin,
}

func checkWebSocketOrigin(r *http.Request) bool {
	originHeader := strings.TrimSpace(r.Header.Get("Origin"))
	if originHeader == "" {
		return false
	}

	originURL, err := url.Parse(originHeader)
	if err != nil {
		return false
	}

	allowedOrigins := []string{
		strings.TrimSpace(os.Getenv("NEXTAUTH_URL")),
		strings.TrimSpace(os.Getenv("WEB_ORIGIN")),
	}
	for _, allowed := range allowedOrigins {
		if allowed == "" {
			continue
		}
		allowedURL, err := url.Parse(allowed)
		if err != nil {
			continue
		}
		if strings.EqualFold(originURL.Host, allowedURL.Host) && originURL.Scheme == allowedURL.Scheme {
			return true
		}
	}

	return false
}

// resizeMsg is a JSON message from the client to resize the terminal.
type resizeMsg struct {
	Type string `json:"type"`
	Cols uint   `json:"cols"`
	Rows uint   `json:"rows"`
}

// Handler returns an http.Handler that upgrades to WebSocket and bridges
// to a Docker exec TTY session for the tenant identified in the URL path.
// Expected route: GET /api/tenants/{id}/terminal
func Handler(db *sql.DB) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tenantID := r.PathValue("id")
		if tenantID == "" {
			http.Error(w, "missing tenant id", http.StatusBadRequest)
			return
		}

		log := slog.With("component", "terminal", "tenant", tenantID)

		// Look up container ID from DB.
		containerID, err := getContainerID(r.Context(), db, tenantID)
		if err != nil {
			log.Error("container lookup failed", "err", err)
			http.Error(w, "tenant container not found", http.StatusNotFound)
			return
		}

		// Create Docker client.
		cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
		if err != nil {
			log.Error("docker client failed", "err", err)
			http.Error(w, "internal error", http.StatusInternalServerError)
			return
		}
		defer cli.Close()

		// Create exec instance with TTY.
		ctx := context.Background()
		execResp, err := cli.ContainerExecCreate(ctx, containerID, container.ExecOptions{
			Cmd:          []string{"/bin/bash"},
			AttachStdin:  true,
			AttachStdout: true,
			AttachStderr: true,
			Tty:          true,
		})
		if err != nil {
			log.Error("exec create failed", "err", err)
			http.Error(w, "failed to create exec", http.StatusInternalServerError)
			return
		}

		// Attach to exec.
		hijacked, err := cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{Tty: true})
		if err != nil {
			log.Error("exec attach failed", "err", err)
			http.Error(w, "failed to attach exec", http.StatusInternalServerError)
			return
		}
		defer hijacked.Close()

		// Set initial size.
		_ = cli.ContainerExecResize(ctx, execResp.ID, container.ResizeOptions{
			Height: defaultRows,
			Width:  defaultCols,
		})

		// Upgrade to WebSocket.
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Error("websocket upgrade failed", "err", err)
			return
		}

		log.Info("terminal session started")

		conn.SetPongHandler(func(string) error {
			return conn.SetReadDeadline(time.Now().Add(pongWait))
		})
		_ = conn.SetReadDeadline(time.Now().Add(pongWait))

		var once sync.Once
		cleanup := func() {
			once.Do(func() {
				conn.Close()
				hijacked.Close()
				log.Info("terminal session ended")
			})
		}
		defer cleanup()

		// Docker stdout → WebSocket.
		go func() {
			defer cleanup()
			buf := make([]byte, 4096)
			for {
				n, err := hijacked.Reader.Read(buf)
				if n > 0 {
					_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
					if wErr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); wErr != nil {
						return
					}
				}
				if err != nil {
					if err != io.EOF {
						log.Debug("exec read error", "err", err)
					}
					// Send close frame.
					_ = conn.WriteMessage(websocket.CloseMessage,
						websocket.FormatCloseMessage(websocket.CloseNormalClosure, "exec exited"))
					return
				}
			}
		}()

		// Ping ticker.
		go func() {
			ticker := time.NewTicker(pingInterval)
			defer ticker.Stop()
			for range ticker.C {
				_ = conn.SetWriteDeadline(time.Now().Add(writeWait))
				if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
					return
				}
			}
		}()

		// WebSocket → Docker stdin.
		for {
			msgType, msg, err := conn.ReadMessage()
			if err != nil {
				break
			}

			// Check for resize JSON message.
			if msgType == websocket.TextMessage {
				var rm resizeMsg
				if json.Unmarshal(msg, &rm) == nil && rm.Type == "resize" {
					if rm.Cols > 0 && rm.Rows > 0 {
						_ = cli.ContainerExecResize(ctx, execResp.ID, container.ResizeOptions{
							Height: rm.Rows,
							Width:  rm.Cols,
						})
					}
					continue
				}
			}

			// Write to exec stdin.
			if _, err := hijacked.Conn.Write(msg); err != nil {
				break
			}
		}
	})
}

func getContainerID(ctx context.Context, db *sql.DB, tenantID string) (string, error) {
	var cid sql.NullString
	err := db.QueryRowContext(ctx,
		"SELECT container_id FROM tenants WHERE id = $1", tenantID,
	).Scan(&cid)
	if err != nil {
		return "", fmt.Errorf("db query: %w", err)
	}
	if !cid.Valid || cid.String == "" {
		return "", fmt.Errorf("no container for tenant")
	}
	return cid.String, nil
}
