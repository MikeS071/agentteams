package orchestrator

import (
	"bytes"
	"context"
	"database/sql"
	"fmt"
	"io"
	"log/slog"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/api/types/filters"
	"github.com/docker/docker/api/types/image"
	"github.com/docker/docker/api/types/network"
	"github.com/docker/docker/client"
	"github.com/docker/docker/pkg/stdcopy"
)

const (
	tenantImage   = "agentsquads-tenant:latest"
	tenantNetwork = "agentsquads-tenant-net"
	memoryLimit   = 512 * 1024 * 1024 // 512MB
	cpuQuota      = 50000             // 0.5 cores (50% of 100000)
	cpuPeriod     = 100000
	tenantPort    = 4200
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
		Labels:   map[string]string{"agentsquads.managed": "true"},
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
	return "as-tenant-" + short
}

// Create creates a new tenant container.
func (o *DockerOrchestrator) Create(ctx context.Context, tenantID string) (*Container, error) {
	o.log.Info("creating container", "tenant", tenantID)

	// Pull image (best-effort, may already be local)
	reader, err := o.cli.ImagePull(ctx, tenantImage, image.PullOptions{})
	if err != nil {
		o.log.Warn("image pull failed (using local)", "err", err)
	} else {
		_, _ = io.Copy(io.Discard, reader)
		reader.Close()
	}

	name := containerName(tenantID)

	resp, err := o.cli.ContainerCreate(ctx,
		&container.Config{
			Image: tenantImage,
			Env: []string{
				"TENANT_ID=" + tenantID,
				"PLATFORM_API_URL=" + o.platformAPIURL,
				"PLATFORM_API_KEY=" + o.platformAPIKey,
				"LLM_PROXY_URL=" + o.llmProxyURL,
			},
			Labels: map[string]string{
				"agentsquads.tenant": tenantID,
			},
		},
		&container.HostConfig{
			Resources: container.Resources{
				Memory:   memoryLimit,
				CPUQuota: cpuQuota,
				CPUPeriod: cpuPeriod,
			},
			RestartPolicy: container.RestartPolicy{Name: "unless-stopped"},
			NetworkMode:   container.NetworkMode(tenantNetwork),
		},
		nil, nil, name,
	)
	if err != nil {
		return nil, fmt.Errorf("container create: %w", err)
	}

	// Update DB
	_, err = o.db.ExecContext(ctx,
		"UPDATE tenants SET container_id = $1 WHERE id = $2",
		resp.ID, tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("db update: %w", err)
	}

	// Start the container
	if err := o.cli.ContainerStart(ctx, resp.ID, container.StartOptions{}); err != nil {
		return nil, fmt.Errorf("container start: %w", err)
	}

	// Inspect for IP
	info, err := o.cli.ContainerInspect(ctx, resp.ID)
	if err != nil {
		return nil, fmt.Errorf("inspect: %w", err)
	}

	ip := ""
	if net, ok := info.NetworkSettings.Networks[tenantNetwork]; ok {
		ip = net.IPAddress
	}

	o.log.Info("container created", "tenant", tenantID, "container", resp.ID[:12])
	return &Container{
		ID:       resp.ID,
		TenantID: tenantID,
		Status:   "running",
		IP:       ip,
		Port:     tenantPort,
	}, nil
}

func (o *DockerOrchestrator) getContainerID(ctx context.Context, tenantID string) (string, error) {
	var cid sql.NullString
	err := o.db.QueryRowContext(ctx,
		"SELECT container_id FROM tenants WHERE id = $1", tenantID,
	).Scan(&cid)
	if err == sql.ErrNoRows {
		return "", fmt.Errorf("tenant not found")
	}
	if err != nil {
		return "", fmt.Errorf("db query: %w", err)
	}
	if !cid.Valid || cid.String == "" {
		return "", fmt.Errorf("no container for tenant")
	}
	return cid.String, nil
}

// Start starts an existing tenant container.
func (o *DockerOrchestrator) Start(ctx context.Context, tenantID string) error {
	cid, err := o.getContainerID(ctx, tenantID)
	if err != nil {
		return err
	}
	o.log.Info("starting container", "tenant", tenantID)
	return o.cli.ContainerStart(ctx, cid, container.StartOptions{})
}

// Stop stops a tenant container.
func (o *DockerOrchestrator) Stop(ctx context.Context, tenantID string) error {
	cid, err := o.getContainerID(ctx, tenantID)
	if err != nil {
		return err
	}
	o.log.Info("stopping container", "tenant", tenantID)
	timeout := 10
	return o.cli.ContainerStop(ctx, cid, container.StopOptions{Timeout: &timeout})
}

// Delete stops and removes a tenant container.
func (o *DockerOrchestrator) Delete(ctx context.Context, tenantID string) error {
	cid, err := o.getContainerID(ctx, tenantID)
	if err != nil {
		return err
	}
	o.log.Info("deleting container", "tenant", tenantID)

	timeout := 5
	_ = o.cli.ContainerStop(ctx, cid, container.StopOptions{Timeout: &timeout})

	if err := o.cli.ContainerRemove(ctx, cid, container.RemoveOptions{Force: true}); err != nil {
		return fmt.Errorf("container remove: %w", err)
	}

	_, err = o.db.ExecContext(ctx,
		"UPDATE tenants SET container_id = NULL WHERE id = $1", tenantID,
	)
	if err != nil {
		return fmt.Errorf("db update: %w", err)
	}
	return nil
}

// Status returns the current status of a tenant container.
func (o *DockerOrchestrator) Status(ctx context.Context, tenantID string) (*ContainerStatus, error) {
	cid, err := o.getContainerID(ctx, tenantID)
	if err != nil {
		return nil, err
	}

	info, err := o.cli.ContainerInspect(ctx, cid)
	if err != nil {
		return nil, fmt.Errorf("inspect: %w", err)
	}

	status := &ContainerStatus{
		Running: info.State.Running,
		Health:  "unknown",
	}

	if info.State.StartedAt != "" {
		status.StartedAt, _ = time.Parse(time.RFC3339Nano, info.State.StartedAt)
	}

	if info.State.Health != nil {
		status.Health = string(info.State.Health.Status)
	}

	return status, nil
}

// Exec runs a command inside a tenant container and returns the output.
func (o *DockerOrchestrator) Exec(ctx context.Context, tenantID string, cmd []string) (string, error) {
	cid, err := o.getContainerID(ctx, tenantID)
	if err != nil {
		return "", err
	}

	o.log.Info("exec in container", "tenant", tenantID, "cmd", cmd)

	execCfg := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
	}

	execResp, err := o.cli.ContainerExecCreate(ctx, cid, execCfg)
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
