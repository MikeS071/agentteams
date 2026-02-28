package channels

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestCredentialsStoreUpsertAndGet(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	store := NewCredentialsStore(db)
	mock.ExpectExec("INSERT INTO channel_credentials").WithArgs("t1", "telegram", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(1, 1))
	if err := store.Upsert(context.Background(), "t1", "telegram", map[string]string{"bot_token": "x"}); err != nil {
		t.Fatalf("Upsert: %v", err)
	}

	raw, _ := json.Marshal(map[string]any{"bot_token": "x", "n": 1})
	rows := sqlmock.NewRows([]string{"tenant_id", "channel", "config", "updated_at"}).AddRow("t1", "telegram", string(raw), time.Now())
	mock.ExpectQuery("SELECT tenant_id, channel, config::text").WithArgs("t1", "telegram").WillReturnRows(rows)
	cred, err := store.GetByTenantChannel(context.Background(), "t1", "telegram")
	if err != nil {
		t.Fatalf("GetByTenantChannel: %v", err)
	}
	if cred.Config["bot_token"] != "x" {
		t.Fatalf("unexpected config: %#v", cred.Config)
	}
}

func TestCredentialsStoreLookup(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()
	store := NewCredentialsStore(db)

	mock.ExpectQuery(`SELECT tenant_id\s+FROM channel_credentials\s+WHERE channel = 'telegram'`).WithArgs("sec").WillReturnRows(sqlmock.NewRows([]string{"tenant_id"}).AddRow("t1"))
	if got, err := store.FindTenantByTelegramSecret(context.Background(), "sec"); err != nil || got != "t1" {
		t.Fatalf("FindTenantByTelegramSecret got=%q err=%v", got, err)
	}

	mock.ExpectQuery(`SELECT tenant_id\s+FROM channel_credentials\s+WHERE channel = 'whatsapp'`).WithArgs("pn").WillReturnRows(sqlmock.NewRows([]string{"tenant_id"}).AddRow("t2"))
	if got, err := store.FindTenantByWhatsAppPhoneNumberID(context.Background(), "pn"); err != nil || got != "t2" {
		t.Fatalf("FindTenantByWhatsAppPhoneNumberID got=%q err=%v", got, err)
	}

	mock.ExpectQuery(`SELECT tenant_id\s+FROM channel_credentials\s+WHERE channel = 'telegram'`).WithArgs("missing").WillReturnError(sql.ErrNoRows)
	if _, err := store.FindTenantByTelegramSecret(context.Background(), "missing"); err == nil {
		t.Fatalf("expected error")
	}
}
