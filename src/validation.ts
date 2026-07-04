import { ProviderAuthType, ProviderProfileDraft } from "./types";

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export function validateProviderName(name: string | undefined): ValidationResult {
  if (!name || !name.trim()) {
    return { valid: false, message: "Provider name is required." };
  }

  return { valid: true };
}

export function isValidHttpUrl(value: string | undefined, allowEmpty = true): boolean {
  const trimmed = value?.trim();
  if (!trimmed) {
    return allowEmpty;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateBaseUrl(value: string | undefined, allowEmpty = true): ValidationResult {
  if (!isValidHttpUrl(value, allowEmpty)) {
    return { valid: false, message: "Base URL must be a valid http or https URL." };
  }

  return { valid: true };
}

export function authTypeRequiresToken(authType: ProviderAuthType): boolean {
  return authType === "anthropic-auth-token" || authType === "anthropic-api-key";
}

export function validateTokenRequirement(authType: ProviderAuthType, token: string | undefined): ValidationResult {
  if (authTypeRequiresToken(authType) && !token?.trim()) {
    return { valid: false, message: "API key or token is required for this auth type." };
  }

  return { valid: true };
}

export function validateProviderDraft(draft: ProviderProfileDraft): ValidationResult {
  const name = validateProviderName(draft.name);
  if (!name.valid) {
    return name;
  }

  const baseUrl = validateBaseUrl(draft.baseUrl, draft.authType === "oauth");
  if (!baseUrl.valid) {
    return baseUrl;
  }

  return { valid: true };
}
