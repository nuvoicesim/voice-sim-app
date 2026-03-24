import type { APIGatewayProxyHandler } from "aws-lambda";
import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  notFoundResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  getQueryParams,
  HTTP_STATUS,
  createDynamoDbClient,
  getItem,
  putItem,
  generateId,
  generateTimestamp,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME;
const RESPONSE_TABLE_NAME = process.env.RESPONSE_TABLE_NAME;
const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters;

  if (method === "OPTIONS") return optionsResponse();

  try {
    // POST /sessions/{sessionId}/survey-response (student submits survey)
    if (method === "POST" && pathParams?.sessionId) {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["student"]);
      if (authError) return authError;
      return await handleSubmitSurveyResponse(pathParams.sessionId, caller!.userId, event.body);
    }

    // GET /survey-templates
    if (method === "GET" && !pathParams?.surveyTemplateId) {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleListTemplates();
    }

    // GET /survey-templates/{surveyTemplateId}
    if (method === "GET" && pathParams?.surveyTemplateId) {
      return await handleGetTemplate(pathParams.surveyTemplateId);
    }

    // POST /survey-templates
    if (method === "POST") {
      const caller = extractCallerIdentity(event);
      const authError = requireRole(caller, ["faculty", "admin"]);
      if (authError) return authError;
      return await handleCreateTemplate(caller!.role, event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleListTemplates() {
  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: "isActive = :active",
    ExpressionAttributeValues: { ":active": true },
  }));
  return createResponse(HTTP_STATUS.OK, { templates: result.Items || [] });
}

async function handleGetTemplate(surveyTemplateId: string) {
  const item = await getItem(TABLE_NAME, { surveyTemplateId }, dynamo);
  if (!item) return notFoundResponse("Survey template not found");
  return createResponse(HTTP_STATUS.OK, item);
}

async function handleCreateTemplate(ownerRole: string, body: string | null) {
  const payload = parseJsonBody(body);
  const { name, questions } = payload;

  if (!name || !questions || !Array.isArray(questions)) {
    return badRequestResponse("Missing required fields: name, questions (array)");
  }

  const now = generateTimestamp();
  const item = {
    surveyTemplateId: generateId(),
    name,
    questions,
    ownerRole,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  await putItem(TABLE_NAME, item, dynamo);
  return createResponse(HTTP_STATUS.CREATED, item);
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
