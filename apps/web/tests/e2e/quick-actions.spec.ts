import { expect, test, type Page } from "@playwright/test";

type ChatRequest = {
  conversationId?: string;
  message?: string;
  model?: string;
  agentId?: string;
};

async function mockApi(page: Page, chatRequests: ChatRequest[]) {
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());

    if (pathname === "/api/agents/config") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ configs: {} }),
      });
      return;
    }

    if (pathname === "/api/models") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          models: [
            { id: "anthropic/claude-opus-4-6", name: "anthropic/claude-opus-4-6", provider: "anthropic" },
            { id: "openai/gpt-4o-mini", name: "openai/gpt-4o-mini", provider: "openai" },
            { id: "google/gemini-2.5-pro", name: "google/gemini-2.5-pro", provider: "google" },
          ],
        }),
      });
      return;
    }

    if (pathname === "/api/chat/history") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ messages: [] }),
      });
      return;
    }

    if (pathname === "/api/chat" && req.method() === "POST") {
      try {
        const payload = (await req.postDataJSON()) as ChatRequest;
        chatRequests.push(payload);
      } catch {
        chatRequests.push({});
      }

      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          conversationId: "conv-e2e",
          message: {
            role: "assistant",
            content: "Stubbed assistant response.",
          },
          suggestions: ["Follow up 1", "Follow up 2", "Follow up 3"],
        }),
      });
      return;
    }

    if (pathname === "/api/swarm/status") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          project: "agentsquads",
          phase: 2,
          stats: {
            done: 3,
            running: 2,
            todo: 1,
            failed: 0,
            blocked: 0,
            total: 6,
            percent: 50,
          },
          tickets: [
            { id: "AS-01", phase: 1, status: "done", description: "Rename nav labels" },
            { id: "AS-02", phase: 1, status: "done", description: "Update list" },
            { id: "AS-03", phase: 2, status: "running", description: "Refine mode selector" },
            { id: "AS-04", phase: 2, status: "running", description: "Verify split layouts" },
            { id: "AS-05", phase: 3, status: "todo", description: "Final cleanup" },
            { id: "AS-06", phase: 3, status: "done", description: "Smoke checks" },
          ],
        }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "{}",
    });
  });
}

async function gotoChatHome(page: Page) {
  await page.goto("/dashboard/chat");
  await expect(page.getByRole("heading", { name: "Choose an AI Agent to get started" })).toBeVisible();
}

async function enterAgentMode(page: Page, agentName: string) {
  const tile = page.locator("article").filter({
    has: page.getByRole("heading", { name: agentName }),
  });
  await expect(tile).toBeVisible();
  await tile.getByRole("button", { name: "Start" }).click();
  await expect(page.getByRole("button", { name: "Back to agents" })).toBeVisible();
}

async function switchAgent(page: Page, agentName: string) {
  await page.getByRole("button", { name: `Switch to ${agentName}` }).click();
  await expect(page.getByRole("button", { name: `Switch to ${agentName}` })).toHaveClass(/border-\[#2f8f5b\]/);
}

test.describe("Quick actions + UI tweaks", () => {
  test("Sidebar and chat header/nav model placement", async ({ page }) => {
    const chatRequests: ChatRequest[] = [];
    await mockApi(page, chatRequests);
    await gotoChatHome(page);

    const sidebar = page.locator("aside.hidden").first();
    await expect(sidebar).toBeVisible();
    await expect(sidebar).not.toHaveClass(/\bw-16\b/);

    for (const label of ["Chat", "Channels", "Agents", "Approvals", "Swarm", "Usage", "Billing", "Profile", "Settings", "Deploy"]) {
      await expect(sidebar.getByRole("link", { name: label })).toBeVisible();
    }

    await enterAgentMode(page, "Research Assistant");

    const topNavbar = page.locator("header").first();
    await expect(topNavbar.getByLabel("Select model")).toHaveCount(0);

    await expect(page.getByRole("button", { name: "Configure" })).toBeVisible();
    await expect(page.getByRole("button", { name: "+ New Chat" })).toBeVisible();

    const modelSelect = page.getByLabel("Select model");
    await expect(modelSelect).toBeVisible();

    const selectedAgentNameInHeader = page
      .locator("div")
      .filter({ has: page.getByText("active") })
      .getByText("Research Assistant");
    await expect(selectedAgentNameInHeader).toBeVisible();

    await modelSelect.click();
    const optionTexts = await modelSelect.locator("option").allTextContents();
    expect(optionTexts.some((value) => value.includes("/"))).toBe(true);

    const chatBottomBar = page.locator("div.border-t.border-\[#1f1f2a\]").first();
    await expect(chatBottomBar).toBeVisible();
    await expect(chatBottomBar.locator("span.font-mono")).toHaveCount(0);
  });

  test("Research quick action modal submits prompt into chat", async ({ page }) => {
    const chatRequests: ChatRequest[] = [];
    await mockApi(page, chatRequests);
    await gotoChatHome(page);
    await enterAgentMode(page, "Research Assistant");

    await expect(page.getByRole("button", { name: "Start New Research" })).toBeVisible();
    await page.getByRole("button", { name: "Start New Research" }).click();

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();

    const topicField = modal.getByLabel("Research Topic");
    await expect(topicField).toBeVisible();
    await expect(topicField).toHaveAttribute("required", "");

    await topicField.fill("AI coding agents in enterprise teams");

    const submit = modal.getByRole("button", { name: /start|submit|generate|create/i }).first();
    await submit.click();

    await expect
      .poll(() => chatRequests.length, { message: "Expected quick action submit to call /api/chat" })
      .toBeGreaterThan(0);

    const submittedMessage = chatRequests[chatRequests.length - 1]?.message ?? "";
    expect(submittedMessage).toContain("AI coding agents in enterprise teams");
    await expect(page.getByText("AI coding agents in enterprise teams")).toBeVisible();
  });

  test("Per-agent quick action buttons", async ({ page }) => {
    const chatRequests: ChatRequest[] = [];
    await mockApi(page, chatRequests);
    await gotoChatHome(page);

    await enterAgentMode(page, "Research Assistant");
    await expect(page.getByRole("button", { name: "Start New Research" })).toBeVisible();

    await switchAgent(page, "Coder");
    await expect(page.getByRole("button", { name: "Project" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Web Page" })).toBeVisible();

    await switchAgent(page, "Social Manager");
    await expect(page.getByRole("button", { name: "Article" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Social Post" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Carousel" })).toBeVisible();

    await switchAgent(page, "Clip Creator");
    await expect(page.getByRole("button", { name: "Youtube Clip" })).toBeVisible();

    await switchAgent(page, "General Chat");
    await expect(page.getByRole("button", { name: "Start New Research" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Project" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Web Page" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Article" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Social Post" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reel" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Carousel" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Youtube Clip" })).toHaveCount(0);
  });
});
