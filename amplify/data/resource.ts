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
      createdAt: a.string().required(),
      updatedAt: a.string().required(),
    })
    .identifier(["assignmentId"])
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

  SurveyTemplate: a
    .model({
      surveyTemplateId: a.string().required(),
      name: a.string().required(),
      questions: a.json().required(),
      ownerRole: a.string(),
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
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});