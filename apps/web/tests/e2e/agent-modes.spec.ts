import { execSync } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const AGENT_NAMES = [
  "General Chat",
  "Research Assistant",
  "Coder",
  "Intelligence Collector",
  "Social Manager",
  "Clip Creator",
] as const;

async function mockApi(page: Page) {
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
          models: [{ id: "openai/gpt-4o-mini", name: "GPT-4o Mini", provider: "OpenAI" }],
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
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
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

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await gotoChatHome(page);
});

test("Navigation & layout", async ({ page }) => {
  const sidebar = page.locator("aside.hidden.w-16");
  await expect(sidebar).toBeVisible();
  await expect(sidebar).toHaveClass(/w-16/);
  await expect(sidebar).not.toHaveClass(/w-56/);

  const sidebarLabels = [
    "Chat",
    "Channels",
    "Agents",
    "Approvals",
    "Swarm",
    "Usage",
    "Billing",
    "Profile",
    "Settings",
    "Deploy",
  ];

  for (const label of sidebarLabels) {
    const link = page.locator(`aside a[title=\"${label}\"]`);
    await expect(link).toBeVisible();
    await expect(link.locator("svg")).toHaveCount(1);
    await expect(link.getByText(label)).toBeVisible();
  }

  await expect(page.getByText(/^Hands$/)).toHaveCount(0);
  await expect(page.locator("aside a[title='AI Agents'], aside a[title='Agents']")).toHaveCount(1);

  await page.locator("aside a[title='Channels']").click();
  await expect(page).toHaveURL(/\/dashboard\/channels$/);

  await page.locator("aside a[title='Swarm']").click();
  await expect(page).toHaveURL(/\/dashboard\/swarm$/);

  await page.locator("aside a[title='Chat']").click();
  await expect(page).toHaveURL(/\/dashboard\/chat$/);
});

test("Agent grid home state", async ({ page }) => {
  const tiles = page.locator("article");
  await expect(tiles).toHaveCount(6);

  for (const name of AGENT_NAMES) {
    const tile = tiles.filter({ has: page.getByRole("heading", { name }) });
    await expect(tile).toHaveCount(1);
    await expect(tile.locator("h3")).toBeVisible();
    await expect(tile.locator("p")).toBeVisible();
    const iconText = (await tile.locator("div").first().textContent()) ?? "";
    expect(iconText.trim().length).toBeGreaterThan(0);
  }

  await expect(page.getByText("Lead Generator")).toHaveCount(0);
  await expect(page.getByText("Browser")).toHaveCount(0);
  await expect(page.getByText("Predictor")).toHaveCount(0);

  await expect(page.locator("article")).toHaveCount(6);
  await expect(page.locator("[data-agent-mode]")).toHaveCount(0);
});

test("Agent mode selection and switching", async ({ page }) => {
  await enterAgentMode(page, "Research Assistant");
  await expect(page.locator("[data-agent-mode='research']")).toBeVisible();

  const modeButtons = page.locator("button[aria-label^='Switch to']");
  await expect(modeButtons).toHaveCount(6);

  const researchButton = page.getByRole("button", { name: "Switch to Research Assistant" });
  await expect(researchButton).toHaveClass(/border-\[#2f8f5b\]/);

  await page.getByRole("button", { name: "Switch to Coder" }).click();
  await expect(page.locator("[data-agent-mode='coder']")).toBeVisible();

  await page.getByRole("button", { name: "Back to agents" }).click();
  await expect(page.getByRole("heading", { name: "Choose an AI Agent to get started" })).toBeVisible();
});

test("Per-agent layout variants", async ({ page }) => {
  await enterAgentMode(page, "Research Assistant");
  await expect(page.locator("[data-agent-mode='research'] > aside")).toHaveCount(1);
  await expect(page.getByText("Research Panel")).toBeVisible();

  await page.getByRole("button", { name: "Switch to Coder" }).click();
  await expect(page.locator("[data-agent-mode='coder'] aside")).toHaveCount(0);

  await page.getByRole("button", { name: "Switch to Intelligence Collector" }).click();
  await expect(page.locator("[data-agent-mode='intel'] > aside")).toHaveCount(1);
  await expect(page.getByText("Intel Dashboard")).toBeVisible();

  await page.getByRole("button", { name: "Switch to Social Manager" }).click();
  await expect(page.locator("[data-agent-mode='social'] > aside")).toHaveCount(1);
  await expect(page.getByText("Posting Calendar")).toBeVisible();

  await page.getByRole("button", { name: "Switch to Clip Creator" }).click();
  await expect(page.locator("[data-agent-mode='clip'] > aside")).toHaveCount(1);
  await expect(page.getByText("Timeline / Storyboard")).toBeVisible();

  const generalChatSwitch = page.getByRole("button", { name: "Switch to General Chat" });
  await generalChatSwitch.scrollIntoViewIfNeeded();
  await generalChatSwitch.click({ force: true });
  await expect(page.locator("[data-agent-mode='chat'] aside")).toHaveCount(0);
});

test("Chat functionality and message persistence", async ({ page }) => {
  await enterAgentMode(page, "General Chat");

  await expect(page.getByRole("button", { name: "+ New Chat" })).toBeVisible();
  await expect(page.getByText("Conversations")).toHaveCount(0);

  const input = page.getByPlaceholder("Send a message...");
  await input.fill("E2E persistence test message");
  await page.getByRole("button", { name: "Send" }).click();

  await expect(page.getByText("E2E persistence test message")).toBeVisible();

  await page.getByRole("button", { name: "Switch to Research Assistant" }).click();
  await expect(page.getByText("E2E persistence test message")).toBeVisible();

  await page.getByRole("button", { name: "Switch to Coder" }).click();
  await expect(page.getByText("E2E persistence test message")).toBeVisible();
});

test("Swarm TUI compact panel and workspace tab", async ({ page }) => {
  await enterAgentMode(page, "Coder");

  const swarmHeader = page.getByText("Swarm: agentsquads");
  await expect(swarmHeader).toBeVisible();

  const panel = page.locator("section:has-text('Swarm: agentsquads')").first();
  const toggle = panel.locator("button").filter({ hasText: /▲|▼/ }).first();
  const expandableBody = panel.locator("div.overflow-hidden.transition-all.duration-300.ease-in-out");

  await toggle.click();
  await expect(toggle).toContainText("▲");
  await expect(page.getByText("Recently Completed")).toBeVisible();

  await toggle.click();
  await expect(toggle).toContainText("▼");
  await expect(expandableBody).toHaveClass(/max-h-0/);

  await page.getByRole("button", { name: "Dismiss swarm status" }).click();
  await expect(page.getByText("Swarm: agentsquads")).toHaveCount(0);

  await page.locator("aside a[title='Swarm']").click();
  await expect(page).toHaveURL(/\/dashboard\/swarm$/);
  await expect(page.getByRole("heading", { name: "Swarm Workspace" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "AS-01" })).toBeVisible();
});

test("Cleanup verification", async ({ page }) => {
  const bodyText = await page.locator("body").innerText();

  expect(bodyText).not.toMatch(/OpenFang Hands/i);
  expect(bodyText).not.toMatch(/\bHands\b/);
  expect(bodyText).not.toMatch(/\bleadgen\b/i);
  expect(bodyText).not.toMatch(/\bbrowser\b/i);
  expect(bodyText).not.toMatch(/\bpredictor\b/i);

  const repoRoot = path.resolve(__dirname, "../../../..");
  let matched = false;
  let grepOutput = "";

  try {
    grepOutput = execSync('grep -r "OpenFang Hands\\|leadgen\\|predictor" apps/web/src/', {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    matched = grepOutput.trim().length > 0;
  } catch (error) {
    const cause = error as { status?: number; stdout?: string | Buffer };
    if (cause.status === 1) {
      matched = false;
      grepOutput = typeof cause.stdout === "string" ? cause.stdout : cause.stdout?.toString() ?? "";
    } else {
      throw error;
    }
  }

  expect(matched, grepOutput || "Unexpected grep match").toBe(false);
});
