package channels

import (
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestLinkStoreLinkUnlinkList(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	store := NewLinkStore(db)

	mock.ExpectExec("INSERT INTO tenant_channels").WithArgs("t1", "telegram", "123").WillReturnResult(sqlmock.NewResult(1, 1))
	if err := store.LinkChannel("t1", "Telegram", "123"); err != nil {
		t.Fatalf("LinkChannel: %v", err)
	}

	mock.ExpectExec("DELETE FROM tenant_channels").WithArgs("t1", "telegram").WillReturnResult(sqlmock.NewResult(1, 1))
	if err := store.UnlinkChannel("t1", "telegram"); err != nil {
		t.Fatalf("UnlinkChannel: %v", err)
	}

	now := time.Now()
	rows := sqlmock.NewRows([]string{"id", "tenant_id", "channel", "channel_user_id", "linked_at", "muted"}).AddRow("id1", "t1", "web", "", now, false)
	mock.ExpectQuery("SELECT id, tenant_id, channel").WithArgs("t1").WillReturnRows(rows)
	got, err := store.GetChannels("t1")
	if err != nil {
		t.Fatalf("GetChannels: %v", err)
	}
	if len(got) != 1 || got[0].Channel != "web" {
		t.Fatalf("unexpected channels: %#v", got)
	}
}

func TestNormalizeChannel(t *testing.T) {
	t.Parallel()
	tests := []struct {
		in      string
		wantErr bool
	}{
		{in: "web"},
		{in: "telegram"},
		{in: "signal", wantErr: true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.in, func(t *testing.T) {
			t.Parallel()
			_, err := normalizeChannel(tt.in)
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeChannel err=%v wantErr=%v", err, tt.wantErr)
			}
		})
	}
}
