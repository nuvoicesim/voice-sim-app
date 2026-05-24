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
  generateId,
  generateTimestamp,
  requireCourseEnrollment,
  requireCourseInstructor,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const MODULE_ITEM_TABLE = process.env.MODULE_ITEM_TABLE_NAME!;
const SURVEY_INSTANCE_TABLE = process.env.SURVEY_INSTANCE_TABLE_NAME!;
const SURVEY_TEMPLATE_TABLE = process.env.SURVEY_TEMPLATE_TABLE_NAME!;
const REVIEWER_FEEDBACK_TABLE = process.env.REVIEWER_FEEDBACK_TABLE_NAME!;
const PROGRESS_TABLE = process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME!;
const EVENT_LOG_TABLE = process.env.EVENT_LOG_TABLE_NAME!;
const CONSENT_DECISION_TABLE = process.env.CONSENT_DECISION_TABLE_NAME || "";
const ASSIGNMENT_TABLE = process.env.ASSIGNMENT_TABLE_NAME!;

async function consentGate(
  item: any,
  studentUserId: string
): Promise<{ ok: true } | { ok: false; status: number; reason: string; consentModuleItemId: string }> {
  const consentId = item?.payload?.consentModuleItemId;
  if (!consentId || !CONSENT_DECISION_TABLE) return { ok: true };
  const decision = await getItem(
    CONSENT_DECISION_TABLE,
    { consentItemId: consentId, studentUserId },
    dynamo
  );
  if (!decision) {
    return {
      ok: false,
      status: HTTP_STATUS.FORBIDDEN,
      reason: "Consent required",
      consentModuleItemId: consentId,
    };
  }
  if (
    decision.decision === "declined" &&
    item.payload?.hideOnDecline !== false
  ) {
    return {
      ok: false,
      status: HTTP_STATUS.FORBIDDEN,
      reason: "Survey skipped due to declined consent",
      consentModuleItemId: consentId,
    };
  }
  return { ok: true };
}

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

    // GET /assignments/{assignmentId}/survey-instances — faculty roster view
    if (
      method === "GET" &&
      pathParams.assignmentId &&
      resource.endsWith("/survey-instances")
    ) {
      return await handleListByAssignment(caller!, pathParams.assignmentId);
    }

    if (!pathParams.itemId) {
      return badRequestResponse("itemId path param required");
    }

    if (resource.endsWith("/submit") && method === "POST") {
      return await handleSubmit(caller!, pathParams.itemId);
    }
    if (method === "GET") {
      const qs = event.queryStringParameters || {};
      if (qs.studentUserId) {
        return await handleGetForStudent(
          caller!,
          pathParams.itemId,
          qs.studentUserId
        );
      }
      return await handleGet(caller!, pathParams.itemId);
    }
    if (method === "PUT") return await handleSaveAnswers(caller!, pathParams.itemId, event.body);

    return methodNotAllowedResponse(["GET", "PUT", "POST", "OPTIONS"]);
  } catch (error) {
    console.error("survey-instance-function unhandled error", error);
    return serverErrorResponse("Internal server error");
  }
};

async function handleGet(caller: any, itemId: string) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "survey" && item.itemType !== "debrief") {
    return badRequestResponse("ModuleItem is not a survey or debrief");
  }
  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, {
      error: "Only enrolled students may load their survey instance",
    });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;

  // Consent hard gate: blocks both first-open snapshot AND re-read of an
  // already-existing instance, defending against a student declining consent
  // mid-flow and then trying to re-access the survey.
  const gate = await consentGate(item, caller.userId);
  if (!gate.ok) {
    return createResponse(gate.status, {
      error: gate.reason,
      consentModuleItemId: gate.consentModuleItemId,
    });
  }

  let instance = await getItem(
    SURVEY_INSTANCE_TABLE,
    { moduleItemId: itemId, studentUserId: caller.userId },
    dynamo
  );

  if (!instance) {
    // Snapshot the survey template at first open.
    const surveyTemplateId = item.payload?.surveyTemplateId;
    if (!surveyTemplateId) return badRequestResponse("ModuleItem missing surveyTemplateId");
    const template = await getItem(SURVEY_TEMPLATE_TABLE, { surveyTemplateId }, dynamo);
    if (!template) return notFoundResponse("SurveyTemplate not found");

    const now = generateTimestamp();
    instance = {
      moduleItemId: itemId,
      studentUserId: caller.userId,
      surveyInstanceId: generateId(),
      surveyTemplateId,
      courseId: item.courseId,
      schemaSnapshot: {
        templateId: surveyTemplateId,
        name: template.name,
        description: template.description ?? null,
        questions: template.questions,
      },
      answers: {},
      status: "in_progress",
      startedAt: now,
      submittedAt: null,
      updatedAt: now,
    };
    await putItem(SURVEY_INSTANCE_TABLE, instance, dynamo);
    await emitEvent(caller.userId, item.courseId, item.moduleId, itemId, "survey_started", {});

    // Mark progress in_progress.
    const progress = await getItem(
      PROGRESS_TABLE,
      { moduleItemId: itemId, studentUserId: caller.userId },
      dynamo
    );
    const progressNow = {
      moduleItemId: itemId,
      studentUserId: caller.userId,
      courseId: item.courseId,
      moduleId: item.moduleId,
      ...(progress || {}),
      state: progress?.state === "completed" ? "completed" : "in_progress",
      startedAt: progress?.startedAt || now,
      createdAt: progress?.createdAt || now,
      updatedAt: now,
    };
    await putItem(PROGRESS_TABLE, progressNow, dynamo);
  }

  return createResponse(HTTP_STATUS.OK, { instance });
}

async function handleSaveAnswers(caller: any, itemId: string, body: string | null) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Student only" });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;
  const gate = await consentGate(item, caller.userId);
  if (!gate.ok) {
    return createResponse(gate.status, {
      error: gate.reason,
      consentModuleItemId: gate.consentModuleItemId,
    });
  }

  const payload = parseJsonBody(body);
  const incomingAnswers = payload.answers && typeof payload.answers === "object" ? payload.answers : {};

  const existing = await getItem(
    SURVEY_INSTANCE_TABLE,
    { moduleItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  if (!existing) return notFoundResponse("Instance not started — GET first to initialize");
  if (existing.status === "submitted") {
    return createResponse(HTTP_STATUS.CONFLICT, {
      error: "Already submitted, cannot edit",
    });
  }

  const updated = {
    ...existing,
    answers: { ...(existing.answers || {}), ...incomingAnswers },
    updatedAt: generateTimestamp(),
  };
  await putItem(SURVEY_INSTANCE_TABLE, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, { instance: updated });
}

async function handleSubmit(caller: any, itemId: string) {
  const item = await getItem(MODULE_ITEM_TABLE, { moduleItemId: itemId }, dynamo);
  if (!item) return notFoundResponse("ModuleItem not found");
  if (caller.role !== "student") {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Student only" });
  }
  const accessError = await requireCourseEnrollment(caller, item.courseId, dynamo);
  if (accessError) return accessError;
  const gate = await consentGate(item, caller.userId);
  if (!gate.ok) {
    return createResponse(gate.status, {
      error: gate.reason,
      consentModuleItemId: gate.consentModuleItemId,
    });
  }

  const existing = await getItem(
    SURVEY_INSTANCE_TABLE,
    { moduleItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  if (!existing) return notFoundResponse("Instance not started");
  if (existing.status === "submitted") {
    return createResponse(HTTP_STATUS.OK, { instance: existing, alreadySubmitted: true });
  }

  const now = generateTimestamp();
  const updated = { ...existing, status: "submitted", submittedAt: now, updatedAt: now };
  await putItem(SURVEY_INSTANCE_TABLE, updated, dynamo);

  // Mark item progress completed.
  const progress = await getItem(
    PROGRESS_TABLE,
    { moduleItemId: itemId, studentUserId: caller.userId },
    dynamo
  );
  const progressNow = {
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
  };
  await putItem(PROGRESS_TABLE, progressNow, dynamo);

  await emitEvent(caller.userId, item.courseId, item.moduleId, itemId, "survey_submitted", {
    surveyTemplateId: existing.surveyTemplateId,
  });

  // Handle reveal trigger if configured on this item.
  const revealConfig = item.payload?.revealOnSubmit;
  if (revealConfig?.unblindAssignmentItemId) {
    await unblindFeedbackForStudent(
      revealConfig.unblindAssignmentItemId,
      caller.userId
    );
  }

  return createResponse(HTTP_STATUS.OK, { instance: updated });
}

async function unblindFeedbackForStudent(assignmentItemId: string, studentUserId: string) {
  const result = await dynamo.send(
    new ScanCommand({
      TableName: REVIEWER_FEEDBACK_TABLE,
      FilterExpression: "moduleItemId = :i AND studentUserId = :s",
      ExpressionAttributeValues: { ":i": assignmentItemId, ":s": studentUserId },
    })
  );
  for (const row of result.Items || []) {
    if (row.revealed) continue;
    await putItem(
      REVIEWER_FEEDBACK_TABLE,
      { ...row, revealed: true, updatedAt: generateTimestamp() },
      dynamo
    );
  }
}

async function handleListByAssignment(caller: any, assignmentId: string) {
  if (caller.role !== "faculty" && caller.role !== "simulation_designer" && caller.role !== "admin") {
    return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Faculty/admin only" });
  }

  const assignment = await getItem(ASSIGNMENT_TABLE, { assignmentId }, dynamo);
  if (!assignment) return notFoundResponse("Assignment not found");

  // Without a course wrapping the assignment, there is no module hierarchy
  // and thus no related surveys to surface here.
  if (!assignment.courseId || !assignment.moduleItemId) {
    return createResponse(HTTP_STATUS.OK, { surveys: [] });
  }

  if (caller.role !== "admin") {
    const denied = await requireCourseInstructor(caller, assignment.courseId, dynamo);
    if (denied) return denied;
  }

  const assignmentItem = await getItem(
    MODULE_ITEM_TABLE,
    { moduleItemId: assignment.moduleItemId },
    dynamo
  );
  if (!assignmentItem) {
    return createResponse(HTTP_STATUS.OK, { surveys: [] });
  }

  // Find sibling survey/debrief items in the same module.
  const siblingsResult = await dynamo.send(
    new ScanCommand({
      TableName: MODULE_ITEM_TABLE,
      FilterExpression:
        "moduleId = :m AND (itemType = :s OR itemType = :d)",
      ExpressionAttributeValues: {
        ":m": assignmentItem.moduleId,
        ":s": "survey",
        ":d": "debrief",
      },
    })
  );
  const surveyItems = (siblingsResult.Items || []).sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );

  const surveys = await Promise.all(
    surveyItems.map(async (item: any) => {
      const instancesResult = await dynamo.send(
        new ScanCommand({
          TableName: SURVEY_INSTANCE_TABLE,
          FilterExpression: "moduleItemId = :i",
          ExpressionAttributeValues: { ":i": item.moduleItemId },
        })
      );
      const instances = (instancesResult.Items || []).map((row: any) => ({
        studentUserId: row.studentUserId,
        surveyInstanceId: row.surveyInstanceId,
        surveyTemplateId: row.surveyTemplateId,
        status: row.status,
        answers: row.answers || {},
        startedAt: row.startedAt,
        submittedAt: row.submittedAt ?? null,
        updatedAt: row.updatedAt,
      }));

      // Prefer schema from any existing instance (frozen snapshot per student).
      // If no instance exists yet, fall back to the live template for question display.
      let questions: any[] = [];
      let templateName: string | null = null;
      let templateDescription: string | null = null;
      const surveyTemplateId = item.payload?.surveyTemplateId ?? null;
      const firstInstance = instancesResult.Items?.[0];
      if (firstInstance?.schemaSnapshot) {
        questions = firstInstance.schemaSnapshot.questions || [];
        templateName = firstInstance.schemaSnapshot.name ?? null;
        templateDescription = firstInstance.schemaSnapshot.description ?? null;
      } else if (surveyTemplateId) {
        const template = await getItem(
          SURVEY_TEMPLATE_TABLE,
          { surveyTemplateId },
          dynamo
        );
        if (template) {
          questions = template.questions || [];
          templateName = template.name ?? null;
          templateDescription = template.description ?? null;
        }
      }

      return {
        moduleItemId: item.moduleItemId,
        moduleItemTitle: item.title,
        itemType: item.itemType,
        position: item.position ?? 0,
        surveyTemplateId,
        templateName,
        templateDescription,
        questions,
        instances,
      };
    })
  );

  return createResponse(HTTP_STATUS.OK, { surveys });
}

async function emitEvent(
  studentUserId: string,
  courseId: string,
  moduleId: string,
  moduleItemId: string,
  eventType: string,
  payload: Record<string, any>
) {
  if (!EVENT_LOG_TABLE) return;
  try {
    const now = new Date();
    const dateKey = now.toISOString().slice(0, 10);
    await putItem(
      EVENT_LOG_TABLE,
      {
        eventId: generateId(),
        studentUserId,
        studentDateKey: `${studentUserId}#${dateKey}`,
        courseId,
        moduleId,
        moduleItemId,
        eventType,
        payload,
        createdAt: now.toISOString(),
      },
      dynamo
    );
  } catch (e) {
    console.warn("emitEvent failed", e);
  }
}

async function handleGetForStudent(
  caller: any,
  itemId: string,
  studentUserId: string
) {
  const item = await getItem(
    MODULE_ITEM_TABLE,
    { moduleItemId: itemId },
    dynamo
  );
  if (!item) return notFoundResponse("ModuleItem not found");
  if (item.itemType !== "survey" && item.itemType !== "debrief") {
    return badRequestResponse("ModuleItem is not a survey or debrief");
  }
  const authError = await requireCourseInstructor(caller, item.courseId, dynamo);
  if (authError) return authError;

  const instance = await getItem(
    SURVEY_INSTANCE_TABLE,
    { moduleItemId: itemId, studentUserId },
    dynamo
  );
  return createResponse(HTTP_STATUS.OK, { instance: instance || null });
}
