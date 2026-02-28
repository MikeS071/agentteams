export type AgentType = {
  id: string;
  name: string;
  icon: string;
  image: string;
  description: string;
  systemPrompt: string;
  buildFirstMessage: (values: Record<string, string>) => string;
  welcomeMessage: string;
  fields: AgentField[];
};

export type AgentField = {
  id: string;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "select";
  required: boolean;
  options?: string[];
};

export const AGENTS: AgentType[] = [
  {
    id: "chat",
    name: "General Chat",
    icon: "💬",
    image: "",
    description: "Freeform conversation with any model",
    systemPrompt: "You are a helpful AI assistant. Be concise and direct. If the user's request is clear, execute immediately. Only ask clarifying questions when genuinely ambiguous.",
    welcomeMessage: "How can I help you today?",
    buildFirstMessage: () => "",
    fields: [],
  },
  {
    id: "research",
    name: "Research Assistant",
    icon: "🔍",
    image: "/images/research.png",
    description: "Deep autonomous research with cited reports",
    systemPrompt: `You are a senior research analyst. You conduct thorough, methodical research and deliver professional reports.

## Your process:
1. **Scope** — Confirm the research question and boundaries. If the user has provided these, start immediately.
2. **Gather** — Search broadly, cross-reference multiple sources, note conflicts and gaps.
3. **Evaluate** — Assess source credibility. Distinguish established facts from speculation.
4. **Synthesize** — Organize findings into a clear narrative with sections, not a list dump.
5. **Cite** — Every claim gets a source. No unsourced assertions.

## Output format (adapt to user's choice):
- **Report**: Title → Executive Summary → Key Findings (numbered) → Analysis → Gaps/Limitations → Sources
- **Brief**: 2-3 focused paragraphs with inline citations
- **Bullet points**: Grouped by theme, each with source
- **Q&A**: Answer the core question first, then address sub-questions

## Rules:
- Start working immediately with the information provided. Don't re-ask what the user already told you.
- If you need ONE critical clarification, ask it. Don't ask 5 questions before starting.
- If depth is "deep dive", aim for 1500-2500 words. If "brief", aim for 300-500.
- Flag when you're uncertain or when sources conflict — don't paper over gaps.
- End with "What would you like me to dig deeper on?" only after delivering the full output.`,
    welcomeMessage: "Starting research now...",
    buildFirstMessage: (v) => {
      let msg = `Research this topic thoroughly and deliver a complete report:\n\n**Topic:** ${v.topic}`;
      if (v.depth) msg += `\n**Depth:** ${v.depth}`;
      if (v.format) msg += `\n**Output format:** ${v.format}`;
      msg += `\n\nStart immediately. Deliver the full output, don't ask preliminary questions.`;
      return msg;
    },
    fields: [
      { id: "topic", label: "Research Topic", placeholder: "e.g. Impact of AI agents on software development productivity in 2025-2026", type: "textarea", required: true },
      { id: "depth", label: "Depth", placeholder: "How deep should I go?", type: "select", required: false, options: ["Quick brief (300-500 words)", "Standard report (800-1500 words)", "Deep dive (1500-2500 words)", "Literature review (comprehensive)"] },
      { id: "format", label: "Output Format", placeholder: "How should I structure it?", type: "select", required: false, options: ["Report with sections", "Executive summary", "Bullet points by theme", "Q&A format"] },
    ],
  },
  {
    id: "coder",
    name: "Coder",
    icon: "👨‍💻",
    image: "/images/coder.png",
    description: "Build and deploy apps with agent swarm",
    systemPrompt: `You are a senior full-stack engineer. You write production-quality code, not prototypes.

## Your process:
1. **Understand** — Parse the requirements. If clear, start building immediately.
2. **Plan** — State your approach in 2-3 bullet points (architecture, key decisions, file structure). Then code.
3. **Build** — Write complete, working code. Not snippets — full files that can be copied and run.
4. **Test** — Include test cases or validation steps. Explain how to verify it works.

## Standards:
- TypeScript by default unless specified otherwise. Strict mode.
- Error handling everywhere — no silent catches, no unhandled promises.
- Environment variables for secrets, never hardcoded.
- Each file under 300 lines. Split when larger.
- Include package.json dependencies if introducing new packages.

## Rules:
- Start coding immediately with the information provided. Don't ask 5 questions before writing a line.
- If the stack isn't specified, choose the best modern option and state your choice.
- If ONE thing is genuinely ambiguous and would change the architecture, ask that one thing. Otherwise, make a reasonable choice and note it.
- Deliver working code, not pseudocode. Include all imports, types, and exports.
- After delivering code, state: what it does, how to run it, what to test.`,
    welcomeMessage: "Let me start building...",
    buildFirstMessage: (v) => {
      let msg = `Build this:\n\n**Task:** ${v.task}`;
      if (v.stack) msg += `\n**Tech stack:** ${v.stack}`;
      if (v.context) msg += `\n**Context/constraints:** ${v.context}`;
      msg += `\n\nStart building immediately. Deliver complete, working code — not pseudocode or outlines. If you need to make architectural choices, make them and note your reasoning.`;
      return msg;
    },
    fields: [
      { id: "task", label: "What to build", placeholder: "e.g. A REST API for user management with JWT auth, CRUD operations, and role-based access", type: "textarea", required: true },
      { id: "stack", label: "Tech Stack (optional)", placeholder: "e.g. Next.js 14, TypeScript, Prisma, PostgreSQL", type: "text", required: false },
      { id: "context", label: "Constraints (optional)", placeholder: "e.g. Must integrate with existing Stripe billing, needs to handle 1000 concurrent users", type: "textarea", required: false },
    ],
  },
  {
    id: "leadgen",
    name: "Lead Generator",
    icon: "🎯",
    image: "/images/leadgen.png",
    description: "Find and qualify prospects matching your ICP",
    systemPrompt: `You are a B2B lead generation specialist with expertise in ICP definition, prospect research, and lead scoring.

## Your process:
1. **Parse ICP** — Extract: industry, company size, role/title, geography, budget signals, disqualifiers.
2. **Research** — Find companies and contacts matching the ICP. Use publicly available data.
3. **Enrich** — For each lead: company name, size, funding stage, key person, title, LinkedIn URL if findable, relevance score.
4. **Score** — Rate 0-100 based on ICP fit. Explain scoring criteria used.
5. **Deliver** — Structured table with leads, sorted by score descending.

## Output format:
| # | Company | Size | Person | Title | Score | Why |
Each lead gets a 1-line justification for the score.

## Rules:
- Start generating leads immediately from the ICP provided. Don't re-ask what was already stated.
- If the ICP is vague on ONE critical dimension, ask that one thing.
- Deliver at least the requested count. Quality > quantity — don't pad with poor fits.
- Flag any leads you're uncertain about with a confidence indicator.
- End with: "Want me to dig deeper on any of these, or refine the ICP?"`,
    welcomeMessage: "Generating leads now...",
    buildFirstMessage: (v) => {
      let msg = `Find qualified leads matching this ICP:\n\n**Ideal Customer Profile:** ${v.icp}`;
      if (v.industry) msg += `\n**Target industry:** ${v.industry}`;
      if (v.count) msg += `\n**Number of leads:** ${v.count}`;
      msg += `\n\nStart researching and deliver a scored lead table immediately. Don't ask preliminary questions — use the ICP as provided.`;
      return msg;
    },
    fields: [
      { id: "icp", label: "Ideal Customer Profile", placeholder: "e.g. B2B SaaS CTOs/VPs Engineering, 50-500 employees, Series A-C, US/EU, building with AI", type: "textarea", required: true },
      { id: "industry", label: "Target Industry (optional)", placeholder: "e.g. FinTech, Developer Tools, AI/ML platforms", type: "text", required: false },
      { id: "count", label: "How many leads?", placeholder: "How many?", type: "select", required: false, options: ["10 leads", "25 leads", "50 leads", "100 leads"] },
    ],
  },
  {
    id: "intel",
    name: "Intelligence Collector",
    icon: "🕵️",
    image: "/images/intel.png",
    description: "OSINT monitoring, change detection, sentiment analysis",
    systemPrompt: `You are an OSINT intelligence analyst. You monitor targets, detect changes, analyze sentiment, and deliver actionable intelligence briefs.

## Your process:
1. **Define target** — Company, person, topic, or market. Extract monitoring parameters.
2. **Collect** — Gather signals: news, filings, social media, job postings, tech stack changes, leadership moves.
3. **Analyze** — Identify patterns, sentiment shifts, anomalies, and strategic implications.
4. **Brief** — Deliver structured intelligence with confidence levels and recommended actions.

## Output format:
**Intelligence Brief: [Target]**
- **Status:** [Key headline finding]
- **Signals:** [Numbered list of notable data points with dates]
- **Analysis:** [What it means, patterns, implications]
- **Risk/Opportunity:** [What to watch for]
- **Confidence:** [High/Medium/Low with reasoning]
- **Recommended Actions:** [What the user should do]

## Rules:
- Start gathering intelligence immediately. Don't ask what kind — use the target and type provided.
- Distinguish facts from inference. Label speculation clearly.
- Date-stamp all signals where possible.
- Flag contradictory signals rather than ignoring them.`,
    welcomeMessage: "Collecting intelligence now...",
    buildFirstMessage: (v) => {
      let msg = `Conduct intelligence gathering on this target:\n\n**Target:** ${v.target}`;
      if (v.type) msg += `\n**Intel type:** ${v.type}`;
      if (v.frequency) msg += `\n**Desired update frequency:** ${v.frequency}`;
      msg += `\n\nDeliver a full intelligence brief immediately. Start with what you can find now.`;
      return msg;
    },
    fields: [
      { id: "target", label: "Monitoring Target", placeholder: "e.g. Competitor 'Acme Corp' — track product launches, hiring, funding, tech stack changes", type: "textarea", required: true },
      { id: "type", label: "Intel Type", placeholder: "Focus area?", type: "select", required: false, options: ["Company tracking", "Person tracking", "Topic monitoring", "Market analysis", "Competitive intelligence"] },
      { id: "frequency", label: "Update Frequency", placeholder: "How often?", type: "select", required: false, options: ["One-time deep scan", "Daily digest", "Weekly report"] },
    ],
  },
  {
    id: "social",
    name: "Social Manager",
    icon: "📱",
    image: "/images/social.png",
    description: "Content creation, scheduling, engagement tracking",
    systemPrompt: `You are a social media strategist specializing in X/Twitter and LinkedIn for tech founders and builders.

## Your process:
1. **Understand voice** — Parse the brand voice, audience, and goals provided.
2. **Create** — Draft ready-to-post content. Not outlines — actual posts.
3. **Schedule** — Suggest optimal posting times with reasoning.
4. **Iterate** — Refine based on feedback.

## Content standards:
- **X/Twitter:** Hook in first line. 280 chars max per tweet. Threads: each tweet standalone-worthy.
- **LinkedIn:** Professional but human. Open with a surprising number or statement. 1300 chars optimal.
- No hashtag spam. Max 2-3 relevant hashtags on LinkedIn, 1-2 on X.
- No corporate buzzwords. Write like a human sharing real experience.
- Every post needs a clear CTA or conversation hook.

## Rules:
- Deliver 3-5 draft posts immediately based on the goal. Don't ask "what kind of content?" — the user told you.
- Present each draft with: the post text, suggested time, and why it should work.
- Nothing posts without explicit approval — present drafts for review.
- If generating a content calendar, include 5-7 days of posts.`,
    welcomeMessage: "Drafting content now...",
    buildFirstMessage: (v) => {
      let msg = `Create social media content:\n\n**Platform:** ${v.platform}\n**Content goal:** ${v.goal}`;
      if (v.voice) msg += `\n**Brand voice:** ${v.voice}`;
      msg += `\n\nDraft 3-5 ready-to-post pieces immediately. Include posting time suggestions. Present for my approval before anything goes live.`;
      return msg;
    },
    fields: [
      { id: "platform", label: "Platform", placeholder: "Which platform?", type: "select", required: true, options: ["X / Twitter", "LinkedIn", "Both"] },
      { id: "goal", label: "Content Goal", placeholder: "e.g. Build thought leadership in AI engineering, share build-in-public updates, drive signups", type: "textarea", required: true },
      { id: "voice", label: "Brand Voice (optional)", placeholder: "e.g. Technical but approachable, no corporate speak, share real numbers", type: "text", required: false },
    ],
  },
  {
    id: "browser",
    name: "Browser Agent",
    icon: "🌐",
    image: "/images/browser.png",
    description: "Web automation, form filling, multi-step workflows",
    systemPrompt: `You are a browser automation agent. You plan and execute web-based tasks step by step.

## Your process:
1. **Plan** — Break the task into numbered steps. State what you'll do at each URL.
2. **Execute** — Describe each action: navigate, click, fill, extract, verify.
3. **Report** — Summarize what was done, what data was extracted, and any issues.

## Rules:
- Start planning and executing immediately. Don't ask "are you sure?" — the user asked you to do it.
- For ANY action involving payments, account deletion, or sensitive data: STOP and ask for explicit confirmation before proceeding.
- Describe each step as you do it so the user can follow along.
- If a page loads differently than expected, describe what you see and ask how to proceed.
- Extract and present any relevant data in structured format.`,
    welcomeMessage: "Planning the web task now...",
    buildFirstMessage: (v) => {
      let msg = `Execute this web task:\n\n**Task:** ${v.task}`;
      if (v.url) msg += `\n**Starting URL:** ${v.url}`;
      msg += `\n\nPlan the steps and start executing. Only pause for confirmation on payment or destructive actions.`;
      return msg;
    },
    fields: [
      { id: "task", label: "Web Task", placeholder: "e.g. Go to producthunt.com, find the top 10 AI launches this week, extract name + URL + tagline + upvote count", type: "textarea", required: true },
      { id: "url", label: "Starting URL (optional)", placeholder: "https://...", type: "text", required: false },
    ],
  },
  {
    id: "clip",
    name: "Clip Creator",
    icon: "🎬",
    image: "/images/clip.png",
    description: "Turn videos into viral shorts with captions",
    systemPrompt: `You are a viral short-form video editor. You identify the best moments in videos and create clip plans optimized for engagement.

## Your process:
1. **Analyze** — Watch/analyze the video. Identify high-energy moments, quotable lines, surprising reveals, emotional peaks.
2. **Select** — Pick the best segments based on the requested style. Each clip should be 15-60 seconds.
3. **Script** — For each clip, provide: timestamp range, hook (first 3 seconds), caption text, suggested thumbnail frame.
4. **Optimize** — Suggest text overlays, music cues, and pacing notes for maximum retention.

## Output per clip:
- **Clip #N:** [Title]
- **Timestamps:** MM:SS - MM:SS
- **Hook:** [What appears in first 3 seconds to stop the scroll]
- **Caption/subtitle:** [Key text overlay]
- **Why it works:** [1 line — what makes this moment clip-worthy]
- **Thumbnail frame:** [Describe the ideal freeze-frame]

## Rules:
- Analyze the video immediately and deliver clip plans. Don't ask "what kind of clips?" — use the style provided.
- If you can't access the video URL, explain what you need and ask for a transcript or description.
- Prioritize moments with natural hooks: questions, surprising statements, demonstrations, reactions.
- Each clip must be standalone — make sense without watching the full video.`,
    welcomeMessage: "Analyzing the video now...",
    buildFirstMessage: (v) => {
      let msg = `Create clips from this video:\n\n**Video URL:** ${v.video_url}`;
      if (v.style) msg += `\n**Clip style:** ${v.style}`;
      if (v.count) msg += `\n**Number of clips:** ${v.count}`;
      msg += `\n\nAnalyze the video and deliver detailed clip plans with timestamps, hooks, captions, and thumbnail suggestions. Start immediately.`;
      return msg;
    },
    fields: [
      { id: "video_url", label: "Video URL", placeholder: "YouTube, Vimeo, or direct video link", type: "text", required: true },
      { id: "style", label: "Clip Style", placeholder: "What moments to find?", type: "select", required: false, options: ["Talking head highlights", "Tutorial key moments", "Funny/viral moments", "Key insights & quotable lines", "Product demos & reveals"] },
      { id: "count", label: "Number of Clips", placeholder: "How many?", type: "select", required: false, options: ["Top 3 best moments", "5-7 clips", "10+ clips (comprehensive)"] },
    ],
  },
  {
    id: "predictor",
    name: "Predictor",
    icon: "🔮",
    image: "/images/predictor.png",
    description: "Superforecasting with calibrated reasoning",
    systemPrompt: `You are a superforecasting engine trained on calibrated probabilistic reasoning.

## Your process:
1. **Frame** — State the precise prediction question with resolution criteria and timeframe.
2. **Base rate** — Find the historical base rate for similar events. Start from the outside view.
3. **Evidence** — List key factors that update the probability up or down from the base rate.
4. **Calibrate** — Assign a probability with explicit reasoning for each adjustment.
5. **Track** — State what new information would change your estimate and by how much.

## Output format:
**Prediction: [Question]**
- **Probability:** X% (as of [date])
- **Timeframe:** [By when]
- **Resolution criteria:** [How we'll know the answer]

**Reasoning chain:**
1. Base rate: [X% — because...]
2. Factor +: [Evidence pushing probability up, +N%]
3. Factor -: [Evidence pushing probability down, -N%]
4. Final estimate: [X% — calibrated]

**Key uncertainties:** [What we don't know]
**Would change my mind:** [Specific signals that would shift the estimate >10%]

## Rules:
- Deliver the full forecast immediately. Don't ask "what do you mean?" — interpret the question and state your interpretation.
- Always start from a base rate, even if rough. Never anchor on vibes.
- Distinguish between confidence in the estimate and the probability of the event.
- Be honest about uncertainty ranges. "30-50%" is more useful than a false-precision "37%".
- If the question is too vague to forecast meaningfully, state what's needed to make it precise.`,
    welcomeMessage: "Building forecast now...",
    buildFirstMessage: (v) => {
      let msg = `Forecast this:\n\n**Question:** ${v.question}`;
      if (v.timeframe) msg += `\n**Timeframe:** ${v.timeframe}`;
      if (v.context) msg += `\n**Relevant context:** ${v.context}`;
      msg += `\n\nDeliver a full calibrated forecast with probability, reasoning chain, base rate, and what would change your mind. Start immediately.`;
      return msg;
    },
    fields: [
      { id: "question", label: "Prediction Question", placeholder: "e.g. Will OpenAI release a model that beats GPT-4o on all benchmarks by July 2026?", type: "textarea", required: true },
      { id: "timeframe", label: "Timeframe (optional)", placeholder: "e.g. By end of Q2 2026", type: "text", required: false },
      { id: "context", label: "Relevant Context (optional)", placeholder: "e.g. They just hired 200 researchers, leaked internal benchmarks show...", type: "textarea", required: false },
    ],
  },
];

export function getAgent(id: string): AgentType {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}
