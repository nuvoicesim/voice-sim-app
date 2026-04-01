import { createHmac, randomUUID, timingSafeEqual } from "crypto";

export interface RuntimeTokenClaims {
  sub: string;
  role: "student" | "faculty" | "simulation_designer" | "admin";
  assignmentId: string;
  sessionId: string;
  client: string;
  iat: number;
  exp: number;
  jti: string;
  ver: number;
}

export class RuntimeTokenError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "RuntimeTokenError";
    this.statusCode = statusCode;
  }
}

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64");
}

function signJwt(input: string, secret: string): string {
  return base64UrlEncode(createHmac("sha256", secret).update(input).digest());
}

function parseJson<T>(input: Buffer, label: string): T {
  try {
    return JSON.parse(input.toString("utf8")) as T;
  } catch {
    throw new RuntimeTokenError(`Invalid runtime token ${label}`, 401);
  }
}

export function getBearerToken(
  headers: Record<string, string | undefined> | undefined
): string | null {
  if (!headers) {
    return null;
  }

  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "authorization" || typeof value !== "string") {
      continue;
    }

    const match = value.match(/^Bearer\s+(.+)$/i);
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  return null;
}

export function issueRuntimeToken(
  input: Pick<RuntimeTokenClaims, "sub" | "role" | "assignmentId" | "sessionId" | "client">,
  secret: string,
  ttlSeconds: number
): { token: string; claims: RuntimeTokenClaims } {
  if (!secret.trim()) {
    throw new RuntimeTokenError("Runtime token configuration is missing", 500);
  }

  const now = Math.floor(Date.now() / 1000);
  const claims: RuntimeTokenClaims = {
    ...input,
    iat: now,
    exp: now + ttlSeconds,
    jti: randomUUID(),
    ver: 1,
  };

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const signature = signJwt(`${encodedHeader}.${encodedPayload}`, secret);

  return {
    token: `${encodedHeader}.${encodedPayload}.${signature}`,
    claims,
  };
}

export function verifyRuntimeToken(token: string, secret: string): RuntimeTokenClaims {
  if (!secret.trim()) {
    throw new RuntimeTokenError("Runtime token configuration is missing", 500);
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new RuntimeTokenError("Invalid runtime token format", 401);
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const expectedSignature = signJwt(`${encodedHeader}.${encodedPayload}`, secret);

  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  const actualBuffer = Buffer.from(encodedSignature, "utf8");
  if (
    expectedBuffer.length !== actualBuffer.length ||
    !timingSafeEqual(expectedBuffer, actualBuffer)
  ) {
    throw new RuntimeTokenError("Invalid runtime token signature", 401);
  }

  const header = parseJson<{ alg?: string; typ?: string }>(base64UrlDecode(encodedHeader), "header");
  if (header.alg !== "HS256" || header.typ !== "JWT") {
    throw new RuntimeTokenError("Unsupported runtime token format", 401);
  }

  const claims = parseJson<RuntimeTokenClaims>(base64UrlDecode(encodedPayload), "payload");
  if (
    !claims.sub ||
    !claims.assignmentId ||
    !claims.sessionId ||
    !claims.client ||
    !claims.role ||
    typeof claims.iat !== "number" ||
    typeof claims.exp !== "number"
  ) {
    throw new RuntimeTokenError("Invalid runtime token payload", 401);
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp <= now) {
    throw new RuntimeTokenError("Runtime token has expired", 401);
  }

  return claims;
}

export function extractRuntimeTokenClaims(
  headers: Record<string, string | undefined> | undefined,
  secret: string
): RuntimeTokenClaims | null {
  const token = getBearerToken(headers);
  if (!token) {
    return null;
  }

  return verifyRuntimeToken(token, secret);
}

export function requireRuntimeTokenClaims(
  headers: Record<string, string | undefined> | undefined,
  secret: string
): RuntimeTokenClaims {
  const claims = extractRuntimeTokenClaims(headers, secret);
  if (!claims) {
    throw new RuntimeTokenError("Missing runtime token", 401);
  }

  return claims;
}

export function applyRuntimeClaimsToBody<
  T extends {
    userID?: string;
    context?: { assignmentId?: string; sessionId?: string };
    metadata?: { client?: string };
  }
>(body: T, claims: RuntimeTokenClaims): T {
  if (body.userID && body.userID !== claims.sub) {
    throw new RuntimeTokenError("userID does not match runtime token", 409);
  }

  if (
    body.context?.assignmentId &&
    body.context.assignmentId !== claims.assignmentId
  ) {
    throw new RuntimeTokenError("assignmentId does not match runtime token", 409);
  }

  if (
    body.context?.sessionId &&
    body.context.sessionId !== claims.sessionId
  ) {
    throw new RuntimeTokenError("sessionId does not match runtime token", 409);
  }

  return {
    ...body,
    userID: claims.sub,
    context: {
      ...(body.context || {}),
      assignmentId: claims.assignmentId,
      sessionId: claims.sessionId,
    },
    metadata: {
      ...(body.metadata || {}),
      client: body.metadata?.client || claims.client,
    },
  };
}
