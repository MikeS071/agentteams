package llmproxy

import (
	"database/sql"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCheckCredits(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		want    int
		wantErr bool
	}{
		{
			name: "found balance",
			setup: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"balance_cents"}).AddRow(250)
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("tenant-1").WillReturnRows(rows)
			},
			want: 250,
		},
		{
			name: "missing row returns zero",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("tenant-1").WillReturnError(sql.ErrNoRows)
			},
			want: 0,
		},
		{
			name: "db error",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT balance_cents FROM credits").WithArgs("tenant-1").WillReturnError(assertErr{})
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

			got, err := CheckCredits(db, "tenant-1")
			if (err != nil) != tt.wantErr {
				t.Fatalf("CheckCredits() err = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("CheckCredits() = %d, want %d", got, tt.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("expectations: %v", err)
			}
		})
	}
}

func TestBillUsage(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		wantErr bool
	}{
		{
			name: "happy path",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectExec("INSERT INTO usage_logs").WithArgs("tenant-1", "m1", 10, 20, 3, 0).WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("UPDATE credits SET balance_cents").WithArgs(3, "tenant-1").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit()
			},
		},
		{
			name: "insert failure",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectExec("INSERT INTO usage_logs").WillReturnError(assertErr{})
				mock.ExpectRollback()
			},
			wantErr: true,
		},
		{
			name: "commit failure",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectBegin()
				mock.ExpectExec("INSERT INTO usage_logs").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectExec("UPDATE credits SET balance_cents").WillReturnResult(sqlmock.NewResult(1, 1))
				mock.ExpectCommit().WillReturnError(assertErr{})
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

			err = BillUsage(db, "tenant-1", "m1", 10, 20, 3)
			if (err != nil) != tt.wantErr {
				t.Fatalf("BillUsage() err = %v, wantErr %v", err, tt.wantErr)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatalf("expectations: %v", err)
			}
		})
	}
}

func TestBillUsageConcurrentDeductions(t *testing.T) {
	t.Parallel()
	const workers = 5

	var wg sync.WaitGroup
	errCh := make(chan error, workers)
	for i := range workers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			db, mock, err := sqlmock.New()
			if err != nil {
				errCh <- err
				return
			}
			defer db.Close()

			mock.ExpectBegin()
			mock.ExpectExec("INSERT INTO usage_logs").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectExec("UPDATE credits SET balance_cents").WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectCommit()

			if err := BillUsage(db, "tenant-c", "m1", i+1, i+2, 1); err != nil {
				errCh <- err
				return
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				errCh <- err
			}
		}(i)
	}
	wg.Wait()
	close(errCh)
	for err := range errCh {
		if err != nil {
			t.Fatalf("concurrent bill usage error: %v", err)
		}
	}
}

func TestCalcCostCents(t *testing.T) {
	t.Parallel()
	m := &Model{ProviderCostInputM: 100, ProviderCostOutputM: 200, MarkupPct: 50}
	tests := []struct {
		name string
		in   int
		out  int
		want int
	}{
		{name: "normal math with markup", in: 1_000_000, out: 1_000_000, want: 450},
		{name: "minimum one cent", in: 1, out: 1, want: 1},
		{name: "zero usage", in: 0, out: 0, want: 0},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := CalcCostCents(m, tt.in, tt.out)
			if got != tt.want {
				t.Fatalf("CalcCostCents() = %d, want %d", got, tt.want)
			}
		})
	}
}

type assertErr struct{}

func (assertErr) Error() string { return "boom" }
