package billing

import "testing"

func TestCalculateCostCents_GPT4oPricing(t *testing.T) {
	pricing := modelPricing{
		inputPerMillionCents:  250,
		outputPerMillionCents: 1000,
		markupPct:             30,
	}

	tests := []struct {
		name         string
		tokensIn     int
		tokensOut    int
		wantBase     int
		wantWithMark int
	}{
		{
			name:         "1000 input tokens",
			tokensIn:     1000,
			tokensOut:    0,
			wantBase:     1,
			wantWithMark: 1,
		},
		{
			name:         "1000 input and 1000 output tokens",
			tokensIn:     1000,
			tokensOut:    1000,
			wantBase:     2,
			wantWithMark: 2,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			base, total := calculateCostCents(pricing, tc.tokensIn, tc.tokensOut)
			if base != tc.wantBase {
				t.Fatalf("expected base cost %d cents, got %d", tc.wantBase, base)
			}
			if total != tc.wantWithMark {
				t.Fatalf("expected total cost %d cents, got %d", tc.wantWithMark, total)
			}
		})
	}
}
