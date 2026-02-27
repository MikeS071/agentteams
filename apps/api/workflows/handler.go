package workflows

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
)

// Handler exposes workflow endpoints over HTTP.
type Handler struct {
	runner *Runner
}

func NewHandler(runner *Runner) *Handler {
	return &Handler{runner: runner}
}

func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/workflows", h.handleList)
	mux.HandleFunc("POST /api/workflows/{id}/start", h.handleStart)
	mux.HandleFunc("POST /api/workflows/runs/{runID}/step", h.handleStep)
	mux.HandleFunc("POST /api/workflows/runs/{runID}/confirm", h.handleConfirm)
	mux.HandleFunc("GET /api/workflows/runs/{runID}", h.handleGetRun)
}

func (h *Handler) handleList(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"workflows": h.runner.ListWorkflows(),
	})
}

func (h *Handler) handleStart(w http.ResponseWriter, r *http.Request) {
	workflowID := r.PathValue("id")
	if workflowID == "" {
		writeError(w, http.StatusBadRequest, "missing workflow id")
		return
	}

	var body struct {
		TenantID string `json:"tenant_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	run, err := h.runner.Start(workflowID, body.TenantID)
	if err != nil {
		handleRunnerError(w, err)
		return
	}
	step, err := h.runner.GetCurrentStep(run.ID)
	if err != nil {
		handleRunnerError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"run":       run,
		"next_step": step,
	})
}

func (h *Handler) handleStep(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	if runID == "" {
		writeError(w, http.StatusBadRequest, "missing run id")
		return
	}

	var body struct {
		Input string `json:"input"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	nextStep, done, err := h.runner.SubmitStep(runID, body.Input)
	if err != nil {
		handleRunnerError(w, err)
		return
	}

	run, err := h.runner.GetRun(runID)
	if err != nil {
		handleRunnerError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"run":       run,
		"done":      done,
		"next_step": nextStep,
	})
}

func (h *Handler) handleConfirm(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	if runID == "" {
		writeError(w, http.StatusBadRequest, "missing run id")
		return
	}

	brief, err := h.runner.Confirm(runID)
	if err != nil {
		handleRunnerError(w, err)
		return
	}

	run, err := h.runner.GetRun(runID)
	if err != nil {
		handleRunnerError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"run":   run,
		"brief": brief,
	})
}

func (h *Handler) handleGetRun(w http.ResponseWriter, r *http.Request) {
	runID := r.PathValue("runID")
	if runID == "" {
		writeError(w, http.StatusBadRequest, "missing run id")
		return
	}

	run, err := h.runner.GetRun(runID)
	if err != nil {
		handleRunnerError(w, err)
		return
	}

	nextStep, err := h.runner.GetCurrentStep(runID)
	if err != nil {
		handleRunnerError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"run":       run,
		"next_step": nextStep,
	})
}

func handleRunnerError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrWorkflowNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrRunNotFound):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, ErrRunIncomplete):
		writeError(w, http.StatusConflict, err.Error())
	case errors.Is(err, ErrRunNotInProgress):
		writeError(w, http.StatusConflict, err.Error())
	default:
		writeError(w, http.StatusBadRequest, err.Error())
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
	}
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
