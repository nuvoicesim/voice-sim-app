/**
 * Base API client using Amplify REST API.
 * Attaches the current Cognito token for app-owned endpoints.
 *
 * Uses storeRef (not store directly) to avoid the circular dependency:
 * store -> slices -> api modules -> apiClient -> store
 */

import { get, post, put, del } from "aws-amplify/api";
import { fetchAuthSession } from "aws-amplify/auth";

const API_NAME = "NurseTownAPI";

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

async function parseErrorBody(body: unknown): Promise<string | null> {
  if (!body || typeof body !== "object") {
    return null;
  }

  const candidate = body as {
    json?: () => Promise<unknown>;
    text?: () => Promise<string>;
  };

  if (typeof candidate.json === "function") {
    try {
      const payload = await candidate.json();
      if (payload && typeof payload === "object") {
        const message =
          typeof (payload as { error?: unknown }).error === "string"
            ? (payload as { error: string }).error
            : typeof (payload as { message?: unknown }).message === "string"
              ? (payload as { message: string }).message
              : null;
        if (message) return message;
      }
    } catch {
      // Ignore body parse failures and fall back to other error shapes.
    }
  }

  if (typeof candidate.text === "function") {
    try {
      const text = await candidate.text();
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  return null;
}

async function toApiError(error: unknown): Promise<Error> {
  if (error instanceof Error && error.message && error.message !== "Unknown error") {
    return error;
  }

  const maybeError = error as {
    response?: {
      statusCode?: number;
      body?: unknown;
    };
    message?: unknown;
  };

  const responseMessage = await parseErrorBody(maybeError?.response?.body);
  if (responseMessage) {
    return new Error(responseMessage);
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

export async function apiGet<T = any>(path: string, queryParams?: Record<string, string>): Promise<T> {
  try {
    const headers = await getAuthHeaders();
    const restOperation = get({
      apiName: API_NAME,
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
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  try {
    const authHeaders = await getAuthHeaders();
    const restOperation = post({
      apiName: API_NAME,
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
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  try {
    const authHeaders = await getAuthHeaders();
    const restOperation = put({
      apiName: API_NAME,
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

export async function apiDelete<T = any>(path: string): Promise<T> {
  try {
    const headers = await getAuthHeaders();
    const restOperation = del({
      apiName: API_NAME,
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
