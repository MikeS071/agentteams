package orchestrator

import (
	"context"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestContainerName(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in   string
		want string
	}{
		{in: "abc", want: "at-tenant-abc"},
		{in: "1234567890", want: "at-tenant-12345678"},
		{in: "tenant-long-id", want: "at-tenant-tenant-l"},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.in, func(t *testing.T) {
			t.Parallel()
			if got := containerName(tt.in); got != tt.want {
				t.Fatalf("containerName=%q want=%q", got, tt.want)
			}
		})
	}
}

func TestGetContainerID(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		wantErr bool
	}{
		{
			name: "happy path",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT container_id FROM tenants").WithArgs("t1").WillReturnRows(sqlmock.NewRows([]string{"container_id"}).AddRow("cid"))
			},
		},
		{
			name: "tenant not found",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT container_id FROM tenants").WithArgs("t1").WillReturnRows(sqlmock.NewRows([]string{"container_id"}))
			},
			wantErr: true,
		},
		{
			name: "empty container",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT container_id FROM tenants").WithArgs("t1").WillReturnRows(sqlmock.NewRows([]string{"container_id"}).AddRow(nil))
			},
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
			o := &DockerOrchestrator{db: db}
			_, err = o.getContainerID(context.Background(), "t1")
			if (err != nil) != tt.wantErr {
				t.Fatalf("getContainerID err=%v wantErr=%v", err, tt.wantErr)
			}
		})
	}
}
