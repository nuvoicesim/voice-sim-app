import { type ClientSchema, a, defineData } from "@aws-amplify/backend";

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
    .authorization((allow) => [allow.authenticated()]),

  PostSurveyAnswers: a
    .model({
      userID: a.string().required(),
      answers: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["userID"])
    .authorization((allow) => [allow.authenticated()]),

  SimulationData: a
    .model({
      userID: a.string().required(),
      simulationLevel: a.integer().required(),
      chatHistory: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["userID", "simulationLevel"])
    .authorization((allow) => [allow.authenticated()]),

  DebriefAnswers: a
    .model({
      userID: a.string().required(),
      simulationLevel: a.integer().required(),
      answers: a.json(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["userID", "simulationLevel"])
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    })
    .identifier(["sessionId", "turnIndex"])
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["moduleItemId", "studentUserId"])
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

  ReviewerAssignment: a
    .model({
      moduleItemId: a.string().required(),
      reviewerUserId: a.string().required(),
      studentUserId: a.string().required(),
      displayLabel: a.string(),
      createdAt: a.string().required(),
    })
    .identifier(["moduleItemId", "reviewerUserId", "studentUserId"])
    .authorization((allow) => [allow.authenticated()]),

  ReviewerFeedback: a
    .model({
      feedbackId: a.string().required(),
      moduleItemId: a.string().required(),
      studentUserId: a.string().required(),
      source: a.enum(["ai", "reviewer"]),
      // null when source = "ai".
      reviewerUserId: a.string(),
      // "Source 1/2/3" used in blinded mode.
      displayLabel: a.string(),
      body: a.string().required(),
      // 1-7 (rounded from AI 8-24 totalScore for AI rows).
      score: a.integer(),
      basedOnSessionId: a.string(),
      // false until reveal_trigger fires; ai_detection keeps locked but unrevealed.
      revealed: a.boolean().required(),
      // Frozen by ai_detection submission so reviewer cannot edit afterward.
      locked: a.boolean().required(),
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["feedbackId"])
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

  MigrationLog: a
    .model({
      migrationName: a.string().required(),
      version: a.string().required(),
      completedAt: a.string().required(),
      meta: a.json(),
    })
    .identifier(["migrationName"])
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),

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
    .authorization((allow) => [allow.authenticated()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
