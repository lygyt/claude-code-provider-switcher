import { randomUUID } from "node:crypto";

const sensitivePatterns = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /(ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|API[_-]?KEY|TOKEN)\s*[:=]\s*["']?[^"',\s}]+/gi,
  /(authorization\s*[:=]\s*bearer\s+)[A-Za-z0-9._-]+/gi
];

export function createProviderId(): string {
  return randomUUID();
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function redactSensitiveText(value: string): string {
  return sensitivePatterns.reduce(
    (text, pattern) => text.replace(pattern, (match, prefix: string | undefined) => {
      if (prefix) {
        return `${prefix}[redacted]`;
      }
      return "[redacted]";
    }),
    value
  );
}

export function safeErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) {
    return redactSensitiveText(error.message);
  }

  if (typeof error === "string" && error.trim()) {
    return redactSensitiveText(error);
  }

  return fallbackMessage;
}

export function formatProviderLabel(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : "Unnamed Provider";
}
