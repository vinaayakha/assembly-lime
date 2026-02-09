export type AgentProviderId = "codex" | "claude";
export type AgentMode = "plan" | "implement" | "bugfix" | "review";

export type AgentRunRequest = {
  runId: string;
  tenantId: string;
  projectId?: string;
  ticketId?: string;
  mode: AgentMode;
  prompt: string;
  repo?: {
    repositoryId: string;
    cloneUrl: string;
    defaultBranch: string;
    ref?: string;
    allowedPaths?: string[];
  };
  constraints?: {
    timeBudgetSec?: number;
    maxCostCents?: number;
    allowedTools?: string[];
  };
};

export type AgentEvent =
  | { type: "message"; role: "system" | "assistant" | "tool"; text: string }
  | { type: "log"; text: string }
  | { type: "diff"; unifiedDiff: string; summary?: string }
  | { type: "artifact"; name: string; url?: string; mime?: string }
  | { type: "error"; message: string; stack?: string };
