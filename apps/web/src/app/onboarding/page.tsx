"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AGENTS, getAgent, type AgentType } from "@/lib/agents";

type UseCase = "research" | "coding" | "marketing" | "general";
type Model = { id: string; name: string; provider: string };

const TOTAL_STEPS = 5;

const USE_CASES: Array<{ id: UseCase; label: string; description: string }> = [
  { id: "research", label: "Research", description: "Deep analysis, reports, and evidence gathering." },
  { id: "coding", label: "Coding", description: "Build features, debug issues, and ship software." },
  { id: "marketing", label: "Marketing", description: "Generate leads, campaigns, and social content." },
  { id: "general", label: "General", description: "Everyday brainstorming and execution tasks." },
];

const RECOMMENDATIONS: Record<UseCase, string[]> = {
  research: ["research", "intel", "chat"],
  coding: ["coder", "research", "chat"],
  marketing: ["leadgen", "social", "intel"],
  general: ["chat", "research", "coder"],
};

const FALLBACK_MODEL = "openai/gpt-4o-mini";

function orderedAgentPool(useCase: UseCase): AgentType[] {
  const recommended = RECOMMENDATIONS[useCase];
  const recSet = new Set(recommended);
  const recommendedAgents = recommended
    .map((id) => AGENTS.find((agent) => agent.id === id))
    .filter((agent): agent is AgentType => Boolean(agent));
  const rest = AGENTS.filter((agent) => !recSet.has(agent.id));
  return [...recommendedAgents, ...rest];
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(true);
  const [useCase, setUseCase] = useState<UseCase>("general");
  const [selectedAgents, setSelectedAgents] = useState<string[]>(RECOMMENDATIONS.general.slice(0, 2));
  const [primaryAgentId, setPrimaryAgentId] = useState<string>(RECOMMENDATIONS.general[0]);
  const [agentName, setAgentName] = useState("My Agent");
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState(FALLBACK_MODEL);
  const [systemPrompt, setSystemPrompt] = useState(getAgent(RECOMMENDATIONS.general[0]).systemPrompt);
  const [firstMessage, setFirstMessage] = useState("Help me plan my first project with this agent.");
  const [assistantReply, setAssistantReply] = useState("");
  const [sendLoading, setSendLoading] = useState(false);
  const [completeLoading, setCompleteLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recommendedIds = RECOMMENDATIONS[useCase];

  const pool = useMemo(() => orderedAgentPool(useCase), [useCase]);

  const primaryAgent = useMemo(() => getAgent(primaryAgentId), [primaryAgentId]);

  const progressPercent = Math.round(((step + 1) / TOTAL_STEPS) * 100);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [statusRes, modelRes] = await Promise.all([
          fetch("/api/onboarding", { cache: "no-store" }),
          fetch("/api/models", { cache: "no-store" }),
        ]);

        if (!statusRes.ok || !modelRes.ok) {
          throw new Error("Failed to load onboarding setup.");
        }

        const statusData = (await statusRes.json()) as { onboardingCompleted?: boolean };
        if (statusData.onboardingCompleted) {
          router.replace("/dashboard");
          return;
        }

        const modelData = (await modelRes.json()) as { models?: Model[] };
        if (!active) {
          return;
        }
        const nextModels = Array.isArray(modelData.models) ? modelData.models : [];
        setModels(nextModels);
        if (nextModels.length > 0) {
          setModelId((current) =>
            nextModels.some((model) => model.id === current) ? current : nextModels[0].id
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load onboarding.");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    if (!selectedAgents.includes(primaryAgentId)) {
      const fallback = selectedAgents[0] ?? recommendedIds[0] ?? "chat";
      setPrimaryAgentId(fallback);
      setSystemPrompt(getAgent(fallback).systemPrompt);
      setAgentName(`${getAgent(fallback).name} Hand`);
    }
  }, [primaryAgentId, recommendedIds, selectedAgents]);

  useEffect(() => {
    if (step !== 4) {
      return;
    }
    const timer = window.setTimeout(() => {
      router.push("/dashboard");
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [router, step]);

  const canContinueFromStep2 = selectedAgents.length >= 1 && selectedAgents.length <= 3;

  function nextStep() {
    setError(null);
    setStep((current) => Math.min(current + 1, TOTAL_STEPS - 1));
  }

  function prevStep() {
    setError(null);
    setStep((current) => Math.max(current - 1, 0));
  }

  function handleAgentToggle(agentId: string) {
    setError(null);
    setSelectedAgents((current) => {
      if (current.includes(agentId)) {
        if (current.length === 1) {
          return current;
        }
        return current.filter((id) => id !== agentId);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, agentId];
    });
  }

  function handleUseCaseSelect(nextUseCase: UseCase) {
    setUseCase(nextUseCase);
    const recommended = RECOMMENDATIONS[nextUseCase].filter((id) => AGENTS.some((agent) => agent.id === id));
    const nextSelected = recommended.slice(0, 2);
    setSelectedAgents(nextSelected);
    const nextPrimary = nextSelected[0] ?? "chat";
    const nextAgent = getAgent(nextPrimary);
    setPrimaryAgentId(nextPrimary);
    setAgentName(`${nextAgent.name} Hand`);
    setSystemPrompt(nextAgent.systemPrompt);
  }

  async function sendTestMessage() {
    const message = firstMessage.trim();
    if (!message) {
      setError("Enter a test message first.");
      return;
    }

    setError(null);
    setAssistantReply("");
    setSendLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          model: modelId,
          agentId: primaryAgentId,
          systemPrompt,
          stream: false,
        }),
      });

      const data = (await response.json()) as {
        error?: string;
        message?: { content?: string };
      };

      if (!response.ok) {
        throw new Error(data.error || "Failed to send test message.");
      }

      setAssistantReply(data.message?.content?.trim() || "Agent responded successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message.");
    } finally {
      setSendLoading(false);
    }
  }

  async function completeOnboarding() {
    setError(null);
    setCompleteLoading(true);
    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!response.ok) {
        const data = (await response.json()) as { error?: string };
        throw new Error(data.error || "Failed to finish onboarding.");
      }
      nextStep();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding.");
    } finally {
      setCompleteLoading(false);
    }
  }

  function handleSkip() {
    setError(null);

    if (step === 0) {
      nextStep();
      return;
    }

    if (step === 1) {
      if (selectedAgents.length === 0) {
        const fallback = RECOMMENDATIONS[useCase].slice(0, 2);
        setSelectedAgents(fallback);
        setPrimaryAgentId(fallback[0] ?? "chat");
      }
      nextStep();
      return;
    }

    if (step === 2) {
      nextStep();
      return;
    }

    if (step === 3) {
      void completeOnboarding();
      return;
    }

    router.push("/dashboard");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0f] text-gray-300">
        Loading onboarding...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] px-4 py-8 text-gray-100 sm:px-6">
      <div className="mx-auto w-full max-w-4xl rounded-2xl border border-[#1d1d2c] bg-[#0f0f17] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.02)] sm:p-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-gray-500">Onboarding</p>
            <h1 className="mt-1 text-2xl font-semibold">Set up your first Hand</h1>
          </div>
          <button
            type="button"
            onClick={handleSkip}
            disabled={completeLoading}
            className="rounded-lg border border-[#2a2a38] px-3 py-1.5 text-sm text-gray-300 transition hover:border-[#3f3f55] hover:text-white disabled:opacity-60"
          >
            Skip
          </button>
        </div>

        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, idx) => (
              <span
                key={idx}
                className={`h-2 w-2 rounded-full transition-all duration-300 ${
                  idx <= step ? "bg-[#3b82f6]" : "bg-[#2b2b3a]"
                }`}
              />
            ))}
            <span className="ml-auto text-xs text-gray-500">
              Step {step + 1} of {TOTAL_STEPS}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#1d1d2c]">
            <div
              className="h-full bg-gradient-to-r from-[#2563eb] to-[#22c55e] transition-all duration-500"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        <div className="relative min-h-[360px]">
          <div
            key={step}
            className="space-y-4 opacity-100 translate-y-0 transition-all duration-300 ease-out"
          >
            {step === 0 && (
              <section className="space-y-4">
                <h2 className="text-xl font-semibold">Welcome. What do you want to build?</h2>
                <p className="text-sm text-gray-400">Choose the main use case and we will recommend the best starter agents.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {USE_CASES.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleUseCaseSelect(item.id)}
                      className={`rounded-xl border px-4 py-4 text-left transition ${
                        useCase === item.id
                          ? "border-[#3b82f6] bg-[#121c32]"
                          : "border-[#242437] bg-[#11111b] hover:border-[#3a3a52]"
                      }`}
                    >
                      <p className="font-medium">{item.label}</p>
                      <p className="mt-1 text-sm text-gray-400">{item.description}</p>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {step === 1 && (
              <section className="space-y-4">
                <h2 className="text-xl font-semibold">Choose 1-3 agents</h2>
                <p className="text-sm text-gray-400">Recommended agents are highlighted based on your selected use case.</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {pool.map((agent) => {
                    const selected = selectedAgents.includes(agent.id);
                    const recommended = recommendedIds.includes(agent.id);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        onClick={() => handleAgentToggle(agent.id)}
                        className={`rounded-xl border px-4 py-4 text-left transition ${
                          selected
                            ? "border-[#22c55e] bg-[#0f2018]"
                            : recommended
                              ? "border-[#3b82f6] bg-[#10182c]"
                              : "border-[#242437] bg-[#11111b] hover:border-[#3a3a52]"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-medium">{agent.icon} {agent.name}</p>
                          {recommended ? <span className="rounded-full bg-[#1f3356] px-2 py-0.5 text-xs text-[#93c5fd]">Recommended</span> : null}
                        </div>
                        <p className="mt-1 text-sm text-gray-400">{agent.description}</p>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-gray-500">Selected: {selectedAgents.length} / 3</p>
              </section>
            )}

            {step === 2 && (
              <section className="space-y-4">
                <h2 className="text-xl font-semibold">Configure your primary agent</h2>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1">
                    <span className="text-sm text-gray-300">Primary agent</span>
                    <select
                      value={primaryAgentId}
                      onChange={(event) => {
                        const nextId = event.target.value;
                        const next = getAgent(nextId);
                        setPrimaryAgentId(nextId);
                        setSystemPrompt(next.systemPrompt);
                        setAgentName(`${next.name} Hand`);
                      }}
                      className="w-full rounded-lg border border-[#2a2a38] bg-[#0d0d14] px-3 py-2 text-sm"
                    >
                      {selectedAgents.map((id) => {
                        const agent = getAgent(id);
                        return (
                          <option key={id} value={id}>
                            {agent.icon} {agent.name}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-sm text-gray-300">Hand name</span>
                    <input
                      value={agentName}
                      onChange={(event) => setAgentName(event.target.value)}
                      className="w-full rounded-lg border border-[#2a2a38] bg-[#0d0d14] px-3 py-2 text-sm"
                      placeholder="My Agent Hand"
                    />
                  </label>
                </div>

                <label className="space-y-1">
                  <span className="text-sm text-gray-300">Model</span>
                  <select
                    value={modelId}
                    onChange={(event) => setModelId(event.target.value)}
                    className="w-full rounded-lg border border-[#2a2a38] bg-[#0d0d14] px-3 py-2 text-sm"
                  >
                    {(models.length > 0 ? models : [{ id: FALLBACK_MODEL, name: "GPT-4o Mini", provider: "openai" }]).map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.provider} · {model.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-sm text-gray-300">System prompt</span>
                  <textarea
                    value={systemPrompt}
                    onChange={(event) => setSystemPrompt(event.target.value)}
                    rows={6}
                    className="w-full rounded-lg border border-[#2a2a38] bg-[#0d0d14] px-3 py-2 text-sm"
                  />
                </label>
              </section>
            )}

            {step === 3 && (
              <section className="space-y-4">
                <h2 className="text-xl font-semibold">Send your first test message</h2>
                <p className="text-sm text-gray-400">
                  You are chatting with <span className="font-medium text-gray-200">{primaryAgent.icon} {agentName || primaryAgent.name}</span> using <span className="font-mono text-gray-200">{modelId}</span>.
                </p>
                <textarea
                  value={firstMessage}
                  onChange={(event) => setFirstMessage(event.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-[#2a2a38] bg-[#0d0d14] px-3 py-2 text-sm"
                  placeholder="Type your first prompt..."
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void sendTestMessage()}
                    disabled={sendLoading}
                    className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1d4ed8] disabled:opacity-60"
                  >
                    {sendLoading ? "Sending..." : "Send Test Message"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void completeOnboarding()}
                    disabled={completeLoading}
                    className="rounded-lg bg-[#16a34a] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#15803d] disabled:opacity-60"
                  >
                    {completeLoading ? "Finishing..." : "Finish Onboarding"}
                  </button>
                </div>
                {assistantReply ? (
                  <div className="rounded-xl border border-[#234437] bg-[#0c1d16] p-4">
                    <p className="mb-2 text-xs uppercase tracking-wide text-[#86efac]">Agent Reply</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-100">{assistantReply}</p>
                  </div>
                ) : null}
              </section>
            )}

            {step === 4 && (
              <section className="space-y-4">
                <h2 className="text-2xl font-semibold text-[#86efac]">Your agent is ready</h2>
                <p className="text-sm text-gray-300">
                  Setup complete. Redirecting you to dashboard...
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/dashboard")}
                  className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1d4ed8]"
                >
                  Go to Dashboard
                </button>
              </section>
            )}
          </div>
        </div>

        {error ? <p className="mt-4 text-sm text-red-400">{error}</p> : null}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={prevStep}
            disabled={step === 0 || completeLoading}
            className="rounded-lg border border-[#2a2a38] px-4 py-2 text-sm text-gray-300 transition hover:border-[#3f3f55] hover:text-white disabled:opacity-50"
          >
            Back
          </button>
          {step < 3 && (
            <button
              type="button"
              onClick={nextStep}
              disabled={(step === 1 && !canContinueFromStep2) || completeLoading}
              className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#1d4ed8] disabled:opacity-50"
            >
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
