package llmproxy

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/agentsquads/api/orchestrator"
)

type mockOrchestrator struct {
	startErr error
	stopErr  error
	started  int
	stopped  int
}

func (m *mockOrchestrator) Create(context.Context, string) (*orchestrator.Container, error) {
	return nil, nil
}
func (m *mockOrchestrator) Start(context.Context, string) error {
	m.started++
	return m.startErr
}
func (m *mockOrchestrator) Stop(context.Context, string) error {
	m.stopped++
	return m.stopErr
}
func (m *mockOrchestrator) Delete(context.Context, string) error { return nil }
func (m *mockOrchestrator) Status(context.Context, string) (*orchestrator.ContainerStatus, error) {
	return &orchestrator.ContainerStatus{}, nil
}
func (m *mockOrchestrator) Exec(context.Context, string, []string) (string, error) { return "", nil }

func TestPauseTenant(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		orch    *mockOrchestrator
		wantErr bool
	}{
		{
			name: "happy path",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec("UPDATE tenants SET status = 'paused'").WithArgs("t1").WillReturnResult(sqlmock.NewResult(1, 1))
			},
			orch: &mockOrchestrator{},
		},
		{
			name: "tenant not found",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec("UPDATE tenants SET status = 'paused'").WithArgs("t1").WillReturnResult(sqlmock.NewResult(1, 0))
			},
			orch:    &mockOrchestrator{},
			wantErr: true,
		},
		{
			name: "stop fails",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec("UPDATE tenants SET status = 'paused'").WithArgs("t1").WillReturnResult(sqlmock.NewResult(1, 1))
			},
			orch:    &mockOrchestrator{stopErr: assertErr{}},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer db.Close()
			tt.setup(mock)

			err = PauseTenant(db, tt.orch, "t1")
			if (err != nil) != tt.wantErr {
				t.Fatalf("PauseTenant() err = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestResumeTenant(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		orch    *mockOrchestrator
		wantErr bool
	}{
		{
			name: "happy path",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec("UPDATE tenants SET status = 'active'").WithArgs("t1").WillReturnResult(sqlmock.NewResult(1, 1))
			},
			orch: &mockOrchestrator{},
		},
		{
			name: "insufficient credits checked by caller edge still updates",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec("UPDATE tenants SET status = 'active'").WithArgs("t1").WillReturnResult(sqlmock.NewResult(1, 1))
			},
			orch: &mockOrchestrator{},
		},
		{
			name: "start fails",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectExec("UPDATE tenants SET status = 'active'").WithArgs("t1").WillReturnResult(sqlmock.NewResult(1, 1))
			},
			orch:    &mockOrchestrator{startErr: assertErr{}},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatalf("sqlmock.New: %v", err)
			}
			defer db.Close()
			tt.setup(mock)

			err = ResumeTenant(db, tt.orch, "t1")
			if (err != nil) != tt.wantErr {
				t.Fatalf("ResumeTenant() err = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("expectations: %v", err)
			}
		})
	}
}
