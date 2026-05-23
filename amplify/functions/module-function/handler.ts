import type { APIGatewayProxyHandler } from "aws-lambda";
import { ScanCommand } from "@aws-sdk/lib-dynamodb";
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
  requireCourseInstructor,
  requireCourseAccess,
  resolveModuleCourseId,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const COURSE_TABLE = process.env.COURSE_TABLE_NAME!;
const MODULE_TABLE = process.env.MODULE_TABLE_NAME!;
const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME!;

const dynamo = createDynamoDbClient();

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters || {};
  const resource = event.resource || "";

  if (method === "OPTIONS") return optionsResponse();

  try {
    const caller = await extractCallerIdentity(event);
    const authError = requireRole(caller, ["student", "faculty", "simulation_designer", "admin"]);
    if (authError) return authError;

    // POST /modules/{moduleId}/reorder — reorder ITEMS inside a module
    if (method === "POST" && pathParams.moduleId && resource.includes("/reorder")) {
      return await handleReorderItems(caller!, pathParams.moduleId, event.body);
    }

    // POST /courses/{courseId}/modules/reorder — reorder MODULES inside a course
    if (
      method === "POST" &&
      pathParams.courseId &&
      resource.endsWith("/courses/{courseId}/modules/reorder")
    ) {
      return await handleReorderModules(caller!, pathParams.courseId, event.body);
    }

    // GET/POST /courses/{courseId}/modules
    if (pathParams.courseId && resource.includes("/courses/{courseId}/modules")) {
      if (method === "GET") return await handleListModules(caller!, pathParams.courseId);
      if (method === "POST") return await handleCreateModule(caller!, pathParams.courseId, event.body);
    }

    // PUT/DELETE /modules/{moduleId}
    if (pathParams.moduleId) {
      if (method === "GET") return await handleGetModule(caller!, pathParams.moduleId);
      if (method === "PUT") return await handleUpdateModule(caller!, pathParams.moduleId, event.body);
      if (method === "DELETE") return await handleDeleteModule(caller!, pathParams.moduleId);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
  } catch (error) {
    console.error("module-function unhandled error", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleListModules(caller: any, courseId: string) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const accessError = await requireCourseAccess(caller, courseId, dynamo);
  if (accessError) return accessError;

  const result = await dynamo.send(
    new ScanCommand({
      TableName: MODULE_TABLE,
      FilterExpression: "courseId = :c",
      ExpressionAttributeValues: { ":c": courseId },
    })
  );
  const modules = (result.Items || []).sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );
  return createResponse(HTTP_STATUS.OK, { modules });
}

async function handleGetModule(caller: any, moduleId: string) {
  const mod = await getItem(MODULE_TABLE, { moduleId }, dynamo);
  if (!mod) return notFoundResponse("Module not found");
  const accessError = await requireCourseAccess(caller, mod.courseId, dynamo);
  if (accessError) return accessError;
  return createResponse(HTTP_STATUS.OK, mod);
}

async function handleCreateModule(caller: any, courseId: string, body: string | null) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseInstructor(caller, courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  const { title, description, position, gating } = payload;
  if (typeof title !== "string" || !title.trim()) {
    return badRequestResponse("title is required");
  }

  let nextPosition = typeof position === "number" ? position : null;
  if (nextPosition === null) {
    // Determine next position from existing modules.
    const existing = await dynamo.send(
      new ScanCommand({
        TableName: MODULE_TABLE,
        FilterExpression: "courseId = :c",
        ExpressionAttributeValues: { ":c": courseId },
      })
    );
    const positions = (existing.Items || []).map((m) => m.position ?? 0);
    nextPosition = positions.length > 0 ? Math.max(...positions) + 1 : 0;
  }

  const now = generateTimestamp();
  const mod = {
    moduleId: generateId(),
    courseId,
    title: title.trim(),
    description: description || "",
    position: nextPosition,
    gating: gating || { kind: "open" },
    createdAt: now,
    updatedAt: now,
  };
  await putItem(MODULE_TABLE, mod, dynamo);
  return createResponse(HTTP_STATUS.CREATED, mod);
}

async function handleUpdateModule(caller: any, moduleId: string, body: string | null) {
  const existing = await getItem(MODULE_TABLE, { moduleId }, dynamo);
  if (!existing) return notFoundResponse("Module not found");
  const authError = await requireCourseInstructor(caller, existing.courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  delete payload.moduleId;
  delete payload.courseId;
  delete payload.createdAt;

  const updated = { ...existing, ...payload, updatedAt: generateTimestamp() };
  await putItem(MODULE_TABLE, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleDeleteModule(caller: any, moduleId: string) {
  const existing = await getItem(MODULE_TABLE, { moduleId }, dynamo);
  if (!existing) return notFoundResponse("Module not found");
  const authError = await requireCourseInstructor(caller, existing.courseId, dynamo);
  if (authError) return authError;

  // Cascade-delete all child ModuleItems.
  const children = await dynamo.send(
    new ScanCommand({
      TableName: MODULE_ITEM_TABLE,
      FilterExpression: "moduleId = :m",
      ExpressionAttributeValues: { ":m": moduleId },
    })
  );
  for (const child of children.Items || []) {
    await deleteItem(MODULE_ITEM_TABLE, { moduleItemId: child.moduleItemId }, dynamo);
  }

  await deleteItem(MODULE_TABLE, { moduleId }, dynamo);
  return createResponse(HTTP_STATUS.OK, { deleted: true });
}

async function handleReorderModules(caller: any, courseId: string, body: string | null) {
  const course = await getItem(COURSE_TABLE, { courseId }, dynamo);
  if (!course) return notFoundResponse("Course not found");
  const authError = await requireCourseInstructor(caller, courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  const orderedIds: string[] = Array.isArray(payload.orderedIds) ? payload.orderedIds : [];
  if (orderedIds.length === 0) return badRequestResponse("orderedIds[] is required");

  const updates: any[] = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const moduleId = orderedIds[i];
    const mod = await getItem(MODULE_TABLE, { moduleId }, dynamo);
    if (!mod || mod.courseId !== courseId) continue;
    const updated = { ...mod, position: i, updatedAt: generateTimestamp() };
    await putItem(MODULE_TABLE, updated, dynamo);
    updates.push(updated);
  }
  return createResponse(HTTP_STATUS.OK, { modules: updates });
}

async function handleReorderItems(caller: any, moduleId: string, body: string | null) {
  const resolved = await resolveModuleCourseId(dynamo, moduleId);
  if (!resolved) return notFoundResponse("Module not found");
  const authError = await requireCourseInstructor(caller, resolved.courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  const orderedIds: string[] = Array.isArray(payload.orderedIds) ? payload.orderedIds : [];
  if (orderedIds.length === 0) return badRequestResponse("orderedIds[] is required");

  const updates = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const itemId = orderedIds[i];
    const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
    if (!item || item.moduleId !== moduleId) continue;
    const updated = { ...item, position: i, updatedAt: generateTimestamp() };
    await putItem(MODULE_ITEM_TABLE, updated, dynamo);
    updates.push(updated);
  }
  return createResponse(HTTP_STATUS.OK, { items: updates });
}
