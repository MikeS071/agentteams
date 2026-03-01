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
    systemPrompt:
      "You are a helpful AI assistant. Be concise and direct. If a request is clear, execute immediately. Ask clarifying questions only when truly needed.",
    welcomeMessage: "How can I help you today?",
    buildFirstMessage: () => "",
    fields: [],
  },
  {
    id: "research",
    name: "Research Assistant",
    icon: "🔍",
    image: "/images/research.png",
    description: "Deep multi-source research with clear citations",
    systemPrompt:
      "You are a rigorous research assistant. Prioritize current primary sources, present competing evidence, and clearly label uncertainty.",
    welcomeMessage: "Launching research workflow...",
    buildFirstMessage: (v) => {
      let msg = `Research this topic thoroughly:\n\n${v.topic}`;
      if (v.depth) msg += `\n\nDepth: ${v.depth}`;
      if (v.format) msg += `\nPreferred format: ${v.format}`;
      if (v.audience) msg += `\nAudience: ${v.audience}`;
      if (v.sources) msg += `\nSource priorities: ${v.sources}`;
      return msg;
    },
    fields: [
      {
        id: "topic",
        label: "Research Topic",
        placeholder: "e.g. AI coding agents in enterprise engineering teams",
        type: "textarea",
        required: true,
      },
      {
        id: "depth",
        label: "Depth",
        placeholder: "How deep?",
        type: "select",
        required: false,
        options: ["Quick brief", "Standard report", "Deep dive"],
      },
      {
        id: "format",
        label: "Output Variation",
        placeholder: "Any format preference?",
        type: "select",
        required: false,
        options: ["Structured report", "Head-to-head comparison", "Thematic analysis"],
      },
      {
        id: "audience",
        label: "Target Audience (optional)",
        placeholder: "e.g. Technical leadership, investors",
        type: "text",
        required: false,
      },
      {
        id: "sources",
        label: "Source Priorities (optional)",
        placeholder: "e.g. Prefer papers and filings over commentary",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "coder",
    name: "Coder",
    icon: "👨‍💻",
    image: "/images/coder.png",
    description: "Build and ship software with production standards",
    systemPrompt:
      "You are a senior software engineer. Deliver concrete implementations, explicit assumptions, and concise verification steps.",
    welcomeMessage: "Ready to build.",
    buildFirstMessage: (v) => {
      let msg = `Build this:\n\nTask: ${v.task}`;
      if (v.stack) msg += `\nStack: ${v.stack}`;
      if (v.context) msg += `\nConstraints: ${v.context}`;
      return msg;
    },
    fields: [
      {
        id: "task",
        label: "What to build",
        placeholder: "e.g. REST API with auth, CRUD, and RBAC",
        type: "textarea",
        required: true,
      },
      {
        id: "stack",
        label: "Tech Stack (optional)",
        placeholder: "e.g. Next.js, TypeScript, PostgreSQL",
        type: "text",
        required: false,
      },
      {
        id: "context",
        label: "Constraints (optional)",
        placeholder: "e.g. Must integrate with Stripe billing",
        type: "textarea",
        required: false,
      },
    ],
  },
  {
    id: "intel",
    name: "Intelligence Collector",
    icon: "🕵️",
    image: "/images/intel.png",
    description: "Monitor targets and summarize high-signal changes",
    systemPrompt:
      "You are an intelligence analyst. Date-stamp key signals, separate fact from inference, and provide actionable recommendations.",
    welcomeMessage: "Collecting intel now...",
    buildFirstMessage: (v) => {
      let msg = `Run intelligence collection on:\n\nTarget: ${v.target}`;
      if (v.type) msg += `\nIntel type: ${v.type}`;
      if (v.frequency) msg += `\nFrequency: ${v.frequency}`;
      return msg;
    },
    fields: [
      {
        id: "target",
        label: "Monitoring Target",
        placeholder: "e.g. Competitor product launches and hiring signals",
        type: "textarea",
        required: true,
      },
      {
        id: "type",
        label: "Intel Type",
        placeholder: "Focus area?",
        type: "select",
        required: false,
        options: ["Company tracking", "Person tracking", "Topic monitoring", "Market analysis"],
      },
      {
        id: "frequency",
        label: "Update Frequency",
        placeholder: "How often?",
        type: "select",
        required: false,
        options: ["One-time scan", "Daily digest", "Weekly report"],
      },
    ],
  },
  {
    id: "social",
    name: "Social Manager",
    icon: "📱",
    image: "/images/social.png",
    description: "Draft, schedule, and optimize social content",
    systemPrompt:
      "You are a social strategist. Produce practical, platform-native drafts and clear scheduling recommendations.",
    welcomeMessage: "Drafting content now...",
    buildFirstMessage: (v) => {
      let msg = `Create social content:\n\nPlatform: ${v.platform}\nGoal: ${v.goal}`;
      if (v.voice) msg += `\nBrand voice: ${v.voice}`;
      return msg;
    },
    fields: [
      {
        id: "platform",
        label: "Platform",
        placeholder: "Which platform?",
        type: "select",
        required: true,
        options: ["X / Twitter", "LinkedIn", "Both"],
      },
      {
        id: "goal",
        label: "Content Goal",
        placeholder: "e.g. Thought leadership on AI engineering",
        type: "textarea",
        required: true,
      },
      {
        id: "voice",
        label: "Brand Voice (optional)",
        placeholder: "e.g. Technical and direct",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "clip",
    name: "Clip Creator",
    icon: "🎬",
    image: "/images/clip.png",
    description: "Turn long-form videos into short high-impact clips",
    systemPrompt:
      "You are a short-form video editor. Identify strong hooks, propose clip segments, and provide clear export-ready recommendations.",
    welcomeMessage: "Analyzing source media...",
    buildFirstMessage: (v) => {
      let msg = `Create clips from:\n\nVideo URL: ${v.video_url}`;
      if (v.style) msg += `\nClip style: ${v.style}`;
      if (v.count) msg += `\nClip count: ${v.count}`;
      return msg;
    },
    fields: [
      {
        id: "video_url",
        label: "Video URL",
        placeholder: "YouTube, Vimeo, or direct video link",
        type: "text",
        required: true,
      },
      {
        id: "style",
        label: "Clip Style",
        placeholder: "What moments to prioritize?",
        type: "select",
        required: false,
        options: ["Talking head highlights", "Tutorial key moments", "Funny moments", "Product demos"],
      },
      {
        id: "count",
        label: "Number of Clips",
        placeholder: "How many?",
        type: "select",
        required: false,
        options: ["Top 3", "5-7 clips", "10+ clips"],
      },
    ],
  },
];

export function getAgent(id: string): AgentType {
  return AGENTS.find((agent) => agent.id === id) ?? AGENTS[0];
}
