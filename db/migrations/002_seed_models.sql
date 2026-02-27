INSERT INTO models (id, name, provider, provider_cost_input_per_m, provider_cost_output_per_m, markup_pct, enabled) VALUES
  ('gpt-4o', 'GPT-4o', 'openai', 250, 1000, 30, true),
  ('gpt-4o-mini', 'GPT-4o Mini', 'openai', 15, 60, 40, true),
  ('claude-sonnet-4', 'Claude Sonnet 4', 'anthropic', 300, 1500, 30, true),
  ('claude-opus-4', 'Claude Opus 4', 'anthropic', 1500, 7500, 25, true),
  ('gemini-2.0-flash', 'Gemini 2.0 Flash', 'google', 10, 40, 40, true);
