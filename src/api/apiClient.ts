/**
 * Base API client using Amplify REST API.
 * Attaches the current Cognito token for app-owned endpoints.
 *
 * Uses storeRef (not store directly) to avoid the circular dependency:
 * store -> slices -> api modules -> apiClient -> store
 */

import { get, post, put, del } from "aws-amplify/api";
import { fetchAuthSession } from "aws-amplify/auth";

const DEFAULT_API_NAME = "NurseTownAPI";

function normalizePath(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const session = await fetchAuthSession();
  const idToken = session.tokens?.idToken?.toString();
  const accessToken = session.tokens?.accessToken?.toString();
  const headers: Record<string, string> = {};
  if (idToken) {
    headers.Authorization = `Bearer ${idToken}`;
  } else if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  return headers;
}

function extractMessageFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  if (typeof obj.error === "string") return obj.error;
  if (typeof obj.message === "string") return obj.message;
  // Lambda function-error envelope: { errorMessage: "...", errorType: "..." }
  if (typeof obj.errorMessage === "string") return obj.errorMessage;
  return null;
}

async function parseErrorBody(body: unknown): Promise<string | null> {
  if (body == null) return null;

  // Amplify v6 ApiError.response.body — a STRING containing the raw response body.
  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      const msg = extractMessageFromPayload(parsed);
      if (msg) return msg;
    } catch {
      // Not JSON — return raw text.
    }
    return trimmed;
  }

  // Plain object (already parsed by some error path)
  if (typeof body === "object") {
    const direct = extractMessageFromPayload(body);
    if (direct) return direct;

    // Fallback: a Response-like object with .json() / .text() (older Amplify)
    const candidate = body as {
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    };

    if (typeof candidate.json === "function") {
      try {
        const payload = await candidate.json();
        const msg = extractMessageFromPayload(payload);
        if (msg) return msg;
      } catch {
        // fall through
      }
    }

    if (typeof candidate.text === "function") {
      try {
        const text = await candidate.text();
        const trimmed = text.trim();
        if (!trimmed) return null;
        try {
          const parsed = JSON.parse(trimmed);
          const msg = extractMessageFromPayload(parsed);
          if (msg) return msg;
        } catch {
          // not JSON
        }
        return trimmed;
      } catch {
        return null;
      }
    }
  }

  return null;
}

async function toApiError(error: unknown): Promise<Error> {
  const maybeError = error as {
    response?: {
      statusCode?: number;
      body?: unknown;
    };
    message?: unknown;
  };

  // Always prefer the backend's response body message — Amplify's own
  // ApiError.message is typically generic ("Request failed", "Network error").
  const responseMessage = await parseErrorBody(maybeError?.response?.body);
  if (responseMessage) {
    return new Error(responseMessage);
  }

  // Then fall back to any pre-existing Error.message from upstream.
  if (error instanceof Error && error.message && error.message !== "Unknown error") {
    return error;
  }
  if (typeof maybeError?.message === "string" && maybeError.message.trim()) {
    return new Error(maybeError.message);
  }

  const statusCode = maybeError?.response?.statusCode;
  return new Error(
    typeof statusCode === "number"
      ? `Request failed with status ${statusCode}`
      : "Request failed"
  );
}

export async function apiGet<T = any>(
  path: string,
  queryParams?: Record<string, string>,
  apiName: string = DEFAULT_API_NAME
): Promise<T> {
  try {
    const headers = await getAuthHeaders();
    const restOperation = get({
      apiName,
      path: normalizePath(path),
      options: {
        headers,
        queryParams,
      },
    });
    const response = await restOperation.response;
    return (await response.body.json()) as T;
  } catch (error) {
    throw await toApiError(error);
  }
}

export async function apiPost<T = any>(
  path: string,
  body: any,
  extraHeaders: Record<string, string> = {},
  apiName: string = DEFAULT_API_NAME
): Promise<T> {
  try {
    const authHeaders = await getAuthHeaders();
    const restOperation = post({
      apiName,
      path: normalizePath(path),
      options: {
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
          ...extraHeaders,
        },
        body,
      },
    });
    const response = await restOperation.response;
    return (await response.body.json()) as T;
  } catch (error) {
    throw await toApiError(error);
  }
}

export async function apiPut<T = any>(
  path: string,
  body: any,
  extraHeaders: Record<string, string> = {},
  apiName: string = DEFAULT_API_NAME
): Promise<T> {
  try {
    const authHeaders = await getAuthHeaders();
    const restOperation = put({
      apiName,
      path: normalizePath(path),
      options: {
        headers: {
          "Content-Type": "application/json",
          ...authHeaders,
          ...extraHeaders,
        },
        body,
      },
    });
    const response = await restOperation.response;
    return (await response.body.json()) as T;
  } catch (error) {
    throw await toApiError(error);
  }
}

export async function apiDelete<T = any>(
  path: string,
  apiName: string = DEFAULT_API_NAME
): Promise<T> {
  try {
    const headers = await getAuthHeaders();
    const restOperation = del({
      apiName,
      path: normalizePath(path),
      options: {
        headers,
      },
    });
    await restOperation.response;
    return { success: true } as T;
  } catch (error) {
    throw await toApiError(error);
  }
}
