import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  notFoundResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  HTTP_STATUS,
  createDynamoDbClient,
  getItem,
  putItem,
  deleteItem,
  generateId,
  generateTimestamp,
} from "../shared";
import { extractCallerIdentity, requireRole, type CallerIdentity } from "../shared/auth-middleware";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
const RESPONSE_TABLE_NAME = process.env.RESPONSE_TABLE_NAME;
const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters;

  if (method === "OPTIONS") return optionsResponse();

  try {
    // POST /sessions/{sessionId}/survey-response (legacy)
    if (method === "POST" && pathParams?.sessionId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["student"]);
      if (authError) return authError;
      return await handleSubmitSurveyResponse(pathParams.sessionId, caller!.userId, event.body);
    }

    // GET /survey-templates
    if (method === "GET" && !pathParams?.surveyTemplateId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleListTemplates(caller!);
    }

    // GET /survey-templates/{surveyTemplateId}
    if (method === "GET" && pathParams?.surveyTemplateId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin", "student"]);
      if (authError) return authError;
      return await handleGetTemplate(caller!, pathParams.surveyTemplateId);
    }

    // PUT /survey-templates/{surveyTemplateId}
    if (method === "PUT" && pathParams?.surveyTemplateId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleUpdateTemplate(caller!, pathParams.surveyTemplateId, event.body);
    }

    // DELETE /survey-templates/{surveyTemplateId}
    if (method === "DELETE" && pathParams?.surveyTemplateId) {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleDeleteTemplate(caller!, pathParams.surveyTemplateId);
    }

    // POST /survey-templates
    if (method === "POST") {
      const caller = await extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleCreateTemplate(caller!, event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleListTemplates(caller: CallerIdentity) {
  const result = await dynamo.send(
    new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: "isActive = :active",
      ExpressionAttributeValues: { ":active": true },
    })
  );
  let items = result.Items || [];
  // Faculty: scope to own + legacy (no ownerFacultyId).
  if (caller.role === "faculty") {
    items = items.filter(
      (t) => !t.ownerFacultyId || t.ownerFacultyId === caller.userId
    );
  }
  return createResponse(HTTP_STATUS.OK, { templates: items });
}

async function handleGetTemplate(caller: CallerIdentity, surveyTemplateId: string) {
  const item = await getItem(TABLE_NAME, { surveyTemplateId }, dynamo);
  if (!item) return notFoundResponse("Survey template not found");
  if (
    caller.role === "faculty" &&
    item.ownerFacultyId &&
    item.ownerFacultyId !== caller.userId
  ) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "This template belongs to another faculty",
    });
  }
  return createResponse(HTTP_STATUS.OK, item);
}

async function handleCreateTemplate(caller: CallerIdentity, body: string | null) {
  const payload = parseJsonBody(body);
  const { name, questions, description } = payload;

  if (!name || !questions || !Array.isArray(questions)) {
    return badRequestResponse("Missing required fields: name, questions (array)");
  }

  const now = generateTimestamp();
  const item = {
    surveyTemplateId: generateId(),
    name,
    description: description || "",
    questions,
    ownerRole: caller.role,
    ownerFacultyId: caller.role === "faculty" ? caller.userId : null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(TABLE_NAME, item, dynamo);
  return createResponse(HTTP_STATUS.CREATED, item);
}

async function handleUpdateTemplate(
  caller: CallerIdentity,
  surveyTemplateId: string,
  body: string | null
) {
  const existing = await getItem(TABLE_NAME, { surveyTemplateId }, dynamo);
  if (!existing) return notFoundResponse("Survey template not found");
  if (
    caller.role === "faculty" &&
    existing.ownerFacultyId &&
    existing.ownerFacultyId !== caller.userId
  ) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Cannot edit another faculty's template",
    });
  }
  const payload = parseJsonBody(body);
  delete payload.surveyTemplateId;
  delete payload.ownerFacultyId;
  delete payload.ownerRole;
  delete payload.createdAt;
  const updated = { ...existing, ...payload, updatedAt: generateTimestamp() };
  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleDeleteTemplate(caller: CallerIdentity, surveyTemplateId: string) {
  const existing = await getItem(TABLE_NAME, { surveyTemplateId }, dynamo);
  if (!existing) return notFoundResponse("Survey template not found");
  if (
    caller.role === "faculty" &&
    existing.ownerFacultyId &&
    existing.ownerFacultyId !== caller.userId
  ) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Cannot delete another faculty's template",
    });
  }
  // Soft delete: flip isActive.
  await putItem(
    TABLE_NAME,
    { ...existing, isActive: false, updatedAt: generateTimestamp() },
    dynamo
  );
  return createResponse(HTTP_STATUS.OK, { archived: true });
}

async function handleSubmitSurveyResponse(sessionId: string, studentUserId: string, body: string | null) {
  const payload = parseJsonBody(body);
  const { assignmentId, surveyTemplateId, answers } = payload;

  if (!assignmentId || !surveyTemplateId || !answers) {
    return badRequestResponse("Missing required fields: assignmentId, surveyTemplateId, answers");
  }

  const responseKey = `${sessionId}#${studentUserId}`;
  const item = {
    assignmentId,
    responseKey,
    sessionId,
    studentUserId,
    surveyTemplateId,
    answers,
    submittedAt: generateTimestamp(),
    completionStatus: "completed",
  };

  await putItem(RESPONSE_TABLE_NAME, item, dynamo);
  return createResponse(HTTP_STATUS.CREATED, item);
}
