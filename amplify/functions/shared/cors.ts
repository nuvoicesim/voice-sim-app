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
): string {
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

  // Return the first configured origin for non-browser calls that don't send Origin.
  return allowedOrigins[0];
}

/**
 * Build endpoint-specific CORS headers.
 */
export function buildCorsHeaders(
  requestOrigin: string | undefined,
  allowedOriginsCsv: string | undefined,
  allowMethods: string = "POST,OPTIONS"
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(requestOrigin, allowedOriginsCsv),
    "Access-Control-Allow-Headers": "Content-Type,X-Request-ID,x-user-id,x-user-role,x-user-email",
    "Access-Control-Allow-Methods": allowMethods,
    "Vary": "Origin",
  };
}

