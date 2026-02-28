package orchestrator

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/docker/go-connections/nat"
)

const (
	tenantImage          = "agentteams-tenant:latest"
	tenantNetwork        = "agentteams-tenant-net"
	memoryLimit          = 512 * 1024 * 1024 // 512MB
	cpuQuota             = 100000            // 1 CPU core
	cpuPeriod            = 100000
	tenantPort           = 4200
	openFangHealthHost   = "127.0.0.1"
	openFangStartTimeout = 60 * time.Second

	labelTenantID = "agentsquads-tenant"
	labelPort     = "agentsquads-port"
)

// DockerOrchestrator implements TenantOrchestrator using the Docker Engine API.
type DockerOrchestrator struct {
	cli *client.Client
	db  *sql.DB
	log *slog.Logger

	platformAPIURL string
	platformAPIKey string
	llmProxyURL    string
}

// NewDockerOrchestrator creates a new Docker-based orchestrator.
func NewDockerOrchestrator(db *sql.DB, platformAPIURL, platformAPIKey, llmProxyURL string) (*DockerOrchestrator, error) {
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("docker client: %w", err)
	}

	o := &DockerOrchestrator{
		cli:            cli,
		db:             db,
		log:            slog.Default().With("component", "orchestrator"),
		platformAPIURL: platformAPIURL,
		platformAPIKey: platformAPIKey,
		llmProxyURL:    llmProxyURL,
	}

	if err := o.EnsureNetwork(context.Background()); err != nil {
		return nil, err
	}

	return o, nil
}

// EnsureNetwork creates the tenant network if it doesn't exist.
func (o *DockerOrchestrator) EnsureNetwork(ctx context.Context) error {
	nets, err := o.cli.NetworkList(ctx, network.ListOptions{
		Filters: filters.NewArgs(filters.Arg("name", tenantNetwork)),
	})
	if err != nil {
		return fmt.Errorf("network list: %w", err)
	}
	for _, n := range nets {
		if n.Name == tenantNetwork {
			o.log.Info("tenant network exists", "id", n.ID)
			return nil
		}
	}

	resp, err := o.cli.NetworkCreate(ctx, tenantNetwork, network.CreateOptions{
		Driver:   "bridge",
		Internal: true,
		Labels:   map[string]string{"agentsquads-managed": "true"},
	})
	if err != nil {
		return fmt.Errorf("network create: %w", err)
	}
	o.log.Info("tenant network created", "id", resp.ID)
	return nil
}

func containerName(tenantID string) string {
	short := tenantID
	if len(short) > 8 {
		short = short[:8]
	}
	return "at-tenant-" + short
}

// CreateTenant creates a tenant container without starting it.
func (o *DockerOrchestrator) CreateTenant(ctx context.Context, tenant TenantConfig) (ContainerInfo, error) {
	tenantID := strings.TrimSpace(tenant.TenantID)
	if tenantID == "" {
		return ContainerInfo{}, fmt.Errorf("tenant id is required")
	}

	runtime, err := o.getTenantRuntime(ctx, tenantID)
	if err != nil {
		return ContainerInfo{}, err
	}
	if runtime.ContainerID.Valid && runtime.ContainerID.String != "" {
		status, statusErr := o.GetStatus(ctx, tenantID)
		if statusErr != nil {
			return ContainerInfo{}, statusErr
		}
		return ContainerInfo{
			ContainerID: status.ContainerID,
			Port:        status.Port,
			Status:      status.Status,
		}, nil
	}

	o.log.Info("creating container", "tenant", tenantID)

	// Pull image best-effort in case newer image exists.
	reader, err := o.cli.ImagePull(ctx, tenantImage, image.PullOptions{})
	if err != nil {
		o.log.Warn("image pull failed (using local)", "err", err)
	} else {
		_, _ = io.Copy(io.Discard, reader)
		_ = reader.Close()
	}

	if tenant.PlatformAPIURL == "" {
		tenant.PlatformAPIURL = o.platformAPIURL
	}
	if tenant.PlatformAPIKey == "" {
		tenant.PlatformAPIKey = o.platformAPIKey
	}
	if tenant.LLMProxyURL == "" {
		tenant.LLMProxyURL = o.llmProxyURL
	}

	port, err := o.allocatePort(ctx)
	if err != nil {
		return ContainerInfo{}, err
	}

	cfg, err := GenerateConfig(ctx, tenant)
	if err != nil {
		return ContainerInfo{}, fmt.Errorf("generate config: %w", err)
	}
	cleanupConfigOnError := true
	defer func() {
		if cleanupConfigOnError {
			if err := CleanupConfig(tenantID); err != nil {
				o.log.Warn("cleanup config failed", "tenant", tenantID, "err", err)
			}
		}
	}()

	exposedPort := nat.Port(fmt.Sprintf("%d/tcp", tenantPort))
	name := containerName(tenantID)

	resp, err := o.cli.ContainerCreate(ctx,
		&container.Config{
			Image: tenantImage,
			Env: []string{
				"TENANT_ID=" + tenantID,
				"PLATFORM_API_URL=" + tenant.PlatformAPIURL,
				"PLATFORM_API_KEY=" + tenant.PlatformAPIKey,
				"LLM_PROXY_URL=" + tenant.LLMProxyURL,
			},
			ExposedPorts: nat.PortSet{
				exposedPort: struct{}{},
			},
			Labels: map[string]string{
				labelTenantID: tenantID,
				labelPort:     strconv.Itoa(port),
			},
		},
		&container.HostConfig{
			Resources: container.Resources{
				Memory:    memoryLimit,
				CPUQuota:  cpuQuota,
				CPUPeriod: cpuPeriod,
			},
			RestartPolicy: container.RestartPolicy{Name: "unless-stopped"},
			NetworkMode:   container.NetworkMode(tenantNetwork),
			PortBindings: nat.PortMap{
				exposedPort: []nat.PortBinding{{
					HostIP:   openFangHealthHost,
					HostPort: strconv.Itoa(port),
				}},
			},
			Binds: []string{
				fmt.Sprintf("%s:%s:ro", cfg.HostPath, cfg.ContainerPath),
			},
		},
		nil, nil, name,
	)
	if err != nil {
		return ContainerInfo{}, fmt.Errorf("container create: %w", err)
	}

	if err := o.updateTenantRuntime(ctx, tenantID, sql.NullString{String: resp.ID, Valid: true}, sql.NullInt64{Int64: int64(port), Valid: true}); err != nil {
		_ = o.cli.ContainerRemove(ctx, resp.ID, container.RemoveOptions{Force: true})
		return ContainerInfo{}, err
	}

	cleanupConfigOnError = false

	o.log.Info("container created", "tenant", tenantID, "container", shortContainerID(resp.ID), "port", port)
	return ContainerInfo{ContainerID: resp.ID, Port: port, Status: "creating"}, nil
}

// StartTenant starts an existing tenant container and waits for OpenFang health.
func (o *DockerOrchestrator) StartTenant(ctx context.Context, tenantID string) error {
	tenantID = strings.TrimSpace(tenantID)
	if tenantID == "" {
		return fmt.Errorf("tenant id is required")
	}

	runtime, err := o.getTenantRuntime(ctx, tenantID)
	if err != nil {
		return err
	}

	containerID := ""
	port := 0
	if runtime.ContainerID.Valid {
		containerID = runtime.ContainerID.String
	}
	if runtime.ContainerPort.Valid {
		port = int(runtime.ContainerPort.Int64)
	}

	if containerID == "" {
		created, err := o.CreateTenant(ctx, TenantConfig{TenantID: tenantID})
		if err != nil {
			return err
		}
		containerID = created.ContainerID
		port = created.Port
	}

	o.log.Info("starting container", "tenant", tenantID, "container", shortContainerID(containerID), "port", port)
	if err := o.cli.ContainerStart(ctx, containerID, container.StartOptions{}); err != nil && !isAlreadyStartedErr(err) {
		return fmt.Errorf("container start: %w", err)
	}

	if port <= 0 {
		port = o.portFromContainer(ctx, containerID)
		if port <= 0 {
			return fmt.Errorf("missing port for tenant %s", tenantID)
		}
		if err := o.updateTenantRuntime(ctx, tenantID, sql.NullString{String: containerID, Valid: true}, sql.NullInt64{Int64: int64(port), Valid: true}); err != nil {
			return err
		}
	}

	if err := waitForOpenFang(ctx, openFangHealthHost, port, openFangStartTimeout); err != nil {
		return err
	}

	return nil
}

// StopTenant gracefully stops a tenant container.
func (o *DockerOrchestrator) StopTenant(ctx context.Context, tenantID string) error {
	runtime, err := o.getTenantRuntime(ctx, tenantID)
	if err != nil {
		return err
	}
	if !runtime.ContainerID.Valid || runtime.ContainerID.String == "" {
		return fmt.Errorf("no container for tenant")
	}

	o.log.Info("stopping container", "tenant", tenantID, "container", shortContainerID(runtime.ContainerID.String))
	timeout := 10
	if err := o.cli.ContainerStop(ctx, runtime.ContainerID.String, container.StopOptions{Timeout: &timeout}); err != nil {
		if client.IsErrNotFound(err) {
			return nil
		}
		return fmt.Errorf("container stop: %w", err)
	}
	return nil
}

// DestroyTenant force-removes tenant container and config.
func (o *DockerOrchestrator) DestroyTenant(ctx context.Context, tenantID string) error {
	runtime, err := o.getTenantRuntime(ctx, tenantID)
	if err != nil {
		return err
	}

	if runtime.ContainerID.Valid && runtime.ContainerID.String != "" {
		o.log.Info("destroying container", "tenant", tenantID, "container", shortContainerID(runtime.ContainerID.String))
		if err := o.cli.ContainerRemove(ctx, runtime.ContainerID.String, container.RemoveOptions{Force: true}); err != nil && !client.IsErrNotFound(err) {
			return fmt.Errorf("container remove: %w", err)
		}
	}

	if err := CleanupConfig(tenantID); err != nil {
		return err
	}

	if err := o.updateTenantRuntime(ctx, tenantID, sql.NullString{}, sql.NullInt64{}); err != nil {
		return err
	}
	return nil
}

// GetStatus returns combined Docker + OpenFang status for one tenant.
func (o *DockerOrchestrator) GetStatus(ctx context.Context, tenantID string) (TenantStatus, error) {
	runtime, err := o.getTenantRuntime(ctx, tenantID)
	if err != nil {
		return TenantStatus{}, err
	}

	status := TenantStatus{TenantID: tenantID, Status: "stopped"}
	if runtime.ContainerID.Valid {
		status.ContainerID = runtime.ContainerID.String
	}
	if runtime.ContainerPort.Valid {
		status.Port = int(runtime.ContainerPort.Int64)
	}
	if status.ContainerID == "" {
		return status, nil
	}

	inspect, err := o.cli.ContainerInspect(ctx, status.ContainerID)
	if err != nil {
		if client.IsErrNotFound(err) {
			status.Status = "error"
			status.OpenFangOK = false
			return status, nil
		}
		return TenantStatus{}, fmt.Errorf("inspect container: %w", err)
	}

	status.Status = mapContainerStateToTenantStatus(inspect.State)
	if status.Port == 0 {
		if p := parseLabelPort(inspect.Config.Labels[labelPort]); p > 0 {
			status.Port = p
		}
	}

	if status.Status == "running" && status.Port > 0 {
		status.OpenFangOK = CheckOpenFangHealth(openFangHealthHost, status.Port)
	}
	return status, nil
}

// ListTenants lists Docker-managed tenant containers.
func (o *DockerOrchestrator) ListTenants(ctx context.Context) ([]TenantStatus, error) {
	containers, err := o.cli.ContainerList(ctx, container.ListOptions{
		All: true,
		Filters: filters.NewArgs(
			filters.Arg("label", labelTenantID),
		),
	})
	if err != nil {
		return nil, fmt.Errorf("list containers: %w", err)
	}

	results := make([]TenantStatus, 0, len(containers))
	for _, c := range containers {
		tenantID := strings.TrimSpace(c.Labels[labelTenantID])
		if tenantID == "" {
			continue
		}

		status := TenantStatus{
			TenantID:    tenantID,
			ContainerID: c.ID,
			Port:        parseLabelPort(c.Labels[labelPort]),
			Status:      mapContainerStateStringToTenantStatus(c.State),
		}
		if status.Status == "running" && status.Port > 0 {
			status.OpenFangOK = CheckOpenFangHealth(openFangHealthHost, status.Port)
		}

		results = append(results, status)
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].TenantID < results[j].TenantID
	})

	return results, nil
}

// Exec runs a command inside a tenant container and returns the output.
func (o *DockerOrchestrator) Exec(ctx context.Context, tenantID string, cmd []string) (string, error) {
	runtime, err := o.getTenantRuntime(ctx, tenantID)
	if err != nil {
		return "", err
	}
	if !runtime.ContainerID.Valid || runtime.ContainerID.String == "" {
		return "", fmt.Errorf("no container for tenant")
	}

	o.log.Info("exec in container", "tenant", tenantID, "cmd", cmd)

	execCfg := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}

	execResp, err := o.cli.ContainerExecCreate(ctx, runtime.ContainerID.String, execCfg)
	if err != nil {
		return "", fmt.Errorf("exec create: %w", err)
	}

	attachResp, err := o.cli.ContainerExecAttach(ctx, execResp.ID, container.ExecAttachOptions{})
	if err != nil {
		return "", fmt.Errorf("exec attach: %w", err)
	}
	defer attachResp.Close()

	var stdout, stderr bytes.Buffer
	_, err = stdcopy.StdCopy(&stdout, &stderr, attachResp.Reader)
	if err != nil {
		return "", fmt.Errorf("exec read: %w", err)
	}

	output := stdout.String()
	if errStr := stderr.String(); errStr != "" {
		output += "\n" + errStr
	}
	return output, nil
}

type tenantRuntime struct {
	ContainerID   sql.NullString
	ContainerPort sql.NullInt64
}

func (o *DockerOrchestrator) getTenantRuntime(ctx context.Context, tenantID string) (tenantRuntime, error) {
	if o.db == nil {
		return tenantRuntime{}, fmt.Errorf("database is not configured")
	}

	var runtime tenantRuntime
	err := o.db.QueryRowContext(ctx,
		"SELECT container_id, container_port FROM tenants WHERE id = $1",
		tenantID,
	).Scan(&runtime.ContainerID, &runtime.ContainerPort)
	if errors.Is(err, sql.ErrNoRows) {
		return tenantRuntime{}, fmt.Errorf("tenant not found")
	}
	if err != nil {
		return tenantRuntime{}, fmt.Errorf("tenant query: %w", err)
	}
	return runtime, nil
}

func (o *DockerOrchestrator) updateTenantRuntime(ctx context.Context, tenantID string, containerID sql.NullString, port sql.NullInt64) error {
	if o.db == nil {
		return fmt.Errorf("database is not configured")
	}

	res, err := o.db.ExecContext(ctx,
		"UPDATE tenants SET container_id = $1, container_port = $2 WHERE id = $3",
		nullableString(containerID), nullableInt64(port), tenantID,
	)
	if err != nil {
		return fmt.Errorf("update tenant runtime: %w", err)
	}
	rows, _ := res.RowsAffected()
	if rows == 0 {
		return fmt.Errorf("tenant not found")
	}
	return nil
}

func (o *DockerOrchestrator) allocatePort(ctx context.Context) (int, error) {
	if o.db == nil {
		return 0, fmt.Errorf("database is not configured")
	}

	tx, err := o.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback()

	// Serialize allocations so each create gets a unique sequential host port.
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", int64(4200)); err != nil {
		return 0, fmt.Errorf("acquire port allocation lock: %w", err)
	}

	var ports []int
	rows, err := tx.QueryContext(ctx, "SELECT container_port FROM tenants WHERE container_port IS NOT NULL ORDER BY container_port")
	if err != nil {
		return 0, fmt.Errorf("query ports: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var p int
		if err := rows.Scan(&p); err != nil {
			return 0, fmt.Errorf("scan port: %w", err)
		}
		ports = append(ports, p)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("read ports: %w", err)
	}

	next := nextSequentialPort(tenantPort, ports)
	if err := tx.Commit(); err != nil {
		return 0, fmt.Errorf("commit transaction: %w", err)
	}

	return next, nil
}

func mapContainerStateToTenantStatus(state *container.State) string {
	if state == nil {
		return "error"
	}
	return mapContainerStateStringToTenantStatus(state.Status)
}

func mapContainerStateStringToTenantStatus(state string) string {
	switch strings.ToLower(strings.TrimSpace(state)) {
	case "running":
		return "running"
	case "created", "restarting":
		return "creating"
	case "exited", "paused", "removing":
		return "stopped"
	case "dead":
		return "error"
	default:
		return "error"
	}
}

func waitForOpenFang(ctx context.Context, host string, port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		if CheckOpenFangHealth(host, port) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("openfang health check timed out on %s:%d", host, port)
		}

		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(1 * time.Second):
		}
	}
}

func nextSequentialPort(base int, assigned []int) int {
	if len(assigned) == 0 {
		return base
	}

	sort.Ints(assigned)
	candidate := base
	for _, used := range assigned {
		if used < candidate {
			continue
		}
		if used == candidate {
			candidate++
			continue
		}
		if used > candidate {
			return candidate
		}
	}
	return candidate
}

func parseLabelPort(raw string) int {
	p, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || p <= 0 {
		return 0
	}
	return p
}

func (o *DockerOrchestrator) portFromContainer(ctx context.Context, containerID string) int {
	inspect, err := o.cli.ContainerInspect(ctx, containerID)
	if err != nil {
		return 0
	}
	if inspect.Config == nil || inspect.Config.Labels == nil {
		return 0
	}
	return parseLabelPort(inspect.Config.Labels[labelPort])
}

func isAlreadyStartedErr(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "already started") || strings.Contains(msg, "already running")
}

func nullableString(v sql.NullString) any {
	if !v.Valid {
		return nil
	}
	return v.String
}

func nullableInt64(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}

func shortContainerID(containerID string) string {
	if len(containerID) > 12 {
		return containerID[:12]
	}
	return containerID
}
