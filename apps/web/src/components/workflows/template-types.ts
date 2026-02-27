export type WorkflowStepType = "action" | "confirm" | "condition";

export type WorkflowTemplateStep = {
  name: string;
  type: WorkflowStepType;
  description: string;
  actionCommand: string;
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  isStarter: boolean;
  steps: WorkflowTemplateStep[];
};
