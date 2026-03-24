/**
 * Role-based authorization middleware for Lambda handlers.
 * Extracts caller role from request and validates access.
 */

import type { APIGatewayProxyEvent } from "aws-lambda";
import { createResponse, HTTP_STATUS } from "./http";

export type UserRole = "student" | "faculty" | "admin";

export interface CallerIdentity {
  userId: string;
  role: UserRole;
  email?: string;
}

/**
 * Extract caller identity from the API Gateway event.
 *
 * During Phase 0-1, role is passed in the request header `x-user-role`
 * and userId in `x-user-id` (set by the frontend from Cognito attributes).
 *
 * In a future phase, this should be replaced with Cognito authorizer claims
 * parsed from event.requestContext.authorizer.
 */
export function extractCallerIdentity(event: APIGatewayProxyEvent): CallerIdentity | null {
  const userId = event.headers?.["x-user-id"] || event.headers?.["X-User-Id"];
  const role = event.headers?.["x-user-role"] || event.headers?.["X-User-Role"];

  if (!userId || !role) {
    return null;
  }

  if (!isValidRole(role)) {
    return null;
  }

  return {
    userId,
    role: role as UserRole,
    email: event.headers?.["x-user-email"] || event.headers?.["X-User-Email"],
  };
}

/**
 * Validate that the caller has one of the allowed roles.
 * Returns an error response if unauthorized, or null if authorized.
 */
export function requireRole(
  caller: CallerIdentity | null,
  allowedRoles: UserRole[]
) {
  if (!caller) {
    return createResponse(HTTP_STATUS.UNAUTHORIZED, {
      error: "Missing authentication headers (x-user-id, x-user-role)",
    });
  }

  if (!allowedRoles.includes(caller.role)) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: `Role '${caller.role}' is not authorized. Required: ${allowedRoles.join(", ")}`,
    });
  }

  return null;
}

function isValidRole(role: string): boolean {
  return ["student", "faculty", "admin"].includes(role);
}
