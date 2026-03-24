/**
 * Lightweight OpenAI Chat Completions client helpers.
 * Uses fetch to avoid adding extra runtime dependencies.
 */

export type OpenAIRole = "system" | "user" | "assistant";

export interface OpenAIMessage {
  role: OpenAIRole;
  content: string;
}

export interface OpenAIChatOptions {
  apiKey: string;
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: Record<string, unknown>;
  timeoutMs: number;
  upstreamRetries?: number;
}

export interface OpenAIUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface OpenAIChatResult {
  content: string | null;
  model: string;
  usage: OpenAIUsage;
  raw: unknown;
}

export class OpenAIUpstreamError extends Error {
  statusCode: number;
  retryable: boolean;
  details?: string;

  constructor(message: string, statusCode: number, retryable: boolean, details?: string) {
    super(message);
    this.name = "OpenAIUpstreamError";
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;
  }
}

const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }

  const error = payload.error;
  if (!isRecord(error)) {
    return undefined;
  }

  const message = error.message;
  return typeof message === "string" ? message : undefined;
}

function extractMessageContent(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null;
  }

  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }

  const firstChoice = choices[0];
  if (!isRecord(firstChoice)) {
    return null;
  }

  const message = firstChoice.message;
  if (!isRecord(message)) {
    return null;
  }

  const content = message.content;
  return typeof content === "string" ? content : null;
}

function extractUsage(payload: unknown): OpenAIUsage {
  if (!isRecord(payload) || !isRecord(payload.usage)) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  }

  const usage = payload.usage;
  return {
    inputTokens: asNumber(usage.prompt_tokens),
    outputTokens: asNumber(usage.completion_tokens),
    totalTokens: asNumber(usage.total_tokens),
  };
}

function extractModel(payload: unknown, fallbackModel: string): string {
  if (!isRecord(payload)) {
    return fallbackModel;
  }

  const model = payload.model;
  return typeof model === "string" ? model : fallbackModel;
}

function isRetryableStatus(statusCode: number): boolean {
  return statusCode === 429 || statusCode >= 500;
}

export async function callOpenAIChat(options: OpenAIChatOptions): Promise<OpenAIChatResult> {
  const maxAttempts = Math.max(1, (options.upstreamRetries ?? 0) + 1);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const payload: Record<string, unknown> = {
        model: options.model,
        messages: options.messages,
      };

      if (typeof options.temperature === "number") {
        payload.temperature = options.temperature;
      }

      if (typeof options.maxOutputTokens === "number") {
        payload.max_tokens = options.maxOutputTokens;
      }

      if (options.responseFormat) {
        payload.response_format = options.responseFormat;
      }

      const response = await fetch(OPENAI_CHAT_COMPLETIONS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      const responsePayload: unknown = responseText ? JSON.parse(responseText) : {};

      if (!response.ok) {
        const retryable = isRetryableStatus(response.status);
        const message =
          extractErrorMessage(responsePayload) ??
          `OpenAI request failed with status ${response.status}`;

        if (retryable && attempt < maxAttempts) {
          await sleep(150 * attempt);
          continue;
        }

        throw new OpenAIUpstreamError(message, response.status, retryable, responseText);
      }

      return {
        content: extractMessageContent(responsePayload),
        usage: extractUsage(responsePayload),
        model: extractModel(responsePayload, options.model),
        raw: responsePayload,
      };
    } catch (error) {
      if (error instanceof OpenAIUpstreamError) {
        throw error;
      }

      const isAbort = error instanceof Error && error.name === "AbortError";
      const message = isAbort
        ? "OpenAI request timed out"
        : "OpenAI provider request failed";

      if (attempt < maxAttempts) {
        await sleep(150 * attempt);
        continue;
      }

      throw new OpenAIUpstreamError(message, 502, true);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw new OpenAIUpstreamError("OpenAI request failed after retries", 502, true);
}

