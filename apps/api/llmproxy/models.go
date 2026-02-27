package llmproxy

import (
	"database/sql"
	"fmt"
	"log/slog"
	"sync"
)

// Model represents an LLM model from the database.
type Model struct {
	ID                   string
	Name                 string
	Provider             string // "openai", "anthropic", "google"
	ProviderCostInputM   int    // cents per million input tokens
	ProviderCostOutputM  int    // cents per million output tokens
	MarkupPct            int
	Enabled              bool
}

// ModelRegistry caches active models in memory.
type ModelRegistry struct {
	mu     sync.RWMutex
	models map[string]*Model // keyed by id
}

// NewModelRegistry loads active models from the database.
func NewModelRegistry(db *sql.DB) (*ModelRegistry, error) {
	rows, err := db.Query(`SELECT id, name, provider, provider_cost_input_per_m, provider_cost_output_per_m, markup_pct, enabled FROM models WHERE enabled = true`)
	if err != nil {
		return nil, fmt.Errorf("query models: %w", err)
	}
	defer rows.Close()

	reg := &ModelRegistry{models: make(map[string]*Model)}
	for rows.Next() {
		var m Model
		if err := rows.Scan(&m.ID, &m.Name, &m.Provider, &m.ProviderCostInputM, &m.ProviderCostOutputM, &m.MarkupPct, &m.Enabled); err != nil {
			return nil, fmt.Errorf("scan model: %w", err)
		}
		reg.models[m.ID] = &m
		slog.Info("loaded model", "id", m.ID, "provider", m.Provider)
	}
	return reg, rows.Err()
}

// GetModel returns a model by ID or an error if not found.
func (r *ModelRegistry) GetModel(name string) (*Model, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	m, ok := r.models[name]
	if !ok {
		return nil, fmt.Errorf("model not found: %s", name)
	}
	return m, nil
}

// ListModels returns all active models.
func (r *ModelRegistry) ListModels() []*Model {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]*Model, 0, len(r.models))
	for _, m := range r.models {
		out = append(out, m)
	}
	return out
}
