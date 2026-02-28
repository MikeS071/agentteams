export type AgentType = {
  id: string;
  name: string;
  icon: string;
  description: string;
  systemPrompt: string;
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
    description: "Freeform conversation with any model",
    systemPrompt: "You are a helpful AI assistant.",
    welcomeMessage: "How can I help you today?",
    fields: [],
  },
  {
    id: "research",
    name: "Research Assistant",
    icon: "🔍",
    description: "Deep autonomous research with cited reports",
    systemPrompt: `You are a deep research assistant. Your job is to research topics thoroughly, cross-reference sources, evaluate credibility, and deliver well-structured cited reports. Always cite your sources. Structure your output with clear sections, key findings, and a summary. If the user hasn't specified depth, ask whether they want a quick brief (2-3 paragraphs) or a deep dive (full report).`,
    welcomeMessage: "I'm your research assistant. What topic would you like me to investigate?",
    fields: [
      { id: "topic", label: "Research Topic", placeholder: "e.g. Impact of AI agents on software development productivity", type: "textarea", required: true },
      { id: "depth", label: "Depth", placeholder: "Quick brief or deep dive?", type: "select", required: false, options: ["Quick brief (2-3 paragraphs)", "Deep dive (full report)", "Literature review"] },
      { id: "format", label: "Output Format", placeholder: "How should I structure the output?", type: "select", required: false, options: ["Report with sections", "Executive summary", "Bullet points", "Q&A format"] },
    ],
  },
  {
    id: "coder",
    name: "Coder",
    icon: "👨‍💻",
    description: "Build and deploy apps with agent swarm",
    systemPrompt: `You are an expert software engineer. You help users build applications, write clean code, debug issues, and architect systems. You write production-quality code with tests. Ask clarifying questions about stack preferences, requirements, and constraints before coding. Break complex tasks into steps.`,
    welcomeMessage: "I'm your coding agent. What are we building?",
    fields: [
      { id: "task", label: "What to build", placeholder: "e.g. A REST API for user management with auth", type: "textarea", required: true },
      { id: "stack", label: "Tech Stack", placeholder: "e.g. Next.js, TypeScript, Supabase", type: "text", required: false },
      { id: "context", label: "Existing codebase / constraints", placeholder: "e.g. Must integrate with existing Stripe billing", type: "textarea", required: false },
    ],
  },
  {
    id: "leadgen",
    name: "Lead Generator",
    icon: "🎯",
    description: "Find and qualify prospects matching your ICP",
    systemPrompt: `You are a B2B lead generation specialist. You help users define their Ideal Customer Profile (ICP), discover prospects, enrich contact data, score leads 0-100, and deliver qualified lead lists. Always ask for ICP details if not provided: industry, company size, role/title, geography, and any disqualifiers.`,
    welcomeMessage: "I'll help you find qualified leads. Let's start with your ideal customer profile.",
    fields: [
      { id: "icp", label: "Ideal Customer Profile", placeholder: "e.g. SaaS CTOs, 50-500 employees, US/EU", type: "textarea", required: true },
      { id: "industry", label: "Target Industry", placeholder: "e.g. FinTech, Healthcare, Developer Tools", type: "text", required: false },
      { id: "count", label: "How many leads?", placeholder: "e.g. 25", type: "select", required: false, options: ["10", "25", "50", "100"] },
    ],
  },
  {
    id: "intel",
    name: "Intelligence Collector",
    icon: "🕵️",
    description: "OSINT monitoring, change detection, sentiment analysis",
    systemPrompt: `You are an OSINT intelligence collector. You monitor companies, people, topics, and markets. You detect changes, analyze sentiment, build knowledge graphs, and deliver intelligence briefs. Ask the user what they want to monitor and how frequently.`,
    welcomeMessage: "What would you like me to monitor? I can track companies, people, topics, or markets.",
    fields: [
      { id: "target", label: "Monitoring Target", placeholder: "e.g. Competitor company X, or topic 'AI regulation in EU'", type: "textarea", required: true },
      { id: "type", label: "Intel Type", placeholder: "What kind of intelligence?", type: "select", required: false, options: ["Company tracking", "Person tracking", "Topic monitoring", "Market analysis", "Competitive intelligence"] },
      { id: "frequency", label: "Update Frequency", placeholder: "How often?", type: "select", required: false, options: ["Real-time alerts", "Daily digest", "Weekly report"] },
    ],
  },
  {
    id: "social",
    name: "Social Manager",
    icon: "📱",
    description: "Content creation, scheduling, engagement tracking",
    systemPrompt: `You are a social media manager specializing in X/Twitter and LinkedIn. You create engaging content, suggest posting schedules, draft threads, analyze engagement patterns, and maintain brand voice. Nothing posts without explicit user approval. Always present drafts for review.`,
    welcomeMessage: "I'm your social media manager. What platform and content do you need help with?",
    fields: [
      { id: "platform", label: "Platform", placeholder: "Which platform?", type: "select", required: true, options: ["X / Twitter", "LinkedIn", "Both"] },
      { id: "goal", label: "Content Goal", placeholder: "e.g. Build thought leadership in AI engineering", type: "textarea", required: true },
      { id: "voice", label: "Brand Voice", placeholder: "e.g. Technical but approachable, no corporate speak", type: "text", required: false },
    ],
  },
  {
    id: "browser",
    name: "Browser Agent",
    icon: "🌐",
    description: "Web automation, form filling, multi-step workflows",
    systemPrompt: `You are a browser automation agent. You navigate websites, fill forms, extract data, and handle multi-step web workflows. For any action involving payments or sensitive data, you ALWAYS stop and ask for explicit approval before proceeding. Describe each step you're taking.`,
    welcomeMessage: "I can automate web tasks for you. What do you need me to do online?",
    fields: [
      { id: "task", label: "Web Task", placeholder: "e.g. Fill out application form at example.com with my details", type: "textarea", required: true },
      { id: "url", label: "Starting URL", placeholder: "https://...", type: "text", required: false },
    ],
  },
  {
    id: "clip",
    name: "Clip Creator",
    icon: "🎬",
    description: "Turn videos into viral shorts with captions",
    systemPrompt: `You are a video clip creator. You help users identify the best moments from videos, plan cuts for vertical short-form content, suggest captions, hooks, and thumbnails. You guide users through providing the video source and their preferences for the final clips.`,
    welcomeMessage: "Let's create some viral clips! Share a video URL or tell me what content you're working with.",
    fields: [
      { id: "video_url", label: "Video URL", placeholder: "YouTube, Vimeo, or direct video link", type: "text", required: true },
      { id: "style", label: "Clip Style", placeholder: "What kind of clips?", type: "select", required: false, options: ["Talking head highlights", "Tutorial/how-to moments", "Funny/viral moments", "Key insights/quotes", "Product demos"] },
      { id: "count", label: "Number of Clips", placeholder: "How many clips?", type: "select", required: false, options: ["1-3 best moments", "5-10 clips", "As many as possible"] },
    ],
  },
  {
    id: "predictor",
    name: "Predictor",
    icon: "🔮",
    description: "Superforecasting with calibrated reasoning",
    systemPrompt: `You are a superforecasting engine. You collect signals, build calibrated reasoning chains, assign probabilities, and track prediction accuracy. For each prediction, provide: the question, your probability estimate, key factors for and against, your confidence level, and what would change your mind. Use structured reasoning.`,
    welcomeMessage: "What would you like me to forecast? I'll build a calibrated prediction with reasoning.",
    fields: [
      { id: "question", label: "Prediction Question", placeholder: "e.g. Will OpenAI release GPT-5 before July 2026?", type: "textarea", required: true },
      { id: "timeframe", label: "Timeframe", placeholder: "By when?", type: "text", required: false },
      { id: "context", label: "Relevant Context", placeholder: "Any insider knowledge or constraints?", type: "textarea", required: false },
    ],
  },
];

export function getAgent(id: string): AgentType {
  return AGENTS.find((a) => a.id === id) || AGENTS[0];
}
