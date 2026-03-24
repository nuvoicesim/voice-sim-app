/**
 * HTTP utilities for Lambda functions
 * Contains common HTTP response helpers and CORS configuration
 */

/**
 * Standard CORS headers for API responses
 */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,x-user-id,x-user-role,x-user-email",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS,PUT,DELETE",
} as const;

/**
 * HTTP status codes enum for better code readability
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500,
} as const;

/**
 * Create a standardized HTTP response
 * @param status - HTTP status code
 * @param body - Response body (will be JSON stringified)
 * @param extraHeaders - Additional headers to include
 * @returns Lambda-compatible HTTP response object
 */
export function createResponse(
  status: number, 
  body: any = {}, 
  extraHeaders: Record<string, string> = {}
) {
  return {
    statusCode: status,
    headers: { ...CORS_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

/**
 * Create a success response (200)
 * @param data - Data to return in the response
 * @param extraHeaders - Additional headers
 */
export function successResponse(data: any, extraHeaders?: Record<string, string>) {
  return createResponse(HTTP_STATUS.OK, data, extraHeaders);
}

/**
 * Create a created response (201)
 * @param data - Data to return in the response
 * @param extraHeaders - Additional headers
 */
export function createdResponse(data: any, extraHeaders?: Record<string, string>) {
  return createResponse(HTTP_STATUS.CREATED, data, extraHeaders);
}

/**
 * Create a bad request error response (400)
 * @param message - Error message
 * @param details - Additional error details
 */
export const badRequestResponse = (message: string) => createResponse(HTTP_STATUS.BAD_REQUEST, { error: message });

/**
 * Create a conflict error response (409)
 * @param message - Error message
 */
export const conflictResponse = (message: string) => createResponse(HTTP_STATUS.CONFLICT, { error: message });

/**
 * Create a not found error response (404)
 * @param message - Error message
 */
export const notFoundResponse = (message: string) => createResponse(HTTP_STATUS.NOT_FOUND, { error: message });

/**
 * Create a method not allowed error response (405)
 * @param allowedMethods - Array of allowed HTTP methods
 */
export function methodNotAllowedResponse(allowedMethods: string[] = []) {
  const headers: Record<string, string> = allowedMethods.length > 0 
    ? { "Allow": allowedMethods.join(", ") }
    : {};
  
  return createResponse(
    HTTP_STATUS.METHOD_NOT_ALLOWED, 
    { message: "Method not allowed" },
    headers
  );
}

/**
 * Create an internal server error response (500)
 * @param message - Error message
 * @param isDevelopment - Whether to include error details (for development only)
 * @param error - The original error object
 */
export function serverErrorResponse(
  message: string = "Internal server error", 
  isDevelopment: boolean = false,
  error?: Error
) {
  const body: any = { message };
  
  if (isDevelopment && error) {
    body.details = {
      stack: error.stack,
      name: error.name,
    };
  }
  
  return createResponse(HTTP_STATUS.INTERNAL_SERVER_ERROR, body);
}

/**
 * Create an OPTIONS response for CORS preflight requests
 */
export function optionsResponse() {
  return createResponse(HTTP_STATUS.OK);
}

/**
 * Parse and validate JSON body from Lambda event
 * @param body - The body string from Lambda event
 * @returns Parsed JSON object
 * @throws Error if JSON is invalid
 */
export function parseJsonBody(body: string | null): any {
  if (!body) {
    throw new Error("Request body is required");
  }
  
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error("Invalid JSON format in request body");
  }
}

/**
 * Extract query parameters from Lambda event
 * @param queryStringParameters - Query parameters from Lambda event
 * @returns Object with query parameters (empty object if null)
 */
export function getQueryParams(queryStringParameters: Record<string, string | undefined> | null): Record<string, string> {
  if (!queryStringParameters) {
    return {};
  }
  
  // Filter out undefined values and convert to Record<string, string>
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(queryStringParameters)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
