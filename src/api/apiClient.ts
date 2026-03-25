/**
 * Base API client using Amplify REST API.
 * Attaches role/user headers for backend auth-middleware.
 *
 * Uses storeRef (not store directly) to avoid the circular dependency:
 * store -> slices -> api modules -> apiClient -> store
 */

import { get, post, put, del } from "aws-amplify/api";
import { getStoreRef } from "../storeRef";

const API_NAME = "NurseTownAPI";

function normalizePath(path: string): string {
  return path.startsWith("/") ? path.slice(1) : path;
}

function getAuthHeaders(): Record<string, string> {
  const store = getStoreRef();
  if (!store) return {};
  const state = store.getState() as any;
  const auth = state.auth;
  const headers: Record<string, string> = {};
  if (auth?.userId) headers["x-user-id"] = auth.userId;
  if (auth?.role) headers["x-user-role"] = auth.role;
  if (auth?.email) headers["x-user-email"] = auth.email;
  return headers;
}

export async function apiGet<T = any>(path: string, queryParams?: Record<string, string>): Promise<T> {
  const restOperation = get({
    apiName: API_NAME,
    path: normalizePath(path),
    options: {
      headers: getAuthHeaders(),
      queryParams,
    },
  });
  const response = await restOperation.response;
  return (await response.body.json()) as T;
}

export async function apiPost<T = any>(path: string, body: any): Promise<T> {
  const restOperation = post({
    apiName: API_NAME,
    path: normalizePath(path),
    options: {
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body,
    },
  });
  const response = await restOperation.response;
  return (await response.body.json()) as T;
}

export async function apiPut<T = any>(path: string, body: any): Promise<T> {
  const restOperation = put({
    apiName: API_NAME,
    path: normalizePath(path),
    options: {
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders(),
      },
      body,
    },
  });
  const response = await restOperation.response;
  return (await response.body.json()) as T;
}

export async function apiDelete<T = any>(path: string): Promise<T> {
  const restOperation = del({
    apiName: API_NAME,
    path: normalizePath(path),
    options: {
      headers: getAuthHeaders(),
    },
  });
  await restOperation.response;
  return { success: true } as T;
}
