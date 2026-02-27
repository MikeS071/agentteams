package workflows

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

var (
	ErrTemplateNotFound = errors.New("workflow template not found")

	validTemplateStepTypes = map[string]struct{}{
		"action":    {},
		"confirm":   {},
		"condition": {},
	}
	nonSlugPattern = regexp.MustCompile(`[^a-z0-9-]`)
)

// Template defines a visual workflow template used by the builder/editor UI.
type Template struct {
	ID          string         `toml:"id" json:"id"`
	Name        string         `toml:"name" json:"name"`
	Description string         `toml:"description" json:"description"`
	Steps       []TemplateStep `toml:"steps" json:"steps"`
	IsStarter   bool           `toml:"-" json:"isStarter"`
}

// TemplateStep defines one step in a visual workflow template.
type TemplateStep struct {
	Name          string `toml:"name" json:"name"`
	Type          string `toml:"type" json:"type"`
	Description   string `toml:"description" json:"description"`
	ActionCommand string `toml:"action_command" json:"actionCommand"`
}

// TemplateStore provides file-backed CRUD for workflow templates.
type TemplateStore struct {
	baseDir   string
	customDir string
}

func NewTemplateStore(baseDir string) *TemplateStore {
	return &TemplateStore{
		baseDir:   baseDir,
		customDir: filepath.Join(baseDir, "custom"),
	}
}

func DefaultTemplatesDir() string {
	if env := strings.TrimSpace(os.Getenv("WORKFLOW_TEMPLATES_DIR")); env != "" {
		return env
	}
	return filepath.Join("workflows", "templates")
}

func (s *TemplateStore) List() ([]Template, error) {
	starterTemplates, err := s.loadTemplatesFromDir(s.baseDir, true)
	if err != nil {
		return nil, err
	}
	customTemplates, err := s.loadTemplatesFromDir(s.customDir, false)
	if err != nil {
		return nil, err
	}

	templates := append(starterTemplates, customTemplates...)
	sort.Slice(templates, func(i, j int) bool {
		if templates[i].IsStarter != templates[j].IsStarter {
			return templates[i].IsStarter
		}
		return templates[i].ID < templates[j].ID
	})
	return templates, nil
}

func (s *TemplateStore) Get(name string) (Template, error) {
	templateID := slugify(name)
	if templateID == "" {
		return Template{}, fmt.Errorf("template name is required")
	}

	customPath := filepath.Join(s.customDir, templateID+".toml")
	template, err := s.parseTemplateFile(customPath, false)
	if err == nil {
		return template, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return Template{}, err
	}

	starterPath := filepath.Join(s.baseDir, templateID+".toml")
	template, err = s.parseTemplateFile(starterPath, true)
	if err == nil {
		return template, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return Template{}, ErrTemplateNotFound
	}
	return Template{}, err
}

func (s *TemplateStore) Save(template Template) (Template, error) {
	template.ID = slugify(firstNonEmpty(template.ID, template.Name))
	template.Name = strings.TrimSpace(template.Name)
	template.Description = strings.TrimSpace(template.Description)
	template.IsStarter = false

	if err := validateTemplate(template); err != nil {
		return Template{}, err
	}
	if err := os.MkdirAll(s.customDir, 0o755); err != nil {
		return Template{}, fmt.Errorf("create template directory: %w", err)
	}

	path := filepath.Join(s.customDir, template.ID+".toml")
	file, err := os.Create(path)
	if err != nil {
		return Template{}, fmt.Errorf("create template file: %w", err)
	}
	defer file.Close()

	if err := toml.NewEncoder(file).Encode(template); err != nil {
		return Template{}, fmt.Errorf("encode template file: %w", err)
	}

	return template, nil
}

func (s *TemplateStore) loadTemplatesFromDir(dir string, isStarter bool) ([]Template, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, fmt.Errorf("read templates dir %s: %w", dir, err)
	}

	templates := make([]Template, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".toml" {
			continue
		}

		path := filepath.Join(dir, entry.Name())
		template, err := s.parseTemplateFile(path, isStarter)
		if err != nil {
			return nil, err
		}
		templates = append(templates, template)
	}

	return templates, nil
}

func (s *TemplateStore) parseTemplateFile(path string, isStarter bool) (Template, error) {
	var template Template
	if _, err := toml.DecodeFile(path, &template); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return Template{}, err
		}
		return Template{}, fmt.Errorf("decode template %s: %w", path, err)
	}

	if strings.TrimSpace(template.ID) == "" {
		template.ID = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
	}
	template.ID = slugify(template.ID)
	template.IsStarter = isStarter

	if err := validateTemplate(template); err != nil {
		return Template{}, fmt.Errorf("validate template %s: %w", path, err)
	}
	return template, nil
}

func validateTemplate(template Template) error {
	if template.ID == "" {
		return fmt.Errorf("template id is required")
	}
	if template.Name == "" {
		return fmt.Errorf("template name is required")
	}
	if len(template.Steps) == 0 {
		return fmt.Errorf("at least one step is required")
	}

	for i, step := range template.Steps {
		stepName := strings.TrimSpace(step.Name)
		if stepName == "" {
			return fmt.Errorf("step %d name is required", i+1)
		}
		stepType := strings.TrimSpace(step.Type)
		if _, ok := validTemplateStepTypes[stepType]; !ok {
			return fmt.Errorf("step %q has invalid type %q", step.Name, step.Type)
		}
		if strings.TrimSpace(step.Description) == "" {
			return fmt.Errorf("step %q description is required", step.Name)
		}
	}

	return nil
}

func slugify(input string) string {
	normalized := strings.ToLower(strings.TrimSpace(input))
	normalized = strings.ReplaceAll(normalized, "_", "-")
	normalized = strings.ReplaceAll(normalized, " ", "-")
	normalized = nonSlugPattern.ReplaceAllString(normalized, "")
	normalized = strings.Trim(normalized, "-")
	for strings.Contains(normalized, "--") {
		normalized = strings.ReplaceAll(normalized, "--", "-")
	}
	return normalized
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
