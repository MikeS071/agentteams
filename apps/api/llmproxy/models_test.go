package llmproxy

import (
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestNewModelRegistry(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name    string
		setup   func(sqlmock.Sqlmock)
		wantErr bool
		wantLen int
	}{
		{
			name: "loads enabled models",
			setup: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "name", "provider", "provider_cost_input_per_m", "provider_cost_output_per_m", "markup_pct", "enabled"}).
					AddRow("gpt-4o", "GPT-4o", "openai", 50, 150, 20, true).
					AddRow("claude", "Claude", "anthropic", 30, 120, 25, true)
				mock.ExpectQuery("SELECT id, name, provider").WillReturnRows(rows)
			},
			wantLen: 2,
		},
		{
			name: "query error",
			setup: func(mock sqlmock.Sqlmock) {
				mock.ExpectQuery("SELECT id, name, provider").WillReturnError(assertErr{})
			},
			wantErr: true,
		},
		{
			name: "scan error",
			setup: func(mock sqlmock.Sqlmock) {
				rows := sqlmock.NewRows([]string{"id", "name", "provider", "provider_cost_input_per_m", "provider_cost_output_per_m", "markup_pct", "enabled"}).
					AddRow("gpt-4o", "GPT-4o", "openai", "bad", 150, 20, true)
				mock.ExpectQuery("SELECT id, name, provider").WillReturnRows(rows)
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

			reg, err := NewModelRegistry(db)
			if (err != nil) != tt.wantErr {
				t.Fatalf("NewModelRegistry() err = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				if got := len(reg.ListModels()); got != tt.wantLen {
					t.Fatalf("ListModels() len = %d, want %d", got, tt.wantLen)
				}
			}
		})
	}
}

func TestModelRegistryGetModel(t *testing.T) {
	t.Parallel()
	reg := &ModelRegistry{models: map[string]*Model{
		"gpt-4o": {ID: "gpt-4o", Provider: "openai", ProviderCostInputM: 1, ProviderCostOutputM: 2, MarkupPct: 10},
	}}

	tests := []struct {
		name    string
		modelID string
		wantErr bool
	}{
		{name: "found", modelID: "gpt-4o", wantErr: false},
		{name: "unknown model fallback error", modelID: "unknown", wantErr: true},
		{name: "empty model id", modelID: "", wantErr: true},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			model, err := reg.GetModel(tt.modelID)
			if (err != nil) != tt.wantErr {
				t.Fatalf("GetModel() err = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && model.ID != "gpt-4o" {
				t.Fatalf("GetModel() wrong model: %#v", model)
			}
		})
	}
}

func TestModelPricingLookupViaCalcCost(t *testing.T) {
	t.Parallel()
	reg := &ModelRegistry{models: map[string]*Model{
		"m1": {ID: "m1", ProviderCostInputM: 100, ProviderCostOutputM: 200, MarkupPct: 0},
	}}
	m, err := reg.GetModel("m1")
	if err != nil {
		t.Fatalf("GetModel: %v", err)
	}
	if got := CalcCostCents(m, 1_000_000, 500_000); got != 200 {
		t.Fatalf("CalcCostCents() = %d, want 200", got)
	}
}
