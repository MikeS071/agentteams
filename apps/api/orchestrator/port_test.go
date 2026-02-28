package orchestrator

import "testing"

func TestNextSequentialPort(t *testing.T) {
	tests := []struct {
		name     string
		base     int
		assigned []int
		want     int
	}{
		{name: "empty", base: 4200, assigned: nil, want: 4200},
		{name: "first used", base: 4200, assigned: []int{4200}, want: 4201},
		{name: "gap reused", base: 4200, assigned: []int{4200, 4202, 4203}, want: 4201},
		{name: "below base ignored", base: 4200, assigned: []int{80, 8080}, want: 4200},
		{name: "unsorted input", base: 4200, assigned: []int{4203, 4201, 4200}, want: 4202},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := nextSequentialPort(tt.base, tt.assigned); got != tt.want {
				t.Fatalf("nextSequentialPort() = %d, want %d", got, tt.want)
			}
		})
	}
}
