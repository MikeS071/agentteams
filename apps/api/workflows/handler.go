package workflows

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
)

// Handler exposes workflow endpoints over HTTP.
type Handler struct {
	runner        *Runner
	templateStore *TemplateStore
}

func NewHandler(runner *Runner) *Handler {
	return &Handler{
		runner:        runner,
		templateStore: NewTemplateStore(DefaultTemplatesDir()),
	}
}

func (h *Handler) Mount(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/workflows", h.handleList)
	mux.HandleFunc("GET /api/workflows/templates", h.handleListTemplates)
	mux.HandleFunc("POST /api/workflows/templates", h.handleSaveTemplate)
	mux.HandleFunc("GET /api/workflows/templates/{name}", h.handleGetTemplate)
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

func (h *Handler) handleListTemplates(w http.ResponseWriter, _ *http.Request) {
	templates, err := h.templateStore.List()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list templates")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"templates": templates,
	})
}

func (h *Handler) handleGetTemplate(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimSpace(r.PathValue("name"))
	if name == "" {
		writeError(w, http.StatusBadRequest, "missing template name")
		return
	}

	template, err := h.templateStore.Get(name)
	if err != nil {
		if errors.Is(err, ErrTemplateNotFound) {
			writeError(w, http.StatusNotFound, err.Error())
			return
		}
		writeError(w, http.StatusInternalServerError, "failed to get template")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"template": template,
	})
}

func (h *Handler) handleSaveTemplate(w http.ResponseWriter, r *http.Request) {
	var template Template
	if err := json.NewDecoder(r.Body).Decode(&template); err != nil {
		writeError(w, http.StatusBadRequest, "invalid json body")
		return
	}

	savedTemplate, err := h.templateStore.Save(template)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"template": savedTemplate,
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
