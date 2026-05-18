import type { APIGatewayProxyHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  getQueryParams,
  HTTP_STATUS,
  createDynamoDbClient,
  putItem,
  generateId,
  generateTimestamp,
  requireCourseInstructor,
  requireCourseEnrollment,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE_NAME!;

const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;

  if (method === "OPTIONS") return optionsResponse();

  try {
    const caller = await extractCallerIdentity(event);
    const authError = requireRole(caller, ["student", "faculty", "simulation_designer", "admin"]);
    if (authError) return authError;

    if (method === "POST") return await handleAppend(caller!, event.body);
    if (method === "GET")
      return await handleQuery(caller!, getQueryParams(event.queryStringParameters));
    return methodNotAllowedResponse(["GET", "POST", "OPTIONS"]);
  } catch (error) {
    console.error("event-log-function unhandled error", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleAppend(caller: any, body: string | null) {
  const payload = parseJsonBody(body);
  // Accept either a single event or an array (batch flush from frontend).
  const events: any[] = Array.isArray(payload.events)
    ? payload.events
    : Array.isArray(payload)
      ? payload
      : [payload];

  if (events.length === 0) return badRequestResponse("No events provided");

  const stored: any[] = [];
  for (const ev of events) {
    if (typeof ev?.eventType !== "string" || !ev.eventType) continue;

    // Students may only append events with their own studentUserId.
    const studentUserId =
      caller.role === "student" ? caller.userId : ev.studentUserId || caller.userId;

    // For student events tied to a course, verify enrollment.
    if (caller.role === "student" && ev.courseId) {
      const accessError = await requireCourseEnrollment(caller, ev.courseId, dynamo);
      if (accessError) {
        // Skip silently rather than rejecting the whole batch.
        continue;
      }
    }

    const now = ev.occurredAt || generateTimestamp();
    const dateKey = now.slice(0, 10);
    const stamped = {
      eventId: ev.eventId || generateId(),
      studentUserId,
      studentDateKey: `${studentUserId}#${dateKey}`,
      courseId: ev.courseId || undefined,
      moduleId: ev.moduleId || undefined,
      moduleItemId: ev.moduleItemId || undefined,
      eventType: ev.eventType,
      payload: ev.payload || {},
      createdAt: now,
    };
    await putItem(EVENT_LOG_TABLE, stamped, dynamo);
    stored.push(stamped);
  }

  return createResponse(HTTP_STATUS.OK, { stored: stored.length, events: stored });
}

async function handleQuery(caller: any, queryParams: Record<string, string>) {
  if (caller.role === "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Students cannot read event log",
    });
  }
  if (caller.role === "faculty" && !queryParams.courseId) {
    return badRequestResponse("Faculty must provide ?courseId=");
  }
  if (caller.role === "faculty") {
    const authError = await requireCourseInstructor(caller, queryParams.courseId, dynamo);
    if (authError) return authError;
  }

  const filterParts: string[] = [];
  const values: Record<string, any> = {};
  if (queryParams.courseId) {
    filterParts.push("courseId = :c");
    values[":c"] = queryParams.courseId;
  }
  if (queryParams.studentUserId) {
    filterParts.push("studentUserId = :s");
    values[":s"] = queryParams.studentUserId;
  }
  if (queryParams.eventType) {
    filterParts.push("eventType = :t");
    values[":t"] = queryParams.eventType;
  }
  if (queryParams.since) {
    filterParts.push("createdAt >= :since");
    values[":since"] = queryParams.since;
  }

  const result = await dynamo.send(
    new ScanCommand({
      TableName: EVENT_LOG_TABLE,
      ...(filterParts.length > 0 && {
        FilterExpression: filterParts.join(" AND "),
        ExpressionAttributeValues: values,
      }),
    })
  );
  const items = (result.Items || []).sort((a, b) =>
    String(a.createdAt).localeCompare(String(b.createdAt))
  );
  return createResponse(HTTP_STATUS.OK, { events: items });
}
