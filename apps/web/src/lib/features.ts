export const FEATURES = [
  "swarm",
  "terminal",
  "deploy",
  "telegram",
  "whatsapp",
  "webchat",
  "catalog",
] as const;

export type Feature = (typeof FEATURES)[number];

export function isFeature(value: string): value is Feature {
  return FEATURES.includes(value as Feature);
}
