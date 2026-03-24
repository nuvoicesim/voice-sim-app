import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  createResponse,
  optionsResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  getQueryParams,
  HTTP_STATUS,
  createDynamoDbClient,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const SESSION_TABLE = process.env.SESSION_TABLE_NAME;
const EVALUATION_TABLE = process.env.EVALUATION_TABLE_NAME;
const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME;
const SURVEY_RESPONSE_TABLE = process.env.SURVEY_RESPONSE_TABLE_NAME;
const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters;

  if (method === "OPTIONS") return optionsResponse();

  if (method !== "GET") {
    return methodNotAllowedResponse(["GET", "OPTIONS"]);
  }

  try {
    const caller = extractCallerIdentity(event);
    const params = getQueryParams(event.queryStringParameters);

    // GET /analytics/student/{studentUserId}
    if (pathParams?.studentUserId) {
      const targetUserId = pathParams.studentUserId;
      if (caller?.role === "student" && caller.userId !== targetUserId) {
        return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Students can only view their own analytics" });
      }
      return await handleStudentAnalytics(targetUserId);
    }

    // GET /analytics/surveys
    if (event.resource?.includes("/surveys")) {
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleSurveyAnalytics(params);
    }

    // GET /analytics/platform
    if (event.resource?.includes("/platform")) {
      const authError = requireRole(caller, ["admin"]);
      if (authError) return authError;
      return await handlePlatformAnalytics();
    }

    // GET /analytics/cohort
    const authError = requireRole(caller, ["faculty", "admin"]);
    if (authError) return authError;
    return await handleCohortAnalytics(params);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleStudentAnalytics(studentUserId: string) {
  const sessionsResult = await dynamo.send(new ScanCommand({
    TableName: SESSION_TABLE,
    FilterExpression: "studentUserId = :uid",
    ExpressionAttributeValues: { ":uid": studentUserId },
  }));

  const sessions = sessionsResult.Items || [];
  const completedSessions = sessions.filter((s) => s.status === "completed");

  // Fetch evaluations for completed sessions
  const evaluations: any[] = [];
  for (const session of completedSessions) {
    try {
      const evalResult = await dynamo.send(new ScanCommand({
        TableName: EVALUATION_TABLE,
        FilterExpression: "sessionId = :sid",
        ExpressionAttributeValues: { ":sid": session.sessionId },
      }));
      if (evalResult.Items?.length) evaluations.push(evalResult.Items[0]);
    } catch (e) { /* skip */ }
  }

  const scores = evaluations.map((e) => e.totalScore).filter(Boolean);
  const avgScore = scores.length ? scores.reduce((a: number, b: number) => a + b, 0) / scores.length : null;

  return createResponse(HTTP_STATUS.OK, {
    totalSessions: sessions.length,
    completedSessions: completedSessions.length,
    activeSessions: sessions.filter((s) => s.status === "active").length,
    averageScore: avgScore,
    recentScores: scores.slice(-10),
    sessionsByAssignment: groupBy(sessions, "assignmentId"),
  });
}

async function handleCohortAnalytics(params: Record<string, string>) {
  const sessionsResult = await dynamo.send(new ScanCommand({ TableName: SESSION_TABLE }));
  const sessions = sessionsResult.Items || [];

  const assignmentId = params.assignmentId;
  const filtered = assignmentId ? sessions.filter((s) => s.assignmentId === assignmentId) : sessions;

  const completedCount = filtered.filter((s) => s.status === "completed").length;
  const uniqueStudents = new Set(filtered.map((s) => s.studentUserId)).size;

  return createResponse(HTTP_STATUS.OK, {
    totalSessions: filtered.length,
    completedSessions: completedCount,
    uniqueStudents,
    completionRate: filtered.length ? (completedCount / filtered.length * 100).toFixed(1) : "0",
    sessionsByAssignment: groupBy(filtered, "assignmentId"),
  });
}

async function handlePlatformAnalytics() {
  const [sessionsResult, assignmentsResult] = await Promise.all([
    dynamo.send(new ScanCommand({ TableName: SESSION_TABLE })),
    dynamo.send(new ScanCommand({ TableName: ASSIGNMENT_TABLE })),
  ]);

  const sessions = sessionsResult.Items || [];
  const assignments = assignmentsResult.Items || [];

  return createResponse(HTTP_STATUS.OK, {
    totalAssignments: assignments.length,
    publishedAssignments: assignments.filter((a) => a.status === "published").length,
    totalSessions: sessions.length,
    completedSessions: sessions.filter((s) => s.status === "completed").length,
    uniqueStudents: new Set(sessions.map((s) => s.studentUserId)).size,
  });
}

async function handleSurveyAnalytics(params: Record<string, string>) {
  const result = await dynamo.send(new ScanCommand({ TableName: SURVEY_RESPONSE_TABLE }));
  const responses = result.Items || [];

  const assignmentId = params.assignmentId;
  const filtered = assignmentId ? responses.filter((r) => r.assignmentId === assignmentId) : responses;

  return createResponse(HTTP_STATUS.OK, {
    totalResponses: filtered.length,
    completedResponses: filtered.filter((r) => r.completionStatus === "completed").length,
    responsesByAssignment: groupBy(filtered, "assignmentId"),
  });
}

function groupBy(items: any[], key: string): Record<string, number> {
  return items.reduce((acc, item) => {
    const k = item[key] || "unknown";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}
