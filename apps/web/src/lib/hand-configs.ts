import { promises as fs } from "fs";
import path from "path";

export type HandConfig = {
  id: string;
  name: string;
  systemPrompt: string;
  modelPreference: string;
  enabledTools: string[];
};

type RawValue = string | string[];

const DEFAULT_MODEL = "openai/gpt-4o-mini";
const DEFAULT_TOOLS = ["web_search", "web_fetch"];

let cachedConfigs: Record<string, HandConfig> | null = null;

function parseTomlValue(raw: string): RawValue {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const entries: string[] = [];
    const re = /"([^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(value)) !== null) {
      entries.push(match[1]);
    }
    return entries;
  }
  if (value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

function parseHandToml(content: string): Record<string, RawValue> {
  const parsed: Record<string, RawValue> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const idx = trimmed.indexOf("=");
    if (idx <= 0) {
      continue;
    }
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    parsed[key] = parseTomlValue(value);
  }
  return parsed;
}

function toHandConfig(parsed: Record<string, RawValue>): HandConfig | null {
  const id = typeof parsed.id === "string" ? parsed.id : "";
  if (!id) {
    return null;
  }

  return {
    id,
    name: typeof parsed.name === "string" ? parsed.name : id,
    systemPrompt: typeof parsed.system_prompt === "string" ? parsed.system_prompt : "",
    modelPreference: typeof parsed.model_preference === "string" ? parsed.model_preference : DEFAULT_MODEL,
    enabledTools: Array.isArray(parsed.enabled_tools)
      ? parsed.enabled_tools
      : DEFAULT_TOOLS,
  };
}

async function readHandConfigFile(filePath: string): Promise<HandConfig | null> {
  const source = await fs.readFile(filePath, "utf8");
  const parsed = parseHandToml(source);
  return toHandConfig(parsed);
}

export async function loadHandConfigs(): Promise<Record<string, HandConfig>> {
  if (cachedConfigs) {
    return cachedConfigs;
  }

  const baseDir = path.join(process.cwd(), "data", "hands");
  const result: Record<string, HandConfig> = {};

  try {
    const handDirs = await fs.readdir(baseDir, { withFileTypes: true });
    for (const dirent of handDirs) {
      if (!dirent.isDirectory()) {
        continue;
      }
      const configPath = path.join(baseDir, dirent.name, "HAND.toml");
      try {
        const config = await readHandConfigFile(configPath);
        if (config) {
          result[config.id] = config;
        }
      } catch {
        // Ignore malformed or missing hand files and continue loading others.
      }
    }
  } catch {
    cachedConfigs = {};
    return cachedConfigs;
  }

  cachedConfigs = result;
  return result;
}

export async function getHandConfig(agentId: string): Promise<HandConfig | null> {
  const all = await loadHandConfigs();
  return all[agentId] ?? null;
}
