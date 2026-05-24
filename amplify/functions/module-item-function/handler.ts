import type { APIGatewayProxyHandler } from "aws-lambda";
import { ScanCommand, GetCommand, UpdateCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createHash } from "crypto";
import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  notFoundResponse,
  conflictResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  getQueryParams,
  HTTP_STATUS,
  createDynamoDbClient,
  getItem,
  putItem,
  deleteItem,
  generateId,
  generateTimestamp,
  requireCourseInstructor,
  requireCourseAccess,
  requireCourseEnrollment,
  resolveModuleCourseId,
  resolveModuleItemCourseId,
  listCourseInstructors,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";
import { chooseGroupBalanced, validateRandomizerPayload } from "./balanced";

const COURSE_TABLE = process.env.COURSE_TABLE_NAME!;
const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME!;
const MODULE_TABLE = process.env.MODULE_TABLE_NAME!;
const PROGRESS_TABLE = process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME!;
const GROUP_TABLE = process.env.STUDENT_GROUP_ASSIGNMENT_TABLE_NAME!;
const REVIEWER_FEEDBACK_TABLE = process.env.REVIEWER_FEEDBACK_TABLE_NAME!;
const REVIEWER_ASSIGNMENT_TABLE = process.env.REVIEWER_ASSIGNMENT_TABLE_NAME!;
const SURVEY_INSTANCE_TABLE = process.env.SURVEY_INSTANCE_TABLE_NAME!;
const SESSION_TABLE = process.env.SESSION_TABLE_NAME!;
const TURN_TABLE = process.env.TURN_TABLE_NAME!;
const EVALUATION_TABLE = process.env.EVALUATION_TABLE_NAME!;
const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME!;
const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE_NAME!;
const ENROLLMENT_TABLE = process.env.COURSE_ENROLLMENT_TABLE_NAME!;
const CONSENT_DECISION_TABLE = process.env.CONSENT_DECISION_TABLE_NAME!;

// Internal counters maintained by the balanced randomizer strategy on the
// ModuleItem row itself. Underscore prefix marks them as not API-visible.
const BALANCED_CONSENTED_COUNT_ATTR = "_balancedConsentedCount";
const BALANCED_NONCONSENTED_COUNT_ATTR = "_balancedNonConsentedCount";

const dynamo = createDynamoDbClient();

const VALID_ITEM_TYPES = [
  "assignment",
  "survey",
  "external_link",
  "debrief",
  "instruction",
  "randomizer",
  "reveal_trigger",
  "ai_detection",
  "consent",
];

export const handler: APIGatewayProxyHandler = async (event) => {
  const method = event.httpMethod;
  const pathParams = event.pathParameters || {};
  const resource = event.resource || "";
  const queryParams = getQueryParams(event.queryStringParameters);

  if (method === "OPTIONS") return optionsResponse();

  try {
    const caller = await extractCallerIdentity(event);
    const authError = requireRole(caller, ["student", "faculty", "simulation_designer", "admin"]);
    if (authError) return authError;

    // GET/POST /modules/{moduleId}/items
    if (pathParams.moduleId && resource.endsWith("/modules/{moduleId}/items")) {
      if (method === "GET") return await handleListItems(caller!, pathParams.moduleId);
      if (method === "POST") return await handleCreateItem(caller!, pathParams.moduleId, event.body);
    }

    // ── ModuleItem item-level routes ──
    if (pathParams.itemId) {
      // /module-items/{itemId}/progress
      if (resource.endsWith("/progress")) {
        if (method === "GET") return await handleGetProgress(caller!, pathParams.itemId, queryParams);
        if (method === "POST") return await handleUpdateProgress(caller!, pathParams.itemId, event.body);
      }
      // /module-items/{itemId}/randomize
      if (resource.endsWith("/randomize") && method === "POST") {
        return await handleRandomize(caller!, pathParams.itemId);
      }
      // /module-items/{itemId}/reviewers
      if (resource.endsWith("/reviewers")) {
        if (method === "GET") return await handleListReviewers(caller!, pathParams.itemId, queryParams);
        if (method === "POST") return await handleAssignReviewers(caller!, pathParams.itemId, event.body);
      }
      // /module-items/{itemId}/feedback
      if (resource.endsWith("/feedback")) {
        if (method === "GET") return await handleListFeedback(caller!, pathParams.itemId, queryParams);
        if (method === "POST") return await handleSubmitFeedback(caller!, pathParams.itemId, event.body);
      }
      // /module-items/{itemId}/best-session
      if (resource.endsWith("/best-session") && method === "GET") {
        return await handleGetBestSession(caller!, pathParams.itemId, queryParams);
      }
      // /module-items/{itemId}/sub-questions  (ai_detection)
      if (resource.endsWith("/sub-questions") && method === "GET") {
        return await handleGetAIDetectionSubQuestions(caller!, pathParams.itemId, queryParams);
      }
      // /module-items/{itemId}/sub-answer  (ai_detection)
      if (resource.endsWith("/sub-answer") && method === "POST") {
        return await handleSubmitAIDetectionSubAnswer(caller!, pathParams.itemId, event.body);
      }
      // /module-items/{itemId}/consent-decision  (consent)
      if (resource.endsWith("/consent-decision")) {
        if (method === "GET")
          return await handleGetMyConsentDecision(caller!, pathParams.itemId);
        if (method === "POST")
          return await handleSubmitConsentDecision(caller!, pathParams.itemId, event.body);
      }

      // /module-items/{itemId}
      if (method === "GET") return await handleGetItem(caller!, pathParams.itemId);
      if (method === "PUT") return await handleUpdateItem(caller!, pathParams.itemId, event.body);
      if (method === "DELETE") return await handleDeleteItem(caller!, pathParams.itemId);
    }

    // /courses/{courseId}/consent-decisions  (instructor/admin only)
    if (
      method === "GET" &&
      pathParams.courseId &&
      resource.endsWith("/courses/{courseId}/consent-decisions")
    ) {
      return await handleListConsentDecisionsForCourse(caller!, pathParams.courseId);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
  } catch (error) {
    console.error("module-item-function unhandled error", error);
    return serverErrorResponse("Internal server error");
  }
};

// ───────────── Item CRUD ─────────────

async function handleListItems(caller: any, moduleId: string) {
  const resolved = await resolveModuleCourseId(dynamo, moduleId);
  if (!resolved) return notFoundResponse("Module not found");
  const accessError = await requireCourseAccess(caller, resolved.courseId, dynamo);
  if (accessError) return accessError;

  const result = await dynamo.send(
    new ScanCommand({
      TableName: MODULE_ITEM_TABLE,
      FilterExpression: "moduleId = :m",
      ExpressionAttributeValues: { ":m": moduleId },
    })
  );
  const items = (result.Items || []).sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );
  return createResponse(HTTP_STATUS.OK, { items });
}

async function handleGetItem(caller: any, itemId: string) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  const accessError = await requireCourseAccess(caller, item.courseId, dynamo);
  if (accessError) return accessError;
  return createResponse(HTTP_STATUS.OK, item);
}

async function handleCreateItem(caller: any, moduleId: string, body: string | null) {
  const resolved = await resolveModuleCourseId(dynamo, moduleId);
  if (!resolved) return notFoundResponse("Module not found");
  const authError = await requireCourseInstructor(caller, resolved.courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  const { itemType, title, payload: itemPayload, gating, completionRule, position } = payload;

  if (!VALID_ITEM_TYPES.includes(itemType)) {
    return badRequestResponse(`itemType must be one of: ${VALID_ITEM_TYPES.join(", ")}`);
  }
  if (typeof title !== "string" || !title.trim()) {
    return badRequestResponse("title is required");
  }
  if (typeof itemPayload !== "object" || itemPayload === null) {
    return badRequestResponse("payload object is required");
  }

  const validationError = validatePayloadForType(itemType, itemPayload);
  if (validationError) return badRequestResponse(validationError);

  let nextPosition = typeof position === "number" ? position : null;
  if (nextPosition === null) {
    const existing = await dynamo.send(
      new ScanCommand({
        TableName: MODULE_ITEM_TABLE,
        FilterExpression: "moduleId = :m",
        ExpressionAttributeValues: { ":m": moduleId },
      })
    );
    const positions = (existing.Items || []).map((m) => m.position ?? 0);
    nextPosition = positions.length > 0 ? Math.max(...positions) + 1 : 0;
  }

  const now = generateTimestamp();
  const item = {
    moduleItemId: generateId(),
    moduleId,
    courseId: resolved.courseId,
    itemType,
    title: title.trim(),
    position: nextPosition,
    gating: gating || { kind: "open" },
    payload: itemPayload,
    completionRule: completionRule || defaultCompletionRule(itemType),
    createdAt: now,
    updatedAt: now,
  };
  await putItem(MODULE_ITEM_TABLE, item, dynamo);

  // For assignment items: also link Assignment.moduleItemId so session-function
  // can find the ModuleItem when a session completes. Skip if assignmentId is
  // empty (draft) — DynamoDB GetItem rejects empty string partition keys.
  if (
    itemType === "assignment" &&
    typeof itemPayload.assignmentId === "string" &&
    itemPayload.assignmentId.trim() !== ""
  ) {
    const assignment = await getItem(
      ASSIGNMENT_TABLE,
      { assignmentId: itemPayload.assignmentId },
      dynamo
    );
    if (assignment) {
      const updated = {
        ...assignment,
        courseId: resolved.courseId,
        moduleItemId: item.moduleItemId,
        updatedAt: now,
      };
      await putItem(ASSIGNMENT_TABLE, updated, dynamo);
    }
  }

  return createResponse(HTTP_STATUS.CREATED, item);
}

function defaultCompletionRule(itemType: string) {
  switch (itemType) {
    case "assignment":
    case "survey":
    case "ai_detection":
    case "randomizer":
    case "reveal_trigger":
    case "consent":
      return { kind: "auto_on_submit" };
    case "external_link":
    case "debrief":
    case "instruction":
      return { kind: "manual_check" };
    default:
      return { kind: "manual_check" };
  }
}

/**
 * Validates payload SHAPE only (correct field types). Empty / missing values are allowed
 * because items are typically created as drafts and filled in via the editor afterward.
 * For "ready-to-publish" validation, callers should run their own checks.
 */
function validatePayloadForType(type: string, payload: any): string | null {
  if (typeof payload !== "object" || payload === null) {
    return "payload must be an object";
  }
  switch (type) {
    case "assignment":
      if (payload.assignmentId !== undefined && typeof payload.assignmentId !== "string")
        return "assignment.payload.assignmentId must be a string";
      return null;
    case "survey":
      if (
        payload.surveyTemplateId !== undefined &&
        typeof payload.surveyTemplateId !== "string"
      )
        return "survey.payload.surveyTemplateId must be a string";
      return null;
    case "external_link":
      if (payload.url !== undefined && typeof payload.url !== "string")
        return "external_link.payload.url must be a string";
      return null;
    case "debrief":
    case "instruction":
      if (payload.markdown !== undefined && typeof payload.markdown !== "string")
        return `${type}.payload.markdown must be a string`;
      return null;
    case "randomizer":
      return validateRandomizerPayload(payload);
    case "reveal_trigger":
      if (payload.targetItemIds !== undefined && !Array.isArray(payload.targetItemIds))
        return "reveal_trigger.payload.targetItemIds must be an array";
      return null;
    case "ai_detection":
      if (
        payload.includedAssignmentItemIds !== undefined &&
        !Array.isArray(payload.includedAssignmentItemIds)
      )
        return "ai_detection.payload.includedAssignmentItemIds must be an array";
      return null;
    case "consent":
      if (payload.markdown !== undefined && typeof payload.markdown !== "string")
        return "consent.payload.markdown must be a string";
      if (payload.title !== undefined && typeof payload.title !== "string")
        return "consent.payload.title must be a string";
      if (payload.version !== undefined && typeof payload.version !== "string")
        return "consent.payload.version must be a string";
      return null;
    default:
      return null;
  }
}

async function handleUpdateItem(caller: any, itemId: string, body: string | null) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  delete payload.moduleItemId;
  delete payload.moduleId;
  delete payload.courseId;
  delete payload.createdAt;
  delete payload.itemType; // Cannot change type post-creation; recreate item.

  if (payload.payload) {
    const err = validatePayloadForType(item.itemType, payload.payload);
    if (err) return badRequestResponse(err);
  }

  const updated = { ...item, ...payload, updatedAt: generateTimestamp() };
  await putItem(MODULE_ITEM_TABLE, updated, dynamo);

  // For assignment items: keep Assignment.moduleItemId / courseId in sync
  // when the user picks (or changes) the assignment in the editor.
  if (
    item.itemType === "assignment" &&
    payload.payload &&
    typeof payload.payload.assignmentId === "string" &&
    payload.payload.assignmentId.trim() !== ""
  ) {
    const newAssignmentId = payload.payload.assignmentId;
    const previousAssignmentId = item.payload?.assignmentId;
    const assignment = await getItem(
      ASSIGNMENT_TABLE,
      { assignmentId: newAssignmentId },
      dynamo
    );
    if (assignment) {
      await putItem(
        ASSIGNMENT_TABLE,
        {
          ...assignment,
          courseId: item.courseId,
          moduleItemId: item.moduleItemId,
          updatedAt: generateTimestamp(),
        },
        dynamo
      );
    }
    // If swapped to a different assignment, unlink the previous one.
    if (
      previousAssignmentId &&
      previousAssignmentId !== newAssignmentId &&
      typeof previousAssignmentId === "string" &&
      previousAssignmentId.trim() !== ""
    ) {
      const prev = await getItem(
        ASSIGNMENT_TABLE,
        { assignmentId: previousAssignmentId },
        dynamo
      );
      if (prev && prev.moduleItemId === item.moduleItemId) {
        await putItem(
          ASSIGNMENT_TABLE,
          {
            ...prev,
            courseId: null,
            moduleItemId: null,
            updatedAt: generateTimestamp(),
          },
          dynamo
        );
      }
    }
  }

  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleDeleteItem(caller: any, itemId: string) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
  if (authError) return authError;
  await deleteItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  return createResponse(HTTP_STATUS.OK, { deleted: true });
}

// ───────────── Progress ─────────────

async function handleGetProgress(
  caller: any,
  itemId: string,
  queryParams: Record<string, string>
) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");

  const studentUserId =
    queryParams.studentUserId ||
    (caller.role === "student" ? caller.userId : null);

  if (!studentUserId) {
    return badRequestResponse("studentUserId query param required for non-student callers");
  }

  if (caller.role === "student" && studentUserId !== caller.userId) {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Cannot view another student's progress" });
  }

  if (caller.role === "faculty") {
    const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
    if (authError) return authError;
  }

  const progress = await getItem(
    PROGRESS_TABLE,
    { moduleItemId: itemId, studentUserId },
    dynamo
  );
  return createResponse(HTTP_STATUS.OK, { progress: progress || null });
}

async function handleUpdateProgress(caller: any, itemId: string, body: string | null) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");

  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Only enrolled students can update their own progress",
    });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;

  const payload = parseJsonBody(body);
  const { state, submissionImageUrls } = payload;
  const allowedStates = ["unlocked", "in_progress", "completed"];
  if (!allowedStates.includes(state)) {
    return badRequestResponse(`state must be one of: ${allowedStates.join(", ")}`);
  }

  let cleanedSubmissionImageUrls: string[] | undefined;
  if (submissionImageUrls !== undefined) {
    if (!Array.isArray(submissionImageUrls)) {
      return badRequestResponse("submissionImageUrls must be an array of strings");
    }
    if (submissionImageUrls.length > 2) {
      return badRequestResponse("submissionImageUrls may contain at most 2 URLs");
    }
    for (const url of submissionImageUrls) {
      if (typeof url !== "string" || !url.startsWith("https://")) {
        return badRequestResponse(
          "submissionImageUrls entries must be https URLs"
        );
      }
    }
    cleanedSubmissionImageUrls = submissionImageUrls as string[];
  }

  const now = generateTimestamp();
  const existing = await getItem(
    PROGRESS_TABLE,
    { moduleItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  const next = {
    moduleItemId: itemId,
    studentUserId: caller.userId,
    courseId: item.courseId,
    moduleId: item.moduleId,
    ...(existing || {}),
    state,
    updatedAt: now,
    createdAt: existing?.createdAt || now,
  };
  if (cleanedSubmissionImageUrls !== undefined) {
    next.submissionImageUrls = cleanedSubmissionImageUrls;
  }
  if (state === "in_progress" && !existing?.startedAt) next.startedAt = now;
  if (state === "completed") {
    next.completedAt = now;
    if (item.completionRule?.kind === "manual_check") {
      next.manualCheckedAt = now;
    }
  }
  await putItem(PROGRESS_TABLE, next, dynamo);

  // Log event.
  await emitEvent(caller.userId, item.courseId, item.moduleId, item.moduleItemId, "module_item_progress", {
    state,
  });

  return createResponse(HTTP_STATUS.OK, { progress: next });
}

// ───────────── Randomize (group assignment) ─────────────

async function handleRandomize(caller: any, itemId: string) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "randomizer") {
    return badRequestResponse("ModuleItem is not a randomizer");
  }
  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Only students can trigger randomization",
    });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;

  const groups: Array<{ key: string; label?: string; weight?: number }> = item.payload?.groups || [];
  if (groups.length === 0) {
    return badRequestResponse("randomizer has no groups configured");
  }
  const scope = item.payload?.scope === "module" ? item.moduleId : item.courseId;

  // StudentGroupAssignment uses a 3-element identifier
  // (courseId, studentUserId, scopeKey); Amplify Gen 2 maps that to a DDB
  // table with partition=courseId and a synthesized composite sort key
  // attribute literally named "studentUserId#scopeKey" whose value joins the
  // two with "#". Both reads and writes must address that composite attribute.
  const groupSortKey = `${caller.userId}#${scope}`;
  const existing = await getItem(
    GROUP_TABLE,
    { courseId: item.courseId, "studentUserId#scopeKey": groupSortKey },
    dynamo,
    { consistentRead: true }
  );
  if (existing) {
    return createResponse(HTTP_STATUS.OK, { assignment: existing, alreadyAssigned: true });
  }

  let groupKey: string;
  // Set only when the balanced strategy actually incremented a counter, so
  // that on a putItem failure below we know which counter to compensate.
  let balancedCounterAttr: string | null = null;
  if (item.payload?.strategy === "balanced") {
    const consentItemId: string | undefined = item.payload?.consentItemId;
    const defaultGroupKey: string | undefined = item.payload?.defaultGroupKey;
    const balancedResult = await chooseGroupBalanced({
      groups: groups.map((g) => ({ key: g.key })),
      consentItemId,
      defaultGroupKey,
      callerUserId: caller.userId,
      itemId,
      resolveBucket: async ({ consentItemId: cid, callerUserId }) => {
        if (!cid) return "nonConsented";
        const decision = await getItem(
          CONSENT_DECISION_TABLE,
          { consentItemId: cid, studentUserId: callerUserId },
          dynamo
        );
        return decision?.decision === "agreed" ? "consented" : "nonConsented";
      },
      incrementCounter: async ({ itemId: id, bucket }) => {
        const attr =
          bucket === "consented"
            ? BALANCED_CONSENTED_COUNT_ATTR
            : BALANCED_NONCONSENTED_COUNT_ATTR;
        const result = await dynamo.send(
          new UpdateCommand({
            TableName: MODULE_ITEM_TABLE,
            Key: { moduleItemId: id },
            UpdateExpression: "ADD #c :one",
            ExpressionAttributeNames: { "#c": attr },
            ExpressionAttributeValues: { ":one": 1 },
            ReturnValues: "UPDATED_NEW",
          })
        );
        const newValue = result.Attributes?.[attr];
        if (typeof newValue !== "number") {
          throw new Error("balanced counter increment returned non-numeric value");
        }
        balancedCounterAttr = attr;
        return newValue;
      },
    });
    groupKey = balancedResult.groupKey;
  } else {
    // Weighted / uniform random (existing behavior).
    const weights = groups.map((g) => Math.max(0, g.weight ?? 1));
    const total = weights.reduce((a, b) => a + b, 0);
    let pick = Math.random() * total;
    let chosenIndex = 0;
    for (let i = 0; i < weights.length; i++) {
      pick -= weights[i];
      if (pick <= 0) {
        chosenIndex = i;
        break;
      }
    }
    groupKey = groups[chosenIndex].key;
  }
  const now = generateTimestamp();
  const row = {
    courseId: item.courseId,
    studentUserId: caller.userId,
    scopeKey: scope,
    // Composite sort-key attribute required by the DDB table schema.
    "studentUserId#scopeKey": groupSortKey,
    groupKey,
    assignedByItemId: itemId,
    assignedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  // Conditional put: a parallel request from the same student (double-tap,
  // retry storm) may have inserted the assignment between our existing-row
  // check and this write. If the put fails for any reason and we had
  // incremented the balanced counter, compensate it so the strict 1:1
  // property is preserved for the next arrivals. On a confirmed collision,
  // return the winning row instead of an error.
  try {
    await dynamo.send(
      new PutCommand({
        TableName: GROUP_TABLE,
        Item: row,
        ConditionExpression:
          "attribute_not_exists(courseId) AND attribute_not_exists(#sk)",
        ExpressionAttributeNames: { "#sk": "studentUserId#scopeKey" },
      })
    );
  } catch (putErr: any) {
    if (balancedCounterAttr) {
      try {
        await dynamo.send(
          new UpdateCommand({
            TableName: MODULE_ITEM_TABLE,
            Key: { moduleItemId: itemId },
            UpdateExpression: "ADD #c :neg",
            ExpressionAttributeNames: { "#c": balancedCounterAttr },
            ExpressionAttributeValues: { ":neg": -1 },
          })
        );
      } catch (compErr) {
        console.error(
          "compensating decrement of balanced counter failed",
          compErr
        );
      }
    }
    if (putErr?.name === "ConditionalCheckFailedException") {
      const winner = await getItem(
        GROUP_TABLE,
        { courseId: item.courseId, "studentUserId#scopeKey": groupSortKey },
        dynamo,
        { consistentRead: true }
      );
      if (winner) {
        return createResponse(HTTP_STATUS.OK, {
          assignment: winner,
          alreadyAssigned: true,
        });
      }
    }
    throw putErr;
  }

  // Mark progress completed for the randomizer item.
  const progressNow = {
    moduleItemId: itemId,
    studentUserId: caller.userId,
    courseId: item.courseId,
    moduleId: item.moduleId,
    state: "completed",
    completedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  await putItem(PROGRESS_TABLE, progressNow, dynamo);

  await emitEvent(caller.userId, item.courseId, item.moduleId, itemId, "group_assigned", {
    groupKey,
  });
  return createResponse(HTTP_STATUS.OK, { assignment: row, alreadyAssigned: false });
}

// ───────────── Reviewers (legacy/explicit assignment) ─────────────

async function handleListReviewers(
  caller: any,
  itemId: string,
  queryParams: Record<string, string>
) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
  if (authError) return authError;

  const filter: string[] = ["moduleItemId = :i"];
  const values: Record<string, any> = { ":i": itemId };
  if (queryParams.studentUserId) {
    filter.push("studentUserId = :s");
    values[":s"] = queryParams.studentUserId;
  }
  const result = await dynamo.send(
    new ScanCommand({
      TableName: REVIEWER_ASSIGNMENT_TABLE,
      FilterExpression: filter.join(" AND "),
      ExpressionAttributeValues: values,
    })
  );
  return createResponse(HTTP_STATUS.OK, { reviewers: result.Items || [] });
}

async function handleAssignReviewers(caller: any, itemId: string, body: string | null) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
  if (authError) return authError;
  const payload = parseJsonBody(body);
  const { reviewerUserIds, studentUserId, displayLabels } = payload;
  if (!Array.isArray(reviewerUserIds) || reviewerUserIds.length === 0) {
    return badRequestResponse("reviewerUserIds[] required");
  }
  if (typeof studentUserId !== "string") {
    return badRequestResponse("studentUserId required");
  }
  const now = generateTimestamp();
  const created = [];
  for (let i = 0; i < reviewerUserIds.length; i++) {
    const reviewerUserId = reviewerUserIds[i];
    const row = {
      moduleItemId: itemId,
      reviewerUserId,
      studentUserId,
      // Composite sort key required by DDB schema (identifier has 3 fields).
      "reviewerUserId#studentUserId": `${reviewerUserId}#${studentUserId}`,
      displayLabel: displayLabels?.[i] || `Reviewer ${String.fromCharCode(65 + i)}`,
      createdAt: now,
    };
    await putItem(REVIEWER_ASSIGNMENT_TABLE, row, dynamo);
    created.push(row);
  }
  return createResponse(HTTP_STATUS.OK, { reviewers: created });
}

// ───────────── Feedback (instructor or AI) ─────────────

async function handleListFeedback(
  caller: any,
  itemId: string,
  queryParams: Record<string, string>
) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");

  const studentUserId = queryParams.studentUserId || caller.userId;

  // Faculty/admin: instructor-level access; can see all rows for any student in their course.
  if (caller.role === "faculty" || caller.role === "admin") {
    if (caller.role === "faculty") {
      const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
      if (authError) return authError;
    }
    const result = await dynamo.send(
      new ScanCommand({
        TableName: REVIEWER_FEEDBACK_TABLE,
        FilterExpression: "moduleItemId = :i AND studentUserId = :s",
        ExpressionAttributeValues: { ":i": itemId, ":s": studentUserId },
      })
    );
    return createResponse(HTTP_STATUS.OK, { feedback: result.Items || [] });
  }

  // Student: only their own; reviewerUserId is masked unless `revealed=true`.
  if (caller.role === "student" && studentUserId !== caller.userId) {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Cannot view another student's feedback",
    });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;
  const result = await dynamo.send(
    new ScanCommand({
      TableName: REVIEWER_FEEDBACK_TABLE,
      FilterExpression: "moduleItemId = :i AND studentUserId = :s",
      ExpressionAttributeValues: { ":i": itemId, ":s": caller.userId },
    })
  );
  const masked = (result.Items || []).map((row) =>
    row.revealed
      ? row
      : {
          ...row,
          reviewerUserId: undefined,
          source: undefined,
        }
  );
  return createResponse(HTTP_STATUS.OK, { feedback: masked });
}

async function handleSubmitFeedback(caller: any, itemId: string, body: string | null) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "assignment") {
    return badRequestResponse("Feedback can only be written for assignment-type ModuleItems");
  }
  const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
  if (authError) return authError;

  const payload = parseJsonBody(body);
  const { studentUserId, score, body: feedbackBody } = payload;
  if (typeof studentUserId !== "string") return badRequestResponse("studentUserId required");
  if (typeof feedbackBody !== "string" || !feedbackBody.trim()) {
    return badRequestResponse("body (text) required");
  }
  if (score !== undefined && score !== null && (typeof score !== "number" || score < 1 || score > 7)) {
    return badRequestResponse("score must be number 1-7");
  }

  // Find the existing reviewer feedback for this (itemId, studentUserId, reviewerUserId=caller).
  const existingScan = await dynamo.send(
    new ScanCommand({
      TableName: REVIEWER_FEEDBACK_TABLE,
      FilterExpression:
        "moduleItemId = :i AND studentUserId = :s AND reviewerUserId = :r AND #src = :src",
      ExpressionAttributeNames: { "#src": "source" },
      ExpressionAttributeValues: {
        ":i": itemId,
        ":s": studentUserId,
        ":r": caller.userId,
        ":src": "reviewer",
      },
    })
  );
  const existing = (existingScan.Items || [])[0];
  if (existing && existing.locked) {
    return conflictResponse("Feedback is locked (student has submitted AI detection). Cannot edit.");
  }

  // Look up bestSessionId from progress.
  const progress = await getItem(
    PROGRESS_TABLE,
    { moduleItemId: itemId, studentUserId },
    dynamo
  );
  if (!progress?.bestSessionId) {
    return badRequestResponse(
      "Student has no completed best session for this assignment yet"
    );
  }

  const now = generateTimestamp();
  const row = {
    feedbackId: existing?.feedbackId || generateId(),
    moduleItemId: itemId,
    studentUserId,
    source: "reviewer",
    reviewerUserId: caller.userId,
    displayLabel: existing?.displayLabel || "Reviewer",
    body: feedbackBody.trim(),
    score: typeof score === "number" ? score : null,
    basedOnSessionId: progress.bestSessionId,
    revealed: false,
    locked: false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await putItem(REVIEWER_FEEDBACK_TABLE, row, dynamo);

  await emitEvent(
    caller.userId,
    item.courseId,
    item.moduleId,
    itemId,
    existing ? "feedback_edited_by_teacher" : "feedback_submitted_by_teacher",
    { studentUserId }
  );

  return createResponse(HTTP_STATUS.OK, { feedback: row });
}

// ───────────── Best session (instructor-only viewer) ─────────────

async function handleGetBestSession(
  caller: any,
  itemId: string,
  queryParams: Record<string, string>
) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  const studentUserId = queryParams.studentUserId;
  if (!studentUserId) return badRequestResponse("studentUserId query param required");

  if (caller.role === "faculty") {
    const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
    if (authError) return authError;
  } else if (caller.role !== "admin") {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Instructor or admin only" });
  }

  const progress = await getItem(
    PROGRESS_TABLE,
    { moduleItemId: itemId, studentUserId },
    dynamo
  );
  if (!progress?.bestSessionId) {
    return notFoundResponse("No best session yet");
  }
  const session = await getItem(SESSION_TABLE, { sessionId: progress.bestSessionId }, dynamo);
  if (!session) return notFoundResponse("Session record missing");
  const turnsResult = await dynamo.send(
    new ScanCommand({
      TableName: TURN_TABLE,
      FilterExpression: "sessionId = :s",
      ExpressionAttributeValues: { ":s": progress.bestSessionId },
    })
  );
  const turns = (turnsResult.Items || []).sort(
    (a, b) => (a.turnIndex ?? 0) - (b.turnIndex ?? 0)
  );
  const evaluation = await getItem(
    EVALUATION_TABLE,
    { sessionId: progress.bestSessionId },
    dynamo
  );
  return createResponse(HTTP_STATUS.OK, { session, turns, evaluation });
}

// ───────────── AI detection sub-questions ─────────────

async function handleGetAIDetectionSubQuestions(
  caller: any,
  itemId: string,
  queryParams: Record<string, string>
) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "ai_detection") {
    return badRequestResponse("Not an ai_detection item");
  }

  const studentUserId =
    caller.role === "student" ? caller.userId : queryParams.studentUserId;
  if (!studentUserId) return badRequestResponse("studentUserId required for non-student callers");

  if (caller.role === "student") {
    const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
    if (accessError) return accessError;
  } else if (caller.role === "faculty") {
    const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
    if (authError) return authError;
  }

  const includedIds: string[] = item.payload?.includedAssignmentItemIds || [];
  const instructors = await listCourseInstructors(dynamo, item.courseId);
  const instructorIds = instructors.map((i) => i.facultyUserId);

  // For each included assignment item: check unlock conditions and surface blinded feedback.
  const subQuestions = [];
  for (const aId of includedIds) {
    const subQ = await buildSubQuestion(
      itemId,
      item.courseId,
      aId,
      studentUserId,
      instructorIds
    );
    subQuestions.push(subQ);
  }
  return createResponse(HTTP_STATUS.OK, { subQuestions });
}

async function buildSubQuestion(
  aiDetectionItemId: string,
  courseId: string,
  assignmentItemId: string,
  studentUserId: string,
  instructorIds: string[]
) {
  const assignmentItem = await getItem(
    MODULE_ITEM_TABLE,
    { moduleItemId: assignmentItemId },
    dynamo
  );
  const progress = await getItem(
    PROGRESS_TABLE,
    { moduleItemId: assignmentItemId, studentUserId },
    dynamo
  );
  const completed = progress?.state === "completed";

  // Fetch all feedback rows for this (itemId, studentUserId).
  const fbResult = await dynamo.send(
    new ScanCommand({
      TableName: REVIEWER_FEEDBACK_TABLE,
      FilterExpression: "moduleItemId = :i AND studentUserId = :s",
      ExpressionAttributeValues: { ":i": assignmentItemId, ":s": studentUserId },
    })
  );
  const feedback = fbResult.Items || [];
  const aiFeedback = feedback.find((f) => f.source === "ai");
  const reviewerFeedback = feedback.filter((f) => f.source === "reviewer");

  const haveAllReviewers = instructorIds.every((id) =>
    reviewerFeedback.some((f) => f.reviewerUserId === id)
  );
  const haveAi = !!aiFeedback;

  const missing: string[] = [];
  if (!completed) missing.push("completion");
  if (!haveAi) missing.push("ai_feedback");
  if (!haveAllReviewers) missing.push("co_teacher_feedback");

  if (missing.length > 0) {
    return {
      assignmentItemId,
      assignmentTitle: assignmentItem?.title || "(Assignment)",
      locked: true,
      missing,
    };
  }

  // Already submitted? load SurveyInstance.answers[assignmentItemId] if exists.
  const surveyInstance = await getItem(
    SURVEY_INSTANCE_TABLE,
    { moduleItemId: aiDetectionItemId, studentUserId },
    dynamo
  );
  const existingAnswer = surveyInstance?.answers?.[assignmentItemId];

  // Build blinded list with deterministic shuffle keyed by (studentUserId, aiDetectionItemId, assignmentItemId).
  const allFeedback = [aiFeedback, ...reviewerFeedback];
  const order = stableShuffle(
    allFeedback.length,
    `${studentUserId}#${aiDetectionItemId}#${assignmentItemId}`
  );
  const blinded = order.map((idx, position) => {
    const f = allFeedback[idx];
    return {
      displayKey: String.fromCharCode(65 + position), // A/B/C
      body: f?.body ?? "",
      score: f?.score ?? null,
      // server tracks AI mapping internally; do NOT leak source to client.
      _serverSource: f?.source ?? "unknown", // stripped before send
    };
  });
  // Strip server-only fields.
  const serverMap: Record<string, string> = {};
  const presented = blinded.map((b) => {
    serverMap[b.displayKey] = b._serverSource;
    return { displayKey: b.displayKey, body: b.body, score: b.score };
  });

  return {
    assignmentItemId,
    assignmentTitle: assignmentItem?.title || "(Assignment)",
    locked: false,
    bestSessionId: progress?.bestSessionId || null,
    blindedFeedback: presented,
    existingAnswer,
    // serverMap intentionally not returned; consumed only at sub-answer submission.
  };
}

function stableShuffle(n: number, seed: string): number[] {
  const indices = Array.from({ length: n }, (_, i) => i);
  // Fisher-Yates with seeded RNG.
  const rng = mulberry32(hashSeed(seed));
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  return indices;
}

function hashSeed(s: string): number {
  const h = createHash("sha256").update(s).digest();
  return h.readUInt32BE(0);
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ───────────── AI detection sub-answer submission ─────────────

async function handleSubmitAIDetectionSubAnswer(
  caller: any,
  itemId: string,
  body: string | null
) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "ai_detection") {
    return badRequestResponse("Not an ai_detection item");
  }
  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Only students can submit answers",
    });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;

  const payload = parseJsonBody(body);
  const { assignmentItemId, pickedDisplayKey, followUpText } = payload;
  if (typeof assignmentItemId !== "string") return badRequestResponse("assignmentItemId required");
  if (typeof pickedDisplayKey !== "string") return badRequestResponse("pickedDisplayKey required");

  // Recompute server-side which key is actually AI to score correctness.
  const instructors = await listCourseInstructors(dynamo, item.courseId);
  const instructorIds = instructors.map((i) => i.facultyUserId);
  const sub = await buildSubQuestion(
    itemId,
    item.courseId,
    assignmentItemId,
    caller.userId,
    instructorIds
  );
  if (sub.locked) return badRequestResponse("Sub-question is locked, cannot submit");

  // To check correctness we re-derive the server map deterministically.
  const fbResult = await dynamo.send(
    new ScanCommand({
      TableName: REVIEWER_FEEDBACK_TABLE,
      FilterExpression: "moduleItemId = :i AND studentUserId = :s",
      ExpressionAttributeValues: { ":i": assignmentItemId, ":s": caller.userId },
    })
  );
  const feedback = fbResult.Items || [];
  const aiFeedback = feedback.find((f) => f.source === "ai");
  const reviewerFeedback = feedback.filter((f) => f.source === "reviewer");
  const allFeedback = [aiFeedback, ...reviewerFeedback];
  const order = stableShuffle(
    allFeedback.length,
    `${caller.userId}#${itemId}#${assignmentItemId}`
  );
  let aiDisplayKey = "";
  for (let pos = 0; pos < order.length; pos++) {
    const f = allFeedback[order[pos]];
    if (f?.source === "ai") {
      aiDisplayKey = String.fromCharCode(65 + pos);
      break;
    }
  }
  const isCorrect = pickedDisplayKey === aiDisplayKey;

  // Upsert SurveyInstance.
  const now = generateTimestamp();
  const existingInstance = await getItem(
    SURVEY_INSTANCE_TABLE,
    { moduleItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  const answers = existingInstance?.answers || {};
  answers[assignmentItemId] = {
    pickedDisplayKey,
    isCorrect,
    followUpText: followUpText || null,
    submittedAt: now,
  };
  const instance = {
    moduleItemId: itemId,
    studentUserId: caller.userId,
    surveyInstanceId: existingInstance?.surveyInstanceId || generateId(),
    surveyTemplateId: existingInstance?.surveyTemplateId || `inline:${itemId}`,
    courseId: item.courseId,
    schemaSnapshot: existingInstance?.schemaSnapshot || { kind: "ai_detection", payload: item.payload },
    answers,
    status: existingInstance?.status || "in_progress",
    startedAt: existingInstance?.startedAt || now,
    submittedAt: existingInstance?.submittedAt || null,
    updatedAt: now,
  };
  await putItem(SURVEY_INSTANCE_TABLE, instance, dynamo);

  // Lock the 3 ReviewerFeedback rows for that assignment.
  for (const f of allFeedback) {
    if (!f) continue;
    await putItem(
      REVIEWER_FEEDBACK_TABLE,
      { ...f, locked: true, updatedAt: now },
      dynamo
    );
  }

  await emitEvent(
    caller.userId,
    item.courseId,
    item.moduleId,
    itemId,
    "ai_detection_subquestion_submitted",
    { assignmentItemId, isCorrect }
  );

  // Return WITHOUT correctness if revealCorrectOnSubmit is false (default).
  const reveal = item.payload?.revealCorrectOnSubmit === true;
  return createResponse(HTTP_STATUS.OK, {
    submitted: true,
    ...(reveal && { isCorrect }),
  });
}

// ───────────── Consent decisions ─────────────

async function handleGetMyConsentDecision(caller: any, itemId: string) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "consent") {
    return badRequestResponse("Not a consent item");
  }
  // Students get only their own decision; instructors/admin may pass studentUserId via query.
  // For self-only here (instructor list endpoint is separate).
  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Use /courses/{courseId}/consent-decisions for instructor views",
    });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;
  const row = await getItem(
    CONSENT_DECISION_TABLE,
    { consentItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  return createResponse(HTTP_STATUS.OK, { decision: row || null });
}

async function handleSubmitConsentDecision(caller: any, itemId: string, body: string | null) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "consent") {
    return badRequestResponse("Not a consent item");
  }
  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Only students can submit consent decisions",
    });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;

  const payload = parseJsonBody(body);
  const decision = payload?.decision;
  if (decision !== "agreed" && decision !== "declined") {
    return badRequestResponse('decision must be "agreed" or "declined"');
  }

  const now = generateTimestamp();
  const existing = await getItem(
    CONSENT_DECISION_TABLE,
    { consentItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  const row = {
    consentItemId: itemId,
    studentUserId: caller.userId,
    courseId: item.courseId,
    decision,
    consentVersion: item.payload?.version || null,
    bodySnapshot: item.payload?.markdown || null,
    decidedAt: existing?.decidedAt || now,
    updatedAt: now,
  };
  await putItem(CONSENT_DECISION_TABLE, row, dynamo);

  // Mark the consent ModuleItem itself as completed so it shows a check in the
  // course list regardless of which option the student picked.
  const progress = await getItem(
    PROGRESS_TABLE,
    { moduleItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  await putItem(
    PROGRESS_TABLE,
    {
      moduleItemId: itemId,
      studentUserId: caller.userId,
      courseId: item.courseId,
      moduleId: item.moduleId,
      ...(progress || {}),
      state: "completed",
      completedAt: now,
      startedAt: progress?.startedAt || now,
      createdAt: progress?.createdAt || now,
      updatedAt: now,
    },
    dynamo
  );

  await emitEvent(
    caller.userId,
    item.courseId,
    item.moduleId,
    itemId,
    "consent_decision_recorded",
    { decision, consentVersion: row.consentVersion }
  );

  return createResponse(HTTP_STATUS.OK, { decision: row });
}

async function handleListConsentDecisionsForCourse(caller: any, courseId: string) {
  // instructor/admin only — students should never enumerate peers' decisions.
  if (caller.role === "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Instructor or admin only",
    });
  }
  if (caller.role === "faculty" || caller.role === "simulation_designer") {
    const authError = await requireCourseInstructor(caller, courseId, dynamo);
    if (authError) return authError;
  }

  const result = await dynamo.send(
    new ScanCommand({
      TableName: CONSENT_DECISION_TABLE,
      FilterExpression: "courseId = :c",
      ExpressionAttributeValues: { ":c": courseId },
    })
  );
  const decisions = result.Items || [];
  const counts = {
    agreed: decisions.filter((d) => d.decision === "agreed").length,
    declined: decisions.filter((d) => d.decision === "declined").length,
    total: decisions.length,
  };
  return createResponse(HTTP_STATUS.OK, { decisions, counts });
}

// ───────────── Event log helper ─────────────

async function emitEvent(
  studentUserId: string,
  courseId: string | null,
  moduleId: string | null,
  moduleItemId: string | null,
  eventType: string,
  payload: Record<string, any>
) {
  if (!EVENT_LOG_TABLE) return;
  try {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    const ev = {
      eventId: generateId(),
      studentUserId,
      studentDateKey: `${studentUserId}#${dateKey}`,
      courseId: courseId || undefined,
      moduleId: moduleId || undefined,
      moduleItemId: moduleItemId || undefined,
      eventType,
      payload,
      createdAt: now.toISOString(),
    };
    await putItem(EVENT_LOG_TABLE, ev, dynamo);
  } catch (e) {
    console.warn("emitEvent failed", e);
  }
}
