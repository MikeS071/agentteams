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
  research: [], // as-26
  coder: [], // as-27
  social: [], // as-28
  clip: [], // as-29
  intel: [],
  chat: [],
};
