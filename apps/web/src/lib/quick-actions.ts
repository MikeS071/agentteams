export type QuickActionField = {
  id: string;
  label: string;
  placeholder: string;
  type: "text" | "textarea" | "select";
  required: boolean;
  options?: string[];
};

export type QuickAction = {
  id: string;
  label: string;
  icon?: string;
  fields: QuickActionField[];
  promptTemplate: string;
};

export const QUICK_ACTIONS: Record<string, QuickAction[]> = {
  research: [],
  coder: [
    {
      id: "new-project",
      label: "Project",
      icon: "📦",
      fields: [
        {
          id: "project_name",
          label: "Project Name",
          placeholder: "e.g. my-api-service",
          type: "text",
          required: true,
        },
        {
          id: "project_type",
          label: "Type",
          placeholder: "What kind?",
          type: "select",
          required: true,
          options: ["SKILL", "FEATURE", "WEBAPP", "LANDING_PAGE", "CLI_TOOL", "API_SERVICE", "LIBRARY"],
        },
        {
          id: "goal",
          label: "Goal",
          placeholder: "e.g. Build a REST API for user management",
          type: "textarea",
          required: true,
        },
        {
          id: "description",
          label: "Description",
          placeholder: "Detailed description of what you want built",
          type: "textarea",
          required: true,
        },
        {
          id: "requirements",
          label: "Requirements",
          placeholder: "e.g. Must support JWT auth, PostgreSQL, rate limiting",
          type: "textarea",
          required: false,
        },
      ],
      promptTemplate: `Spec out a new project {{project_name}} which we'll build using agent-swarm. This is a new {{project_type}}.
Requirements are:
GOAL: {{goal}}
DESCRIPTION: {{description}}
REQUIREMENTS: {{requirements}}
INSTRUCTIONS:
Create a new project directory, create the spec, ask me any clarifying questions one-by-one to improve the spec and remove ambiguous areas. Be detailed and present examples for me to decide on design options or direction.
Once a spec is done, ask me to approve to proceed to create a detailed execution plan, and then break this down into small 5-10min tickets that can be built by the swarm agents. Register the project/tickets into the swarm project/register.
Ensure each ticket/agent follow TDD principles (create failing tests matching functional specs, then build, then test, then break-fix). Include a ticket to, once all tickets are built, to merge all branches before a final audit and integration tests are run.
{{#project_type_is_skill}}For SKILL projects: use go cli as implementation. Include SKILL.MD and splice appropriate instructions into MEMORY.md, TOOLS.md and AGENTS.md so they can be appended to a new OpenClaw instance environment.{{/project_type_is_skill}}
Include at the end:
- Merge of all the worktrees/branches and resolve conflicts
- Execute End to end comprehensive integration and functional test suite
- Update all relevant user and technical doco

Lastly, ask me to approve to proceed to build.`,
    },
    {
      id: "new-webpage",
      label: "Web Page",
      icon: "🌐",
      fields: [
        {
          id: "page_name",
          label: "Page Name",
          placeholder: "e.g. pricing-page",
          type: "text",
          required: true,
        },
        {
          id: "goal",
          label: "Goal",
          placeholder: "e.g. A pricing page with 3 tiers and Stripe checkout",
          type: "textarea",
          required: true,
        },
        {
          id: "description",
          label: "Description",
          placeholder: "Layout, sections, style preferences",
          type: "textarea",
          required: true,
        },
        {
          id: "requirements",
          label: "Requirements",
          placeholder: "e.g. Responsive, dark theme, animations",
          type: "textarea",
          required: false,
        },
      ],
      promptTemplate: `Spec out a new project {{page_name}} which we'll build using agent-swarm. This is a new LANDING_PAGE.
Requirements are:
GOAL: {{goal}}
DESCRIPTION: {{description}}
REQUIREMENTS: {{requirements}}
INSTRUCTIONS:
Create a new project directory, create the spec, ask me any clarifying questions one-by-one to improve the spec and remove ambiguous areas. Be detailed and present examples for me to decide on design options or direction.
Once a spec is done, ask me to approve to proceed to create a detailed execution plan, and then break this down into small 5-10min tickets that can be built by the swarm agents. Register the project/tickets into the swarm project/register.
Ensure each ticket/agent follow TDD principles (create failing tests matching functional specs, then build, then test, then break-fix).
Include at the end:
- Merge of all the worktrees/branches and resolve conflicts
- Execute End to end comprehensive integration and functional test suite
- Update all relevant user and technical doco

Lastly, ask me to approve to proceed to build.`,
    },
  ],
  social: [
    {
      id: "article",
      label: "Article",
      icon: "📝",
      fields: [
        {
          id: "title",
          label: "Title / Topic",
          placeholder: "e.g. Why agent swarms are the future of solo development",
          type: "text",
          required: true,
        },
        {
          id: "description",
          label: "Description / Angle",
          placeholder: "What's the key insight or angle?",
          type: "textarea",
          required: true,
        },
        {
          id: "audience",
          label: "Target Audience",
          placeholder: "e.g. Technical founders, AI engineers",
          type: "text",
          required: false,
        },
        {
          id: "tone",
          label: "Tone",
          placeholder: "Style?",
          type: "select",
          required: false,
          options: ["Technical deep-dive", "Narrative / storytelling", "Tutorial / how-to", "Opinion / thought leadership"],
        },
      ],
      promptTemplate: `Use ContentAI to create a new article.

Topic: {{title}}
Angle: {{description}}
{{#audience}}Audience: {{audience}}{{/audience}}
{{#tone}}Tone: {{tone}}{{/tone}}

Start the ContentAI pipeline: idea → outline → draft → QA. Present the draft for my approval before publishing.`,
    },
    {
      id: "social-post",
      label: "Social Post",
      icon: "📣",
      fields: [
        {
          id: "platform",
          label: "Platform",
          type: "select",
          required: true,
          options: ["X / Twitter", "LinkedIn", "Both"],
          placeholder: "",
        },
        {
          id: "topic",
          label: "Topic / Message",
          placeholder: "What do you want to post about?",
          type: "textarea",
          required: true,
        },
        {
          id: "link",
          label: "Link to include (optional)",
          placeholder: "https://...",
          type: "text",
          required: false,
        },
      ],
      promptTemplate: `Use ContentAI to draft a social post.

Platform: {{platform}}
Topic: {{topic}}
{{#link}}Link: {{link}}{{/link}}

Draft the post, show me for approval. Do not post without my explicit approval.`,
    },
    {
      id: "reel",
      label: "Reel",
      icon: "🎬",
      fields: [
        {
          id: "topic",
          label: "Topic",
          placeholder: "What's the reel about?",
          type: "textarea",
          required: true,
        },
        {
          id: "duration",
          label: "Duration",
          type: "select",
          required: false,
          options: ["15 seconds", "30 seconds", "60 seconds", "90 seconds"],
          placeholder: "",
        },
        {
          id: "style",
          label: "Style",
          type: "select",
          required: false,
          options: ["Talking head + captions", "Screen recording + voiceover", "Slideshow + music", "Mixed"],
          placeholder: "",
        },
      ],
      promptTemplate: `Plan a short-form video reel.

Topic: {{topic}}
{{#duration}}Duration: {{duration}}{{/duration}}
{{#style}}Style: {{style}}{{/style}}

Create a script with scenes, captions, and timing. Present for my review.`,
    },
    {
      id: "carousel",
      label: "Carousel",
      icon: "🎠",
      fields: [
        {
          id: "topic",
          label: "Topic",
          placeholder: "What's the carousel about?",
          type: "textarea",
          required: true,
        },
        {
          id: "slides",
          label: "Number of slides",
          type: "select",
          required: false,
          options: ["5 slides", "7 slides", "10 slides"],
          placeholder: "",
        },
        {
          id: "platform",
          label: "Platform",
          type: "select",
          required: true,
          options: ["LinkedIn", "Instagram", "Both"],
          placeholder: "",
        },
      ],
      promptTemplate: `Create a carousel post.

Topic: {{topic}}
Platform: {{platform}}
{{#slides}}Slides: {{slides}}{{/slides}}

Write the text for each slide with a hook on slide 1 and CTA on the last slide. Present for my review.`,
    },
  ],
  clip: [
    {
      id: "youtube-clip",
      label: "Youtube Clip",
      icon: "🎥",
      fields: [
        { id: "source", label: "Source Video URL", placeholder: "https://youtube.com/watch?v=...", type: "text", required: true },
        {
          id: "topic",
          label: "Clip Topic / Moment",
          placeholder: "e.g. The part where they discuss agent memory architectures",
          type: "textarea",
          required: true,
        },
        {
          id: "duration",
          label: "Target Duration",
          type: "select",
          required: false,
          options: ["15 seconds", "30 seconds", "60 seconds", "90 seconds", "Auto (best moment)"],
          placeholder: "",
        },
        {
          id: "format",
          label: "Output Format",
          type: "select",
          required: false,
          options: ["MP4 (16:9)", "MP4 (9:16 vertical)", "GIF", "MP4 with captions"],
          placeholder: "",
        },
      ],
      promptTemplate: `Create a clip from this YouTube video.

Source: {{source}}
Topic/Moment: {{topic}}
{{#duration}}Duration: {{duration}}{{/duration}}
{{#format}}Format: {{format}}{{/format}}

Find the relevant segment, extract it, and prepare the clip. Show me a preview before finalizing.`,
    },
  ],
  intel: [],
  chat: [],
};
