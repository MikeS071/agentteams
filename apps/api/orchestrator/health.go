package orchestrator

import (
	"fmt"
	"net/http"
	"time"
)

// CheckOpenFangHealth probes the OpenFang health endpoint with a 5s timeout.
func CheckOpenFangHealth(host string, port int) bool {
	client := &http.Client{Timeout: 5 * time.Second}

	resp, err := client.Get(fmt.Sprintf("http://%s:%d/v1/health", host, port))
	if err != nil {
		return false
	}
	defer resp.Body.Close()

	return resp.StatusCode >= 200 && resp.StatusCode < 300
}
