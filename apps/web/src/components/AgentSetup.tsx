"use client";

import { useState } from "react";
import type { AgentType } from "@/lib/agents";

export type AgentWizardConfig = {
  systemPrompt: string;
  modelPreference: string;
  enabledTools: string[];
};

type Props = {
  agent: AgentType;
  initialConfig: AgentWizardConfig;
  onSave: (config: AgentWizardConfig) => void;
  onBack: () => void;
};

const QUICK_TEMPLATES: Record<string, AgentWizardConfig> = {
  "Research Mode": {
    systemPrompt:
      "You are a rigorous research assistant. Prioritize current primary sources, compare conflicting evidence, and present confidence with clear caveats.",
    modelPreference: "openai/gpt-4o",
    enabledTools: ["web_search", "web_fetch", "memory_store", "memory_recall"],
  },
  "Code Assistant": {
    systemPrompt:
      "You are a production-minded software engineer. Deliver complete implementations, explicit assumptions, and concise verification steps.",
    modelPreference: "anthropic/claude-3-5-sonnet",
    enabledTools: ["web_search", "web_fetch"],
  },
  "Social Manager": {
    systemPrompt:
      "You are a social content strategist. Draft high-signal posts with strong hooks, practical insights, and platform-native tone.",
    modelPreference: "openai/gpt-4o-mini",
    enabledTools: ["web_search", "web_fetch"],
  },
};

const TOOL_OPTIONS = ["web_search", "web_fetch", "memory_store", "memory_recall"];

export default function AgentSetup({ agent, initialConfig, onSave, onBack }: Props) {
  const [config, setConfig] = useState<AgentWizardConfig>(initialConfig);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({
      systemPrompt: config.systemPrompt.trim(),
      modelPreference: config.modelPreference.trim(),
      enabledTools: config.enabledTools,
    });
  }

  const isValid = config.systemPrompt.trim().length > 0 && config.modelPreference.trim().length > 0;

  function toggleTool(tool: string) {
    setConfig((prev) => ({
      ...prev,
      enabledTools: prev.enabledTools.includes(tool)
        ? prev.enabledTools.filter((name) => name !== tool)
        : [...prev.enabledTools, tool],
    }));
  }

  return (
    <div className="mx-auto w-full max-w-3xl rounded-2xl border border-[#25252c] bg-[#0f0f12]/95 backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[#232329] px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <p className="ml-2 text-xs uppercase tracking-[0.16em] text-gray-400">Agent Wizard</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-[#2f2f37] px-3 py-1.5 text-xs text-gray-300 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="space-y-2 px-5 pt-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{agent.icon}</span>
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{agent.name}</h2>
            <p className="text-xs text-gray-400">{agent.description}</p>
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Loaded from <code>HAND.toml</code>: system prompt, model preference, and enabled tools.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5 p-5 pt-3">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Quick Start</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(QUICK_TEMPLATES).map((label) => (
              <button
                key={label}
                type="button"
                onClick={() => setConfig(QUICK_TEMPLATES[label])}
                className="rounded-full border border-[#2d2d37] bg-[#16161d] px-3 py-1.5 text-xs text-gray-300 hover:border-[#3f3f49] hover:text-white"
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-200">System Prompt</label>
          <textarea
            value={config.systemPrompt}
            onChange={(e) => setConfig((prev) => ({ ...prev, systemPrompt: e.target.value }))}
            rows={6}
            className="w-full rounded-xl border border-[#2c2c36] bg-[#111117] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-[#3b82f6] focus:outline-none"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-200">Model Preference</label>
          <input
            type="text"
            value={config.modelPreference}
            onChange={(e) => setConfig((prev) => ({ ...prev, modelPreference: e.target.value }))}
            placeholder="e.g. openai/gpt-4o-mini"
            className="w-full rounded-xl border border-[#2c2c36] bg-[#111117] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-[#3b82f6] focus:outline-none"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-200">Enabled Tools</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {TOOL_OPTIONS.map((tool) => {
              const enabled = config.enabledTools.includes(tool);
              return (
                <label
                  key={tool}
                  className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    enabled
                      ? "border-[#2f8f5b] bg-[#102018] text-[#b8f4d2]"
                      : "border-[#2d2d37] bg-[#14141b] text-gray-300"
                  }`}
                >
                  <span className="font-mono text-xs">{tool}</span>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={() => toggleTool(tool)}
                    className="h-4 w-4 accent-[#2f8f5b]"
                  />
                </label>
              );
            })}
          </div>
        </div>

        <button
          type="submit"
          disabled={!isValid}
          className="w-full rounded-xl bg-[#2563eb] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-50"
        >
          Save Configuration
        </button>
      </form>
    </div>
  );
}
