/**
 * Role-based authorization middleware for Lambda handlers.
 * Extracts caller role from request and validates access.
 */

import type { APIGatewayProxyEvent } from "aws-lambda";
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from "@aws-sdk/client-cognito-identity-provider";
import { createResponse, HTTP_STATUS } from "./http";

export type UserRole = "student" | "faculty" | "simulation_designer" | "admin";

export interface CallerIdentity {
  userId: string;
  role: UserRole;
  email?: string;
}

type AuthorizerClaims = Record<string, unknown>;
const USER_POOL_ID = process.env.USER_POOL_ID;
const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || "us-east-1" });

function getClaim(
  claims: AuthorizerClaims,
  ...names: string[]
): string | undefined {
  for (const name of names) {
    const value = claims[name];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return undefined;
}

function extractClaimsIdentity(event: APIGatewayProxyEvent): CallerIdentity | null {
  const claims = event.requestContext.authorizer?.claims as AuthorizerClaims | undefined;
  if (!claims) {
    return null;
  }

  const userId = getClaim(claims, "sub");
  const role = getClaim(claims, "custom:role", "role");

  if (!userId || !role || !isValidRole(role)) {
    return null;
  }

  return {
    userId,
    role: role as UserRole,
    email: getClaim(claims, "email"),
  };
}

async function loadRoleFromCognito(claims: AuthorizerClaims): Promise<UserRole | null> {
  if (!USER_POOL_ID) {
    console.warn("auth role fallback skipped: USER_POOL_ID missing");
    return null;
  }

  const username = getClaim(claims, "cognito:username", "username", "email");
  if (!username) {
    console.warn("auth role fallback skipped: no username/email claim");
    return null;
  }

  try {
    const result = await cognitoClient.send(new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username,
    }));
    const role = result.UserAttributes?.find((attribute) => attribute.Name === "custom:role")?.Value;
    if (!role) {
      console.warn("auth role fallback defaulted to student", { username });
      return "student";
    }

    if (!isValidRole(role)) {
      console.warn("auth role fallback returned invalid role", { username, role });
      return null;
    }

    console.log("auth role fallback used", { username, role });
    return role as UserRole;
  } catch (error) {
    console.error("Failed to load Cognito role fallback", { username, error });
    return null;
  }
}

/**
 * Extract caller identity from verified Cognito authorizer claims.
 */
export async function extractCallerIdentity(event: APIGatewayProxyEvent): Promise<CallerIdentity | null> {
  const claims = event.requestContext.authorizer?.claims as AuthorizerClaims | undefined;
  if (!claims) {
    console.warn("auth identity diagnostic", { hasClaims: false });
    return null;
  }

  console.log("auth identity diagnostic", {
    hasClaims: true,
    hasSub: Boolean(getClaim(claims, "sub")),
    hasEmail: Boolean(getClaim(claims, "email")),
    hasRoleClaim: Boolean(getClaim(claims, "custom:role", "role")),
    hasUsernameClaim: Boolean(getClaim(claims, "cognito:username", "username")),
    claimKeys: Object.keys(claims).sort(),
  });

  const claimsIdentity = extractClaimsIdentity(event);
  if (claimsIdentity) {
    console.log("auth identity resolved from token claims", {
      userId: claimsIdentity.userId,
      role: claimsIdentity.role,
    });
    return claimsIdentity;
  }

  const userId = getClaim(claims, "sub");
  console.log("auth identity attempting role fallback", {
    hasUserPoolId: Boolean(USER_POOL_ID),
    userId,
    username: getClaim(claims, "cognito:username", "username", "email"),
  });
  const role = await loadRoleFromCognito(claims);
  if (!userId || !role) {
    console.warn("auth identity unresolved", {
      hasUserId: Boolean(userId),
      hasRole: Boolean(role),
    });
    return null;
  }

  console.log("auth identity resolved from Cognito fallback", { userId, role });
  return {
    userId,
    role,
    email: getClaim(claims, "email"),
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
      error: "Authentication required",
    });
  }

  if (!allowedRoles.includes(caller.role)) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: `Role '${caller.role}' is not authorized. Required: ${allowedRoles.join(", ")}`,
    });
  }

  return null;
}

export function requireAuthenticated(caller: CallerIdentity | null) {
  if (!caller) {
    return createResponse(HTTP_STATUS.UNAUTHORIZED, {
      error: "Authentication required",
    });
  }

  return null;
}

function isValidRole(role: string): boolean {
  return ["student", "faculty", "simulation_designer", "admin"].includes(role);
}
