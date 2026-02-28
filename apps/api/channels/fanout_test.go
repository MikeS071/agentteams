package channels

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFanoutStartRedisNotConfigured(t *testing.T) {
	t.Parallel()
	f := NewFanout(nil, nil, nil)
	if err := f.Start(context.Background()); err == nil {
		t.Fatalf("expected redis configuration error")
	}
}

func TestFanoutFanoutFiltering(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	links := NewLinkStore(db)
	creds := NewCredentialsStore(db)
	f := NewFanout(nil, links, creds)
	var sentTelegram, sentWhatsApp int
	f.http = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if strings.Contains(req.URL.String(), "telegram") {
			sentTelegram++
		}
		if strings.Contains(req.URL.String(), "facebook") {
			sentWhatsApp++
		}
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("ok")), Header: make(http.Header)}, nil
	})}

	rows := sqlmock.NewRows([]string{"id", "tenant_id", "channel", "channel_user_id", "linked_at", "muted"}).
		AddRow("1", "t1", "telegram", "u1", time.Now(), false).
		AddRow("2", "t1", "whatsapp", "u2", time.Now(), true)
	mock.ExpectQuery("SELECT id, tenant_id, channel").WithArgs("t1").WillReturnRows(rows)

	tgCredRows := sqlmock.NewRows([]string{"tenant_id", "channel", "config", "updated_at"}).AddRow("t1", "telegram", `{"bot_token":"tok"}`, time.Now())
	mock.ExpectQuery("SELECT tenant_id, channel, config::text").WithArgs("t1", "telegram").WillReturnRows(tgCredRows)

	if err := f.fanout(context.Background(), OutboundMessage{TenantID: "t1", Content: "hello", Channel: "telegram", Metadata: map[string]string{"user_id": "u1"}}); err != nil {
		t.Fatalf("fanout: %v", err)
	}
	if sentTelegram != 1 {
		t.Fatalf("expected telegram delivery once, got %d", sentTelegram)
	}
	if sentWhatsApp != 0 {
		t.Fatalf("expected no whatsapp delivery, got %d", sentWhatsApp)
	}
}

func TestTenantIDFromTopic(t *testing.T) {
	t.Parallel()
	tests := []struct {
		topic string
		want  string
	}{
		{topic: "tenant:t1:response", want: "t1"},
		{topic: "tenant:t1:bad", want: ""},
		{topic: "bad", want: ""},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.topic, func(t *testing.T) {
			t.Parallel()
			if got := tenantIDFromTopic(tt.topic); got != tt.want {
				t.Fatalf("tenantIDFromTopic=%q want %q", got, tt.want)
			}
		})
	}
}

func TestFormatters(t *testing.T) {
	t.Parallel()
	msg := OutboundMessage{Content: "x"}
	if FormatForWeb(msg) != "x" || FormatForTelegram(msg) != "x" || FormatForWhatsApp(msg) != "x" {
		t.Fatalf("unexpected formatter output")
	}
}
