/**
 * CORS helpers for Lambda endpoints that require explicit origin allow-listing.
 */

/**
 * Resolve the CORS origin to return for the request.
 * If no allow-list is configured, falls back to "*".
 */
export function resolveCorsOrigin(
  requestOrigin: string | undefined,
  allowedOriginsCsv: string | undefined
): string | null {
  if (!allowedOriginsCsv || allowedOriginsCsv.trim() === "") {
    return "*";
  }

  const allowedOrigins = allowedOriginsCsv
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (allowedOrigins.length === 0) {
    return "*";
  }

  if (allowedOrigins.includes("*")) {
    return "*";
  }

  if (requestOrigin && allowedOrigins.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Only fall back for non-browser callers that do not send an Origin header.
  if (!requestOrigin) {
    return allowedOrigins[0];
  }

  return null;
}

/**
 * Build endpoint-specific CORS headers.
 */
export function buildCorsHeaders(
  requestOrigin: string | undefined,
  allowedOriginsCsv: string | undefined,
  allowMethods: string = "POST,OPTIONS"
): Record<string, string> {
  const allowOrigin = resolveCorsOrigin(requestOrigin, allowedOriginsCsv);
  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Request-ID",
    "Access-Control-Allow-Methods": allowMethods,
    "Vary": "Origin",
  };
}
