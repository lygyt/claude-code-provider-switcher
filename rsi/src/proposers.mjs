import { runCommand } from "./evaluator.mjs";
import { childProcessEnv } from "./provider.mjs";
import { extractJsonObject, truncate } from "./util.mjs";

export function parseProposal(text) {
  const value = extractJsonObject(text);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Proposal JSON must be an object.");
  }
  if (!value.files || typeof value.files !== "object" || Array.isArray(value.files)) {
    throw new Error("Proposal JSON must contain a \"files\" object.");
  }

  const lessons = Array.isArray(value.lessons)
    ? value.lessons
        .filter((lesson) => typeof lesson === "string" && lesson.trim())
        .map((lesson) => lesson.trim().slice(0, 1000))
        .slice(0, 6)
    : [];

  return {
    files: value.files,
    rationale: typeof value.rationale === "string" ? value.rationale.trim().slice(0, 4000) : "",
    lessons
  };
}

export class ScriptedProposer {
  constructor(responses, name = "scripted") {
    this.responses = Array.isArray(responses) ? [...responses] : responses;
    this.name = name;
    this.requests = [];
  }

  async propose(request) {
    this.requests.push(request);
    let response;
    if (typeof this.responses === "function") {
      response = await this.responses(request);
    } else {
      response = this.responses.shift();
    }
    if (response === undefined) {
      throw new Error("ScriptedProposer ran out of responses.");
    }
    return typeof response === "string" ? parseProposal(response) : response;
  }
}

export class CommandProposer {
  constructor(options = {}) {
    this.name = options.name ?? "command";
    this.command = options.command ?? "claude";
    this.args = options.args ?? ["-p", "--output-format", "text"];
    this.timeoutMs = options.timeoutMs ?? 300000;
    this.cwd = options.cwd;
    this.provider = options.provider;
    this.extraEnv = options.env ?? {};
  }

  async propose(request) {
    const result = await runCommand([this.command, ...this.args], {
      cwd: this.cwd ?? process.cwd(),
      timeoutMs: this.timeoutMs,
      env: { ...childProcessEnv(this.provider), ...this.extraEnv },
      input: request.prompt,
      windowsShell: true
    });

    if (result.timedOut) {
      throw new Error(`Proposer command timed out after ${this.timeoutMs}ms.`);
    }
    if (result.code !== 0) {
      throw new Error(`Proposer command exited with ${result.code}: ${truncate(result.stderr || result.stdout, 1200)}`);
    }

    return parseProposal(result.stdout);
  }
}

function messagesEndpoint(baseUrl) {
  const normalized = String(baseUrl).replace(/\/+$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

export class HttpProposer {
  constructor(options = {}) {
    if (!options.baseUrl) {
      throw new Error("HttpProposer requires a baseUrl.");
    }
    if (!options.apiKey) {
      throw new Error("HttpProposer requires an API key or auth token.");
    }
    this.name = options.name ?? "http";
    this.baseUrl = options.baseUrl;
    this.apiKey = options.apiKey;
    this.authType = options.authType ?? "anthropic-auth-token";
    this.model = options.model;
    this.maxTokens = options.maxTokens ?? 8192;
    this.timeoutMs = options.timeoutMs ?? 300000;
    this.temperature = options.temperature;
    if (!this.model) {
      throw new Error("HttpProposer requires a model.");
    }
  }

  async propose(request) {
    const headers = {
      "content-type": "application/json",
      "anthropic-version": "2023-06-01"
    };
    if (this.authType === "anthropic-api-key") {
      headers["x-api-key"] = this.apiKey;
    } else {
      headers.authorization = `Bearer ${this.apiKey}`;
    }

    const payload = {
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [{ role: "user", content: request.prompt }]
    };
    if (typeof this.temperature === "number") {
      payload.temperature = this.temperature;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(messagesEndpoint(this.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      const body = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${truncate(body, 1000)}`);
      }

      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(`Provider returned non-JSON response: ${truncate(body, 1000)}`);
      }

      const text = Array.isArray(parsed.content)
        ? parsed.content
            .filter((block) => block && block.type === "text" && typeof block.text === "string")
            .map((block) => block.text)
            .join("\n")
        : "";
      if (!text.trim()) {
        throw new Error("Provider returned no text content.");
      }
      return parseProposal(text);
    } catch (error) {
      if (error && error.name === "AbortError") {
        throw new Error(`HTTP proposer timed out after ${this.timeoutMs}ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
