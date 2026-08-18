import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

/**
 * Cognito group used to close direct client access to EVERY model in this
 * schema. No such group is defined by this app in amplify/auth/resource.ts, so
 * ordinary app-issued tokens do not carry it. Operators must reserve it for
 * explicitly approved research administrators. It is written as a named group
 * rather than an empty rule list so the intent is explicit, and so access can
 * later be granted deliberately rather than by accident.
 *
 * WHY EVERY MODEL. Nothing in this repository calls the AppSync/GraphQL API:
 * the frontend uses aws-amplify/api (REST) only, no Lambda uses the Data
 * client or allow.resource(), and every table is reached through the REST
 * Lambdas with IAM grants wired in amplify/backend.ts. `allow.authenticated()`
 * therefore granted every signed-in student full CRUD over an entirely unused
 * surface — including course/module configuration, survey templates, gating,
 * per-student progress, consent records, and other students' answers. Closing
 * it removes that surface without changing any code path in use.
 *
 * IMPORTANT: this only closes the AppSync/GraphQL surface. Lambdas are
 * unaffected — they reach these tables through direct DynamoDB SDK calls with
 * IAM grants wired in amplify/backend.ts, never through the Data client.
 *
 * NOTE: this does not by itself prevent role escalation. `custom:role` is
 * declared mutable in amplify/auth/resource.ts and the REST layer derives
 * caller authority from that claim; whether the deployed Cognito app client
 * lets a user write it is a separate launch-time verification item.
 */
const RESEARCH_ADMIN_GROUP = "research-admin";

const schema = a.schema({
  // ─── Legacy tables (kept for backward compatibility) ───

  PreSurveyAnswers: a
    .model({
      userID: a.string().required(),
      answers: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["userID"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  PostSurveyAnswers: a
    .model({
      userID: a.string().required(),
      answers: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["userID"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  SimulationData: a
    .model({
      userID: a.string().required(),
      simulationLevel: a.integer().required(),
      chatHistory: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["userID", "simulationLevel"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  DebriefAnswers: a
    .model({
      userID: a.string().required(),
      simulationLevel: a.integer().required(),
      answers: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["userID", "simulationLevel"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  // ─── New assignment-centric tables ───

  SceneCatalog: a
    .model({
      sceneId: a.string().required(),
      scenarioKey: a.string().required(),
      title: a.string().required(),
      description: a.string(),
      difficulty: a.string(),
      tags: a.json(),
      unityBuildId: a.string(),
      unityBuildFolder: a.string(),
      // Optional array<string> of canonical progressKey values that MUST be
      // completed for this scene to be considered fully done. Used by the
      // session-function task-progress complete handler to auto-complete the
      // whole SimulationSession (and the linked StudentItemProgress) once all
      // required internal tasks have been recorded as completed. Each entry
      // follows the same format the task-progress handler validates:
      //   `${phaseId}#${taskId || sectionId}`
      // Examples:
      //   ["phase1#phase1-section-c", "phase1#phase1-section-d"]
      //   ["phase2#phase2-ben-object-naming", "phase2#phase2-ben-sentence-completion"]
      // When absent, null, empty, or malformed, auto-completion is skipped.
      requiredTaskKeys: a.json(),
      isActive: a.boolean().required(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["sceneId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  Assignment: a
    .model({
      assignmentId: a.string().required(),
      sceneId: a.string().required(),
      patientProfileId: a.string().required(),
      title: a.string().required(),
      description: a.string(),
      mode: a.enum(["practice", "assessment"]),
      attemptPolicy: a.json(),
      surveyPolicy: a.json(),
      dueDate: a.string(),
      targetType: a.enum(["cohort", "group", "student"]),
      targetId: a.string(),
      status: a.enum(["draft", "published", "archived"]),
      createdBy: a.string().required(),
      // ── Course integration (added with Canvas-like LMS feature) ──
      courseId: a.string(),
      moduleItemId: a.string(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["assignmentId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  PatientProfile: a
    .model({
      patientProfileId: a.string().required(),
      displayName: a.string().required(),
      profileKey: a.string().required(),
      dialogueConfig: a.json().required(),
      scoringConfig: a.json().required(),
      ttsConfig: a.json().required(),
      status: a.enum(["draft", "published", "archived"]),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["patientProfileId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  UnityBuild: a
    .model({
      unityBuildId: a.string().required(),
      displayName: a.string().required(),
      buildKey: a.string().required(),
      sourceZipKey: a.string().required(),
      sourceFileName: a.string().required(),
      entryHtml: a.string().required(),
      publishedPrefix: a.string(),
      publicBaseUrl: a.string(),
      launchUrl: a.string(),
      status: a.enum(["uploaded", "published", "archived", "failed"]),
      publishedAt: a.string(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["unityBuildId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  AssignmentEnrollment: a
    .model({
      assignmentId: a.string().required(),
      studentUserId: a.string().required(),
      deliveryStatus: a.enum(["assigned", "in_progress", "completed"]),
      startedAt: a.string(),
      completedAt: a.string(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["assignmentId", "studentUserId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  SimulationSession: a
    .model({
      sessionId: a.string().required(),
      assignmentId: a.string().required(),
      studentUserId: a.string().required(),
      attemptNo: a.integer().required(),
      mode: a.string().required(),
      status: a.enum(["active", "completed", "abandoned"]),
      startedAt: a.string().required(),
      endedAt: a.string(),
      createdAt: a.string().required(),
    })
    .identifier(["sessionId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  SessionTurn: a
    .model({
      sessionId: a.string().required(),
      turnIndex: a.integer().required(),
      userText: a.string(),
      modelText: a.string(),
      userSpeechStartAt: a.string(),
      patientSpeechStartAt: a.string(),
      emotionCode: a.integer(),
      motionCode: a.integer(),
      latencyMs: a.integer(),
      timestamp: a.string().required(),
      // Research-grade transcript metadata. All optional; old rows
      // without these columns remain valid. Persisted by /llm-dialogue
      // when the Unity request supplies them. Not consulted by the
      // course-unlock chain (SessionTaskProgress / requiredTaskKeys /
      // SimulationSession / StudentItemProgress paths do not read
      // SessionTurn) so this addition is safe to land independently
      // from the Unity payload PR.
      assignmentId: a.string(),
      phaseId: a.string(),
      taskId: a.string(),
      sectionId: a.string(),
      taskType: a.string(),
      progressKey: a.string(),
      itemId: a.string(),
      itemLabel: a.string(),
      patientPersonaId: a.string(),
      clientTurnIndex: a.integer(),
      cueMetadata: a.json(),
    })
    .identifier(["sessionId", "turnIndex"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  SessionEvaluation: a
    .model({
      sessionId: a.string().required(),
      totalScore: a.float(),
      performanceLevel: a.string(),
      rubric: a.json(),
      responseTimeAvgSec: a.float(),
      overallExplanation: a.string(),
      createdAt: a.string().required(),
    })
    .identifier(["sessionId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  SessionTaskProgress: a
    .model({
      progressId: a.string().required(),
      sessionId: a.string().required(),
      progressKey: a.string().required(),
      assignmentId: a.string().required(),
      studentUserId: a.string().required(),
      phaseId: a.string().required(),
      sectionId: a.string(),
      taskId: a.string(),
      taskType: a.string(),
      state: a.string().required(),
      completedAt: a.string().required(),
      latestEvidenceId: a.string(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["progressId"])
    .secondaryIndexes((index) => [
      index("sessionId").sortKeys(["progressKey"]).name("bySessionProgressKey"),
    ])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  SurveyTemplate: a
    .model({
      surveyTemplateId: a.string().required(),
      name: a.string().required(),
      description: a.string(),
      questions: a.json().required(),
      ownerRole: a.string(),
      // Faculty owner of the template (faculty-private library); null = legacy/system template.
      ownerFacultyId: a.string(),
      isActive: a.boolean().required(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["surveyTemplateId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  AssignmentSurveyResponse: a
    .model({
      assignmentId: a.string().required(),
      responseKey: a.string().required(),
      sessionId: a.string().required(),
      studentUserId: a.string().required(),
      surveyTemplateId: a.string().required(),
      answers: a.json(),
      submittedAt: a.string(),
      completionStatus: a.enum(["pending", "completed", "skipped"]),
    })
    .identifier(["assignmentId", "responseKey"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  // ─── Canvas-like LMS additions ───

  Course: a
    .model({
      courseId: a.string().required(),
      ownerFacultyId: a.string().required(),
      title: a.string().required(),
      description: a.string(),
      status: a.enum(["draft", "published", "archived"]),
      // {groups:[{key,label,weight?}], strategy:"uniform"|"weighted"} or empty
      groupConfig: a.json(),
      // When true and status="published", every authenticated student can see
      // and access this course without an explicit CourseEnrollment row.
      isDefault: a.boolean(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["courseId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  CourseInstructor: a
    .model({
      courseId: a.string().required(),
      facultyUserId: a.string().required(),
      // owner / co_teacher = the two professors actually teaching the course
      // coordinator = a simulation_designer who set up the course but isn't a professor
      role: a.enum(["owner", "co_teacher", "coordinator"]),
      addedAt: a.string().required(),
      addedBy: a.string().required(),
    })
    .identifier(["courseId", "facultyUserId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  CourseEnrollment: a
    .model({
      courseId: a.string().required(),
      studentUserId: a.string().required(),
      studentEmail: a.string(),
      enrolledAt: a.string().required(),
      enrolledBy: a.string(),
      status: a.enum(["active", "removed"]),
    })
    .identifier(["courseId", "studentUserId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  Module: a
    .model({
      moduleId: a.string().required(),
      courseId: a.string().required(),
      title: a.string().required(),
      description: a.string(),
      position: a.integer().required(),
      // {kind:"open"} | {kind:"after_module", moduleId}
      gating: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["moduleId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  ModuleItem: a
    .model({
      moduleItemId: a.string().required(),
      moduleId: a.string().required(),
      courseId: a.string().required(),
      itemType: a.enum([
        "assignment",
        "survey",
        "external_link",
        "debrief",
        "instruction",
        "randomizer",
        "reveal_trigger",
        "ai_detection",
        "consent",
      ]),
      title: a.string().required(),
      position: a.integer().required(),
      // see plan §ModuleItem.gating
      gating: a.json(),
      // type-specific config (assignmentId / surveyTemplateId / url / markdown / etc)
      payload: a.json().required(),
      // {kind:"manual_check"|"auto_on_submit"|"auto_on_link_open"|"all_required_fields"}
      completionRule: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["moduleItemId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  // Client-side GraphQL access is intentionally closed (see ReviewerFeedback
  // note below for the full rationale). `allow.authenticated()` would let any
  // signed-in student read/modify EVERY other student's survey answers through
  // the AppSync endpoint. All legitimate access goes through
  // survey-instance-function over REST, which scopes every read and write to
  // the calling student. No frontend or Lambda code uses the Data/GraphQL
  // client for this model.
  SurveyInstance: a
    .model({
      moduleItemId: a.string().required(),
      studentUserId: a.string().required(),
      surveyInstanceId: a.string().required(),
      surveyTemplateId: a.string().required(),
      courseId: a.string().required(),
      // Frozen at first open: students see this snapshot, immune to template edits.
      schemaSnapshot: a.json().required(),
      // Free-form record per question id.
      answers: a.json(),
      status: a.enum(["in_progress", "submitted"]),
      startedAt: a.string().required(),
      submittedAt: a.string(),
      updatedAt: a.string().required(),
    })
    .identifier(["moduleItemId", "studentUserId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  StudentItemProgress: a
    .model({
      moduleItemId: a.string().required(),
      studentUserId: a.string().required(),
      courseId: a.string().required(),
      moduleId: a.string().required(),
      state: a.enum(["locked", "unlocked", "in_progress", "completed"]),
      unlockedAt: a.string(),
      startedAt: a.string(),
      completedAt: a.string(),
      manualCheckedAt: a.string(),
      // For itemType=assignment: best-attempt cache.
      bestSessionId: a.string(),
      bestSessionScore: a.float(),
      // For itemType=ai_detection: list of assignmentItemIds with sub-question unlocked.
      unlockedSubKeys: a.json(),
      // For itemType=external_link: student-uploaded screenshot URLs (max 2).
      submissionImageUrls: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["moduleItemId", "studentUserId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  StudentGroupAssignment: a
    .model({
      courseId: a.string().required(),
      studentUserId: a.string().required(),
      // Usually courseId; the scope for which this group choice applies.
      scopeKey: a.string().required(),
      groupKey: a.string().required(),
      assignedByItemId: a.string(),
      assignedAt: a.string().required(),
    })
    .identifier(["courseId", "studentUserId", "scopeKey"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  ReviewerAssignment: a
    .model({
      moduleItemId: a.string().required(),
      reviewerUserId: a.string().required(),
      studentUserId: a.string().required(),
      displayLabel: a.string(),
      createdAt: a.string().required(),
    })
    .identifier(["moduleItemId", "reviewerUserId", "studentUserId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  // BLINDING-CRITICAL MODEL.
  //
  // This table holds the true AI-vs-faculty source of every Phase 3 feedback
  // card. Under the previous `allow.authenticated()` rule any signed-in student
  // could call the AppSync endpoint directly (its URL ships in the browser
  // bundle via amplify_outputs.json) and run `listReviewerFeedbacks` to read
  // every participant's source mapping before the reveal — or mutate `revealed`
  // / `body` / delete rows outright. That defeats the Phase 3 blind design no
  // matter what the Lambda layer strips, so client access is closed entirely.
  //
  // Owner-based auth is deliberately NOT used: it would still let a student read
  // `source` on their own three rows, which is precisely the value being hidden
  // until the reveal gate fires.
  //
  // Legitimate reads reach students only through survey-instance-function, which
  // projects a blind-safe view (see phase3-cards.ts). Seeding is done by
  // scripts/seed-phase3.mjs using direct DynamoDB access with AWS credentials.
  ReviewerFeedback: a
    .model({
      feedbackId: a.string().required(),
      moduleItemId: a.string().required(),
      studentUserId: a.string().required(),
      source: a.enum(["ai", "reviewer"]),
      // null when source = "ai", and also null for Phase 3 rows: the two Phase 3
      // faculty reviewers score outside VOICE and have no VOICE account.
      reviewerUserId: a.string(),
      // "Source 1/2/3" in the legacy blinded mode. For Phase 3 this carries the
      // internal true label ("AI" / "Faculty 1" / "Faculty 2") and is NEVER
      // projected to students — not even after the reveal, which discloses only
      // "AI-generated" vs "Faculty-generated".
      displayLabel: a.string(),
      body: a.string().required(),
      // 1-7 (rounded from AI 8-24 totalScore for AI rows). Unused by Phase 3.
      score: a.integer(),
      basedOnSessionId: a.string(),
      // false until reveal_trigger fires; ai_detection keeps locked but unrevealed.
      revealed: a.boolean().required(),
      // Frozen by ai_detection submission so reviewer cannot edit afterward.
      locked: a.boolean().required(),

      // ── Phase 3 additions (all optional; legacy rows stay valid, no migration) ──
      // Frozen D1-D3 rubric scores as strings so "N/A" is representable
      // alongside "1".."4": {"d1":"3","d2":"N/A","d3":"4"}. VOICE never computes
      // these — they arrive already scored and QA'd from outside the system.
      dimensionScores: a.json(),
      // Frozen display position "A" | "B" | "C". The A/B/C-to-source
      // counterbalancing is assigned by the research team before launch with a
      // documented seed; VOICE never re-randomizes at runtime.
      displayKey: a.string(),
      // sha256 over the canonical NUL-delimited D1/D2/D3/narrative form, written at seed time
      // so the artifact shown to a student can be verified against the frozen
      // external source (scripts/seed-phase3.mjs --verify).
      contentHash: a.string(),

      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["feedbackId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  EventLog: a
    .model({
      eventId: a.string().required(),
      studentUserId: a.string().required(),
      // YYYY-MM-DD prefix `${studentUserId}#${date}` enables future GSI without writer change.
      studentDateKey: a.string().required(),
      courseId: a.string(),
      moduleId: a.string(),
      moduleItemId: a.string(),
      eventType: a.string().required(),
      payload: a.json(),
      createdAt: a.string().required(),
    })
    .identifier(["eventId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  MigrationLog: a
    .model({
      migrationName: a.string().required(),
      version: a.string().required(),
      completedAt: a.string().required(),
      meta: a.json(),
    })
    .identifier(["migrationName"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  // Permanent IRB-style record of a student's consent decision for a consent
  // ModuleItem. One row per (consent item, student); upsert on change-of-mind.
  // bodySnapshot captures the markdown text that was actually shown at decision
  // time so we can prove what the student saw even if faculty edits the consent later.
  ConsentDecision: a
    .model({
      consentItemId: a.string().required(),
      studentUserId: a.string().required(),
      courseId: a.string().required(),
      decision: a.enum(["agreed", "declined"]),
      consentVersion: a.string(),
      bodySnapshot: a.string(),
      decidedAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["consentItemId", "studentUserId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),

  // VOICE user-study raw evidence rows, written by llm-scoring-function for
  // both Phase 1 rubric submissions and Phase 2 training submissions. The full
  // original Unity request body is preserved as rawEvidencePayload so future
  // Phase 3 debrief reuse and future Phase 2 cue telemetry land here without
  // schema migration. Normalized lookup columns mirror the most-queried
  // identifiers.
  SessionEvidence: a
    .model({
      evidenceId: a.string().required(),
      sessionId: a.string().required(),
      assignmentId: a.string().required(),
      studentUserId: a.string().required(),
      phaseId: a.string().required(),
      taskType: a.string(),
      sectionId: a.string(),
      taskId: a.string(),
      itemId: a.string(),
      patientProfileId: a.string(),
      feedbackUse: a.string(),
      scoringMode: a.string(),
      promptVersion: a.string(),
      rawEvidencePayload: a.json().required(),
      rubricAssessmentPayload: a.json(),
      submittedAt: a.string().required(),
      createdAt: a.string().required(),
    })
    .identifier(["evidenceId"])
    .authorization((allow) => [allow.group(RESEARCH_ADMIN_GROUP)]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
