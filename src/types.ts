export type ProviderAuthType =
  | "anthropic-auth-token"
  | "anthropic-api-key"
  | "oauth";

export type ClaudeEffortLevel = "low" | "medium" | "high" | "max";

export type TerminalPermissionMode = "requestApproval" | "fullAccess";

export interface ProviderProfile {
  id: string;
  name: string;
  authType: ProviderAuthType;
  baseUrl?: string;
  model?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  subagentModel?: string;
  effortLevel?: ClaudeEffortLevel;
  chatBaseUrl?: string;
  chatModel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProfileDraft {
  name: string;
  authType: ProviderAuthType;
  baseUrl?: string;
  model?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  subagentModel?: string;
  effortLevel?: ClaudeEffortLevel;
  chatBaseUrl?: string;
  chatModel?: string;
}

export type SecretChange =
  | { kind: "keep" }
  | { kind: "replace"; token: string }
  | { kind: "remove" };

export interface GlobalStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export interface SecretStorageLike {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
  delete(key: string): Thenable<void>;
}

export interface ProviderStoreStorage {
  globalState: GlobalStateLike;
  secrets: SecretStorageLike;
  configFilePath?: string;
  legacyTokenFilePath?: string;
}

export interface ExtensionConfig {
  launchAfterSelection: boolean;
  checkClaudeCliBeforeLaunch: boolean;
  terminalNameFormat: string;
  terminalLocation: "editor" | "panel";
  conversationMode: "fresh" | "continue" | "resumePicker";
  permissionMode: TerminalPermissionMode;
  claudeExecutablePath: string;
}

export interface ClaudeSkill {
  id: string;
  name: string;
  directory: string;
  scope: "user" | "workspace" | "config";
  description?: string;
  sourceUrl?: string;
}

export interface WorkflowStep {
  id: string;
  name: string;
  providerId: string;
  model: string;
  skillDirectory?: string;
  /** Instructions for this step. Supports workflow prompt tokens such as {{task}} and {{previous}}. */
  prompt: string;
  /** If true, extract ```python code blocks from the chat output, write them to the
   *  project directory, execute them, and use the execution result as {{previous}} for
   *  the next step instead of the raw chat output. */
  execute?: boolean;
  /** Path to a LaTeX template .tex file with a {{BODY}} placeholder. When set, the
   *  full chat output is inserted at {{BODY}}, the result is written to paper/main.tex,
   *  and pdflatex is attempted (best-effort). */
  templatePath?: string;
}

export interface WorkflowReviewLoop {
  enabled: boolean;
  /** Optional label, e.g. "code-test" or "manuscript-review". */
  name?: string;
  /** First step to rerun when the review asks for changes. */
  reviseFromStepId: string;
  /** Step whose output decides whether another revision pass is needed. */
  reviewStepId: string;
  /** Maximum number of review attempts, including the first review. */
  maxIterations: number;
  /** Optional JavaScript regular expression. A match means the review approved the artifact. */
  approvalPattern?: string;
}

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  steps: WorkflowStep[];
  /** Ordered, non-overlapping review loops. Evaluated in pipeline order. */
  reviewLoops?: WorkflowReviewLoop[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStepResult {
  step: WorkflowStep;
  providerName: string;
  modelName: string;
  skillName?: string;
  loopIteration?: number;
  input: string;
  output: string;
  error?: string;
}

export interface WorkflowReviewLoopRunSummary {
  enabled: boolean;
  approved: boolean;
  exhausted: boolean;
  iterations: number;
  maxIterations: number;
  reviseFromStepName?: string;
  reviewStepName?: string;
  approvalPattern: string;
  error?: string;
}

export interface WorkflowRunResult {
  workflow: Workflow;
  task: string;
  steps: WorkflowStepResult[];
  finalOutput: string;
  succeeded: boolean;
  reviewLoops?: WorkflowReviewLoopRunSummary[];
}

export const extensionPrefix = "claude-code-provider-switcher";
export const providersKey = `${extensionPrefix}.providers`;
export const activeProviderIdKey = `${extensionPrefix}.activeProviderId`;
export const activeSkillIdKey = `${extensionPrefix}.activeSkillId`;
