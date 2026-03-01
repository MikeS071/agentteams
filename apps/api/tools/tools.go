package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

// Tool represents an OpenAI-format tool definition.
type Tool struct {
	Type     string       `json:"type"`
	Function FunctionDef  `json:"function"`
}

type FunctionDef struct {
	Name        string          `json:"name"`
	Description string          `json:"description"`
	Parameters  json.RawMessage `json:"parameters"`
}

// ToolCall from an LLM response.
type ToolCall struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

// ToolResult to feed back into the LLM.
type ToolResult struct {
	ToolCallID string `json:"tool_call_id"`
	Role       string `json:"role"`
	Content    string `json:"content"`
}

// Registry holds all available tools and their handlers.
type Registry struct {
	tools    map[string]Tool
	handlers map[string]func(ctx context.Context, args json.RawMessage) (string, error)
	client   *http.Client
}

func NewRegistry() *Registry {
	r := &Registry{
		tools:    make(map[string]Tool),
		handlers: make(map[string]func(ctx context.Context, args json.RawMessage) (string, error)),
		client:   &http.Client{Timeout: 30 * time.Second},
	}
	r.registerAll()
	return r
}

// GetTools returns tool definitions for the given agent type.
func (r *Registry) GetTools(agentID string) []Tool {
	toolNames := agentToolMap(agentID)
	var result []Tool
	for _, name := range toolNames {
		if t, ok := r.tools[name]; ok {
			result = append(result, t)
		}
	}
	return result
}

// Execute runs a tool by name with the given arguments.
func (r *Registry) Execute(ctx context.Context, name string, args json.RawMessage) (string, error) {
	handler, ok := r.handlers[name]
	if !ok {
		return "", fmt.Errorf("unknown tool: %s", name)
	}
	return handler(ctx, args)
}

func agentToolMap(agentID string) []string {
	switch agentID {
	case "research":
		return []string{"web_search", "web_fetch", "memory_store", "memory_recall"}
	case "coder":
		return []string{"web_search", "web_fetch"}
	case "intel":
		return []string{"web_search", "web_fetch", "memory_store", "memory_recall"}
	case "social":
		return []string{"web_search", "web_fetch"}
	case "clip":
		return []string{"web_search", "web_fetch"}
	case "chat":
		return []string{"web_search", "web_fetch"}
	default:
		return []string{"web_search", "web_fetch"}
	}
}

func (r *Registry) registerAll() {
	// ─── web_search ─────────────────────────────────────────────────────
	r.tools["web_search"] = Tool{
		Type: "function",
		Function: FunctionDef{
			Name:        "web_search",
			Description: "Search the web for current information. Returns titles, URLs, and snippets from search results. Use this to find recent data, verify claims, discover sources, and gather evidence.",
			Parameters:  json.RawMessage(`{"type":"object","properties":{"query":{"type":"string","description":"Search query string"},"count":{"type":"integer","description":"Number of results (1-10, default 5)","default":5}},"required":["query"]}`),
		},
	}
	r.handlers["web_search"] = r.handleWebSearch

	// ─── web_fetch ──────────────────────────────────────────────────────
	r.tools["web_fetch"] = Tool{
		Type: "function",
		Function: FunctionDef{
			Name:        "web_fetch",
			Description: "Fetch and extract readable content from a URL. Returns the page content as clean text/markdown. Use this to read articles, documentation, research papers, or any web page in detail.",
			Parameters:  json.RawMessage(`{"type":"object","properties":{"url":{"type":"string","description":"URL to fetch"},"max_chars":{"type":"integer","description":"Maximum characters to return (default 8000)","default":8000}},"required":["url"]}`),
		},
	}
	r.handlers["web_fetch"] = r.handleWebFetch

	// ─── memory_store ───────────────────────────────────────────────────
	r.tools["memory_store"] = Tool{
		Type: "function",
		Function: FunctionDef{
			Name:        "memory_store",
			Description: "Store a piece of information in working memory for later recall. Use this to save key findings, source evaluations, intermediate results, or any data you want to reference later in the conversation.",
			Parameters:  json.RawMessage(`{"type":"object","properties":{"key":{"type":"string","description":"Unique key to store under (e.g. 'source_1', 'finding_market_size')"},"content":{"type":"string","description":"Content to store"},"category":{"type":"string","description":"Category: finding, source, data, note","enum":["finding","source","data","note"]}},"required":["key","content"]}`),
		},
	}
	r.handlers["memory_store"] = r.handleMemoryStore

	// ─── memory_recall ──────────────────────────────────────────────────
	r.tools["memory_recall"] = Tool{
		Type: "function",
		Function: FunctionDef{
			Name:        "memory_recall",
			Description: "Recall stored information from working memory. Use this to retrieve previously saved findings, sources, or data points.",
			Parameters:  json.RawMessage(`{"type":"object","properties":{"key":{"type":"string","description":"Key to recall, or '*' to list all stored keys"}},"required":["key"]}`),
		},
	}
	r.handlers["memory_recall"] = r.handleMemoryRecall
}

// ─── Tool handlers ──────────────────────────────────────────────────────────

func (r *Registry) handleWebSearch(ctx context.Context, args json.RawMessage) (string, error) {
	var params struct {
		Query string `json:"query"`
		Count int    `json:"count"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return "", fmt.Errorf("parse args: %w", err)
	}
	if params.Query == "" {
		return "", fmt.Errorf("query is required")
	}
	if params.Count <= 0 || params.Count > 10 {
		params.Count = 5
	}

	apiKey := strings.TrimSpace(os.Getenv("BRAVE_API_KEY"))
	if apiKey == "" {
		// Fallback: use DuckDuckGo HTML scrape
		return r.duckDuckGoSearch(ctx, params.Query, params.Count)
	}

	reqURL := fmt.Sprintf("https://api.search.brave.com/res/v1/web/search?q=%s&count=%d",
		url.QueryEscape(params.Query), params.Count)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Subscription-Token", apiKey)

	resp, err := r.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("brave search request: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		// Fallback to DDG
		return r.duckDuckGoSearch(ctx, params.Query, params.Count)
	}

	var result struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse brave response: %w", err)
	}

	var sb strings.Builder
	for i, r := range result.Web.Results {
		if i >= params.Count {
			break
		}
		sb.WriteString(fmt.Sprintf("%d. **%s**\n   URL: %s\n   %s\n\n", i+1, r.Title, r.URL, r.Description))
	}
	if sb.Len() == 0 {
		return "No results found.", nil
	}
	return sb.String(), nil
}

func (r *Registry) duckDuckGoSearch(ctx context.Context, query string, count int) (string, error) {
	reqURL := fmt.Sprintf("https://html.duckduckgo.com/html/?q=%s", url.QueryEscape(query))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AgentSquads/1.0)")

	resp, err := r.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("duckduckgo search: %w", err)
	}
	defer resp.Body.Close()

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return "", fmt.Errorf("parse DDG html: %w", err)
	}

	var sb strings.Builder
	i := 0
	doc.Find(".result").Each(func(_ int, s *goquery.Selection) {
		if i >= count {
			return
		}
		title := strings.TrimSpace(s.Find(".result__title a").Text())
		href, _ := s.Find(".result__title a").Attr("href")
		snippet := strings.TrimSpace(s.Find(".result__snippet").Text())
		if title != "" {
			i++
			sb.WriteString(fmt.Sprintf("%d. **%s**\n   URL: %s\n   %s\n\n", i, title, href, snippet))
		}
	})
	if sb.Len() == 0 {
		return "No results found for: " + query, nil
	}
	return sb.String(), nil
}

func (r *Registry) handleWebFetch(ctx context.Context, args json.RawMessage) (string, error) {
	var params struct {
		URL      string `json:"url"`
		MaxChars int    `json:"max_chars"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return "", fmt.Errorf("parse args: %w", err)
	}
	if params.URL == "" {
		return "", fmt.Errorf("url is required")
	}
	if params.MaxChars <= 0 {
		params.MaxChars = 8000
	}
	if params.MaxChars > 30000 {
		params.MaxChars = 30000
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, params.URL, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; AgentSquads/1.0)")
	req.Header.Set("Accept", "text/html,application/xhtml+xml,text/plain")

	resp, err := r.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch url: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Sprintf("HTTP %d fetching %s", resp.StatusCode, params.URL), nil
	}

	ct := resp.Header.Get("Content-Type")
	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, int64(params.MaxChars*3)))
	if err != nil {
		return "", fmt.Errorf("read body: %w", err)
	}

	bodyStr := string(bodyBytes)

	// If HTML, extract text content
	if strings.Contains(ct, "html") {
		doc, err := goquery.NewDocumentFromReader(strings.NewReader(bodyStr))
		if err == nil {
			// Remove scripts, styles, nav, footer
			doc.Find("script, style, nav, footer, header, .sidebar, .cookie, .ad").Remove()
			// Get article or main content first, fallback to body
			content := doc.Find("article, main, .content, .post, .entry").First()
			if content.Length() == 0 {
				content = doc.Find("body")
			}
			bodyStr = strings.TrimSpace(content.Text())
			// Collapse whitespace
			for strings.Contains(bodyStr, "  ") {
				bodyStr = strings.ReplaceAll(bodyStr, "  ", " ")
			}
			for strings.Contains(bodyStr, "\n\n\n") {
				bodyStr = strings.ReplaceAll(bodyStr, "\n\n\n", "\n\n")
			}
		}
	}

	if len(bodyStr) > params.MaxChars {
		bodyStr = bodyStr[:params.MaxChars] + "\n\n[...truncated]"
	}

	return fmt.Sprintf("Content from %s:\n\n%s", params.URL, bodyStr), nil
}

// In-memory working memory (per-conversation, lives for the request duration)
// For production, this should be Redis-backed per conversation
var workingMemory = make(map[string]map[string]string)

func memKey(tenantID, convID string) string {
	return tenantID + ":" + convID
}

func (r *Registry) handleMemoryStore(ctx context.Context, args json.RawMessage) (string, error) {
	var params struct {
		Key      string `json:"key"`
		Content  string `json:"content"`
		Category string `json:"category"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return "", fmt.Errorf("parse args: %w", err)
	}

	// Use a simple global map for now — keyed by the tool call context
	// In production this would be Redis with conversation-scoped TTL
	memID := "global" // Will be overridden by WithMemoryContext
	if id, ok := ctx.Value(memoryContextKey).(string); ok {
		memID = id
	}
	if workingMemory[memID] == nil {
		workingMemory[memID] = make(map[string]string)
	}
	workingMemory[memID][params.Key] = fmt.Sprintf("[%s] %s", params.Category, params.Content)
	return fmt.Sprintf("Stored '%s' in working memory.", params.Key), nil
}

func (r *Registry) handleMemoryRecall(ctx context.Context, args json.RawMessage) (string, error) {
	var params struct {
		Key string `json:"key"`
	}
	if err := json.Unmarshal(args, &params); err != nil {
		return "", fmt.Errorf("parse args: %w", err)
	}

	memID := "global"
	if id, ok := ctx.Value(memoryContextKey).(string); ok {
		memID = id
	}
	mem := workingMemory[memID]
	if mem == nil {
		return "No memory stored yet.", nil
	}

	if params.Key == "*" {
		var sb strings.Builder
		sb.WriteString("Stored memory keys:\n")
		for k, v := range mem {
			// Truncate long values in listing
			preview := v
			if len(preview) > 100 {
				preview = preview[:100] + "..."
			}
			sb.WriteString(fmt.Sprintf("- %s: %s\n", k, preview))
		}
		return sb.String(), nil
	}

	val, ok := mem[params.Key]
	if !ok {
		return fmt.Sprintf("Key '%s' not found in memory.", params.Key), nil
	}
	return val, nil
}

type contextKey string

const memoryContextKey contextKey = "memory_id"

// WithMemoryContext returns a context with the memory scope ID set.
func WithMemoryContext(ctx context.Context, tenantID, conversationID string) context.Context {
	return context.WithValue(ctx, memoryContextKey, memKey(tenantID, conversationID))
}
