package channels

import (
	"testing"
)

func TestNormalizeInbound(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		msg     InboundMessage
		wantErr bool
		wantCh  string
	}{
		{name: "happy path", msg: InboundMessage{TenantID: " t1 ", Content: " hi ", Channel: "Telegram", Metadata: map[string]string{" a ": " b "}}, wantCh: "telegram"},
		{name: "unknown channel", msg: InboundMessage{TenantID: "t1", Content: "hi", Channel: "sms"}, wantErr: true},
		{name: "empty content", msg: InboundMessage{TenantID: "t1", Content: " ", Channel: "web"}, wantErr: true},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := normalizeInbound(tt.msg)
			if (err != nil) != tt.wantErr {
				t.Fatalf("normalizeInbound() err=%v wantErr=%v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if got.Channel != tt.wantCh {
					t.Fatalf("channel=%s want %s", got.Channel, tt.wantCh)
				}
				if got.Metadata["a"] != "b" {
					t.Fatalf("metadata not normalized: %#v", got.Metadata)
				}
			}
		})
	}
}

func TestConversationIDFromMetadata(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		meta map[string]string
		want string
	}{
		{name: "snake case", meta: map[string]string{"conversation_id": "c1"}, want: "c1"},
		{name: "camel case", meta: map[string]string{"conversationId": "c2"}, want: "c2"},
		{name: "missing", meta: map[string]string{}, want: ""},
	}
	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := conversationIDFromMetadata(tt.meta); got != tt.want {
				t.Fatalf("conversationIDFromMetadata()=%q want %q", got, tt.want)
			}
		})
	}
}
