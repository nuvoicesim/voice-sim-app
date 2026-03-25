import { defineBackend } from "@aws-amplify/backend";
import { Stack } from "aws-cdk-lib";
import {
  AuthorizationType,
  Cors,
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { CognitoIdentityProviderClient, ListUserPoolClientsCommand } from "@aws-sdk/client-cognito-identity-provider";
import { preSurveyFunction } from "./functions/pre-survey-function/resource";
import { postSurveyFunction } from "./functions/post-survey-function/resource";
import { simulationDataFunction } from "./functions/simulation-data-function/resource";
import { debriefFunction } from "./functions/debrief-function/resource";
import { cognitoUserFunction } from "./functions/cognito-user-function/resource";
import { authFunction } from "./functions/auth-function/resource";
import { downloadUrlFunction } from "./functions/download-url-function/resource";
import { llmDialogueFunction } from "./functions/llm-dialogue-function/resource";
import { llmScoringFunction } from "./functions/llm-scoring-function/resource";
import { ttsFunction } from "./functions/tts-function/resource";
import { sceneCatalogFunction } from "./functions/scene-catalog-function/resource";
import { assignmentFunction } from "./functions/assignment-function/resource";
import { sessionFunction } from "./functions/session-function/resource";
import { surveyTemplateFunction } from "./functions/survey-template-function/resource";
import { analyticsFunction } from "./functions/analytics-function/resource";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { UserPoolClient } from "aws-cdk-lib/aws-cognito";

const backend = defineBackend({
  auth,
  data,
  preSurveyFunction,
  postSurveyFunction,
  simulationDataFunction,
  debriefFunction,
  cognitoUserFunction,
  authFunction,
  downloadUrlFunction,
  llmDialogueFunction,
  llmScoringFunction,
  ttsFunction,
  sceneCatalogFunction,
  assignmentFunction,
  sessionFunction,
  surveyTemplateFunction,
  analyticsFunction,
});

// Function wrapper list
const fns = [
  backend.preSurveyFunction,
  backend.postSurveyFunction,
  backend.simulationDataFunction,
  backend.debriefFunction,
];

// Tables to inject
const tableMap = [
  backend.data.resources.tables["PreSurveyAnswers"],
  backend.data.resources.tables["PostSurveyAnswers"],
  backend.data.resources.tables["SimulationData"],
  backend.data.resources.tables["DebriefAnswers"],
];

// Assign table permissions and environment variables to each legacy function
for (let i = 0; i < fns.length; i++) {
  tableMap[i].grantReadWriteData(fns[i].resources.lambda);
  fns[i].addEnvironment("TABLE_NAME", tableMap[i].tableName);
}

// ─── New assignment-centric tables ───
const sceneCatalogTable = backend.data.resources.tables["SceneCatalog"];
const assignmentTable = backend.data.resources.tables["Assignment"];
const enrollmentTable = backend.data.resources.tables["AssignmentEnrollment"];
const sessionTable = backend.data.resources.tables["SimulationSession"];
const turnTable = backend.data.resources.tables["SessionTurn"];
const evaluationTable = backend.data.resources.tables["SessionEvaluation"];
const surveyTemplateTable = backend.data.resources.tables["SurveyTemplate"];
const surveyResponseTable = backend.data.resources.tables["AssignmentSurveyResponse"];

// Scene Catalog function
sceneCatalogTable.grantReadWriteData(backend.sceneCatalogFunction.resources.lambda);
backend.sceneCatalogFunction.addEnvironment("TABLE_NAME", sceneCatalogTable.tableName);

// Assignment function
assignmentTable.grantReadWriteData(backend.assignmentFunction.resources.lambda);
enrollmentTable.grantReadWriteData(backend.assignmentFunction.resources.lambda);
backend.assignmentFunction.addEnvironment("TABLE_NAME", assignmentTable.tableName);
backend.assignmentFunction.addEnvironment("ENROLLMENT_TABLE_NAME", enrollmentTable.tableName);

// Session function — needs access to sessions, assignments, enrollments, turns, evaluations
sessionTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
assignmentTable.grantReadData(backend.sessionFunction.resources.lambda);
enrollmentTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
turnTable.grantReadData(backend.sessionFunction.resources.lambda);
evaluationTable.grantReadData(backend.sessionFunction.resources.lambda);
backend.sessionFunction.addEnvironment("TABLE_NAME", sessionTable.tableName);
backend.sessionFunction.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
backend.sessionFunction.addEnvironment("ENROLLMENT_TABLE_NAME", enrollmentTable.tableName);
backend.sessionFunction.addEnvironment("TURN_TABLE_NAME", turnTable.tableName);
backend.sessionFunction.addEnvironment("EVALUATION_TABLE_NAME", evaluationTable.tableName);

// Survey Template function — needs templates and responses
surveyTemplateTable.grantReadWriteData(backend.surveyTemplateFunction.resources.lambda);
surveyResponseTable.grantReadWriteData(backend.surveyTemplateFunction.resources.lambda);
backend.surveyTemplateFunction.addEnvironment("TABLE_NAME", surveyTemplateTable.tableName);
backend.surveyTemplateFunction.addEnvironment("RESPONSE_TABLE_NAME", surveyResponseTable.tableName);

// Analytics function — read-only access to sessions, evaluations, assignments, survey responses
sessionTable.grantReadData(backend.analyticsFunction.resources.lambda);
evaluationTable.grantReadData(backend.analyticsFunction.resources.lambda);
assignmentTable.grantReadData(backend.analyticsFunction.resources.lambda);
surveyResponseTable.grantReadData(backend.analyticsFunction.resources.lambda);
backend.analyticsFunction.addEnvironment("SESSION_TABLE_NAME", sessionTable.tableName);
backend.analyticsFunction.addEnvironment("EVALUATION_TABLE_NAME", evaluationTable.tableName);
backend.analyticsFunction.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
backend.analyticsFunction.addEnvironment("SURVEY_RESPONSE_TABLE_NAME", surveyResponseTable.tableName);

// Grant new tables to runtime functions (llm-dialogue, llm-scoring, tts) for context resolution
const runtimeFunctions = [backend.llmDialogueFunction, backend.llmScoringFunction, backend.ttsFunction];
for (const fn of runtimeFunctions) {
  assignmentTable.grantReadData(fn.resources.lambda);
  sceneCatalogTable.grantReadData(fn.resources.lambda);
  sessionTable.grantReadData(fn.resources.lambda);
  turnTable.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
  fn.addEnvironment("SCENE_CATALOG_TABLE_NAME", sceneCatalogTable.tableName);
  fn.addEnvironment("SESSION_TABLE_NAME", sessionTable.tableName);
  fn.addEnvironment("TURN_TABLE_NAME", turnTable.tableName);
}
// Scoring also needs write to evaluation table
evaluationTable.grantReadWriteData(backend.llmScoringFunction.resources.lambda);
backend.llmScoringFunction.addEnvironment("EVALUATION_TABLE_NAME", evaluationTable.tableName);

// Grant Cognito permissions to cognito-user-function and add environment variable for USER_POOL_ID
const userPool = backend.auth.resources.userPool;
const userPoolId = userPool.userPoolId;
backend.cognitoUserFunction.addEnvironment("USER_POOL_ID", userPoolId);
backend.cognitoUserFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: [
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminUpdateUserAttributes",
      "cognito-idp:ListUsers",
    ],
    resources: [userPool.userPoolArn],
  })
);

// Grant Cognito permissions to auth-function and add environment variables
backend.authFunction.addEnvironment("USER_POOL_ID", userPoolId);

// Create App Client with USER_PASSWORD_AUTH enabled
const appClient = new UserPoolClient(userPool, "AuthAppClient", {
  userPool: userPool,
  userPoolClientName: "auth-app-client",
  generateSecret: false, // No client secret needed for public clients
  authFlows: {
    userPassword: true, // Enable USER_PASSWORD_AUTH
    userSrp: false,
    adminUserPassword: false,
    custom: false,
  },
  // Remove OAuth configuration since we don't need it for USER_PASSWORD_AUTH
});

// Set CLIENT_ID environment variable
backend.authFunction.addEnvironment("CLIENT_ID", appClient.userPoolClientId);

backend.authFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:InitiateAuth", "cognito-idp:AdminGetUser", "cognito-idp:ListUserPoolClients"],
    resources: [userPool.userPoolArn],
  })
);

// Configure download URL function for production and sandbox environments
let s3BucketName;
if (process.env.AWS_REGION === "us-east-1") {
  s3BucketName = "unity-simulation-app";
} else {
  s3BucketName = `unity-simulation-app-${process.env.AWS_REGION}`;
}

backend.downloadUrlFunction.addEnvironment("S3_BUCKET_NAME", s3BucketName);
backend.downloadUrlFunction.addEnvironment("APP_NAME", "VOICE.zip");
backend.downloadUrlFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["s3:GetObject"],
    resources: [`arn:aws:s3:::${s3BucketName}/*`],
  })
);

// Configure LLM functions environment variables
const defaultLlmAllowedOrigins = "http://localhost:3000,http://localhost:4173,http://localhost:8000,http://127.0.0.1:8000,http://localhost:5173,https://www.voice-sim.org,https://voice-sim.org";
const llmEnvShared = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  LLM_ALLOWED_ORIGINS: process.env.LLM_ALLOWED_ORIGINS ?? defaultLlmAllowedOrigins,
  LLM_UPSTREAM_RETRIES: process.env.LLM_UPSTREAM_RETRIES ?? "1",
};

for (const [key, value] of Object.entries(llmEnvShared)) {
  backend.llmDialogueFunction.addEnvironment(key, value);
  backend.llmScoringFunction.addEnvironment(key, value);
  backend.ttsFunction.addEnvironment(key, value);
}

// Dialogue gets 12s upstream timeout; scoring gets 25s (larger prompts + rubric generation)
backend.llmDialogueFunction.addEnvironment("LLM_TIMEOUT_MS", process.env.LLM_TIMEOUT_MS ?? "12000");
backend.llmScoringFunction.addEnvironment("LLM_TIMEOUT_MS", process.env.LLM_SCORING_TIMEOUT_MS ?? "25000");

backend.llmDialogueFunction.addEnvironment(
  "LLM_DIALOGUE_MODEL",
  process.env.LLM_DIALOGUE_MODEL ?? "gpt-4o"
);
backend.llmDialogueFunction.addEnvironment(
  "LLM_DIALOGUE_TEMPERATURE",
  process.env.LLM_DIALOGUE_TEMPERATURE ?? "0.7"
);
backend.llmDialogueFunction.addEnvironment(
  "LLM_DIALOGUE_MAX_OUTPUT_TOKENS",
  process.env.LLM_DIALOGUE_MAX_OUTPUT_TOKENS ?? "220"
);
backend.llmDialogueFunction.addEnvironment(
  "LLM_DIALOGUE_MAX_HISTORY",
  process.env.LLM_DIALOGUE_MAX_HISTORY ?? "20"
);
backend.llmDialogueFunction.addEnvironment(
  "LLM_MAX_INPUT_CHARS",
  process.env.LLM_MAX_INPUT_CHARS ?? "12000"
);

backend.llmScoringFunction.addEnvironment(
  "LLM_SCORING_MODEL",
  process.env.LLM_SCORING_MODEL ?? "gpt-4o"
);
backend.llmScoringFunction.addEnvironment(
  "LLM_SCORING_TEMPERATURE",
  process.env.LLM_SCORING_TEMPERATURE ?? "0.8"
);
backend.llmScoringFunction.addEnvironment(
  "LLM_SCORING_MAX_OUTPUT_TOKENS",
  process.env.LLM_SCORING_MAX_OUTPUT_TOKENS ?? "3000"
);
backend.llmScoringFunction.addEnvironment(
  "LLM_SCORING_MAX_INPUT_CHARS",
  process.env.LLM_SCORING_MAX_INPUT_CHARS ?? "50000"
);

const defaultTtsAllowedOrigins = defaultLlmAllowedOrigins;
backend.ttsFunction.addEnvironment(
  "TTS_ALLOWED_ORIGINS",
  process.env.TTS_ALLOWED_ORIGINS ?? defaultTtsAllowedOrigins
);
backend.ttsFunction.addEnvironment(
  "TTS_TIMEOUT_MS",
  process.env.TTS_TIMEOUT_MS ?? "20000"
);
backend.ttsFunction.addEnvironment(
  "TTS_MAX_INPUT_CHARS",
  process.env.TTS_MAX_INPUT_CHARS ?? "800"
);
backend.ttsFunction.addEnvironment(
  "TTS_VALIDATION_MODE",
  process.env.TTS_VALIDATION_MODE ?? "lenient"
);
backend.ttsFunction.addEnvironment(
  "ELEVENLABS_API_KEY",
  process.env.ELEVENLABS_API_KEY ?? ""
);

// create a new API stack
const apiStack = backend.createStack("api-stack");

// create a new REST API with CORS enabled
const myRestApi = new RestApi(apiStack, "RestApi", {
  restApiName: "NurseTownAPI",
  deploy: true,
  deployOptions: {
    stageName: process.env.AMPLIFY_ENV || "dev",
  },
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: [
      ...Cors.DEFAULT_HEADERS,
      "X-Request-ID",
      "x-user-id",
      "x-user-role",
      "x-user-email",
    ],
  },
});

// create Lambda integrations
const preSurveyLambdaIntegration = new LambdaIntegration(
  backend.preSurveyFunction.resources.lambda
);

const postSurveyLambdaIntegration = new LambdaIntegration(
  backend.postSurveyFunction.resources.lambda
);

const simulationDataLambdaIntegration = new LambdaIntegration(
  backend.simulationDataFunction.resources.lambda
);

const debriefLambdaIntegration = new LambdaIntegration(
  backend.debriefFunction.resources.lambda
);

const cognitoUserLambdaIntegration = new LambdaIntegration(
  backend.cognitoUserFunction.resources.lambda
);

const authLambdaIntegration = new LambdaIntegration(
  backend.authFunction.resources.lambda
);

const downloadUrlLambdaIntegration = new LambdaIntegration(
  backend.downloadUrlFunction.resources.lambda
);

const llmDialogueLambdaIntegration = new LambdaIntegration(
  backend.llmDialogueFunction.resources.lambda
);

const llmScoringLambdaIntegration = new LambdaIntegration(
  backend.llmScoringFunction.resources.lambda
);

const ttsLambdaIntegration = new LambdaIntegration(
  backend.ttsFunction.resources.lambda
);

// create a new resource path with no authorization for pre-survey
const preSurveyPath = myRestApi.root.addResource("pre-survey");
preSurveyPath.addMethod("GET", preSurveyLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});
preSurveyPath.addMethod("POST", preSurveyLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create a new resource path with no authorization for post-survey
const postSurveyPath = myRestApi.root.addResource("post-survey");
postSurveyPath.addMethod("GET", postSurveyLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});
postSurveyPath.addMethod("POST", postSurveyLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create a new resource path with no authorization for simulation-data
const simulationDataPath = myRestApi.root.addResource("simulation-data");
simulationDataPath.addMethod("GET", simulationDataLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});
simulationDataPath.addMethod("POST", simulationDataLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create a new resource path with no authorization for debrief
const debriefPath = myRestApi.root.addResource("debrief");
debriefPath.addMethod("GET", debriefLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});
debriefPath.addMethod("POST", debriefLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create a new resource path with no authorization for cognito-user
const cognitoUserPath = myRestApi.root.addResource("cognito-user");
cognitoUserPath.addMethod("GET", cognitoUserLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});
cognitoUserPath.addMethod("POST", cognitoUserLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

const cognitoUserResolvePath = cognitoUserPath.addResource("resolve");
cognitoUserResolvePath.addMethod("POST", cognitoUserLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create a new resource path with no authorization for auth
const authPath = myRestApi.root.addResource("auth");
authPath.addResource("login").addMethod("POST", authLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});
authPath.addResource("signout").addMethod("POST", authLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create a new resource path for download URL
const downloadPath = myRestApi.root.addResource("download-url");
downloadPath.addMethod("POST", downloadUrlLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create resource path for llm-dialogue
const llmDialoguePath = myRestApi.root.addResource("llm-dialogue");
llmDialoguePath.addMethod("POST", llmDialogueLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

const llmDialogueHealthPath = llmDialoguePath.addResource("health");
llmDialogueHealthPath.addMethod("GET", llmDialogueLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create resource path for llm-scoring
const llmScoringPath = myRestApi.root.addResource("llm-scoring");
llmScoringPath.addMethod("POST", llmScoringLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

const llmScoringHealthPath = llmScoringPath.addResource("health");
llmScoringHealthPath.addMethod("GET", llmScoringLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// create resource path for tts
const ttsPath = myRestApi.root.addResource("tts");
ttsPath.addMethod("POST", ttsLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

const ttsHealthPath = ttsPath.addResource("health");
ttsHealthPath.addMethod("GET", ttsLambdaIntegration, {
  authorizationType: AuthorizationType.NONE,
});

// ─── New assignment-centric API routes ───

const sceneCatalogLambdaIntegration = new LambdaIntegration(
  backend.sceneCatalogFunction.resources.lambda
);
const assignmentLambdaIntegration = new LambdaIntegration(
  backend.assignmentFunction.resources.lambda
);
const sessionLambdaIntegration = new LambdaIntegration(
  backend.sessionFunction.resources.lambda
);
const surveyTemplateLambdaIntegration = new LambdaIntegration(
  backend.surveyTemplateFunction.resources.lambda
);
const analyticsLambdaIntegration = new LambdaIntegration(
  backend.analyticsFunction.resources.lambda
);

// /scene-catalog
const sceneCatalogPath = myRestApi.root.addResource("scene-catalog");
sceneCatalogPath.addMethod("GET", sceneCatalogLambdaIntegration, { authorizationType: AuthorizationType.NONE });
sceneCatalogPath.addMethod("POST", sceneCatalogLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const sceneCatalogItemPath = sceneCatalogPath.addResource("{sceneId}");
sceneCatalogItemPath.addMethod("GET", sceneCatalogLambdaIntegration, { authorizationType: AuthorizationType.NONE });
sceneCatalogItemPath.addMethod("PUT", sceneCatalogLambdaIntegration, { authorizationType: AuthorizationType.NONE });
sceneCatalogItemPath.addMethod("DELETE", sceneCatalogLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// /assignments
const assignmentsPath = myRestApi.root.addResource("assignments");
assignmentsPath.addMethod("GET", assignmentLambdaIntegration, { authorizationType: AuthorizationType.NONE });
assignmentsPath.addMethod("POST", assignmentLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const assignmentItemPath = assignmentsPath.addResource("{assignmentId}");
assignmentItemPath.addMethod("GET", assignmentLambdaIntegration, { authorizationType: AuthorizationType.NONE });
assignmentItemPath.addMethod("PUT", assignmentLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const assignmentStatusPath = assignmentItemPath.addResource("status");
assignmentStatusPath.addMethod("PUT", assignmentLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// /assignments/{assignmentId}/sessions
const assignmentSessionsPath = assignmentItemPath.addResource("sessions");
assignmentSessionsPath.addMethod("GET", sessionLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// /sessions
const sessionsPath = myRestApi.root.addResource("sessions");
sessionsPath.addMethod("GET", sessionLambdaIntegration, { authorizationType: AuthorizationType.NONE });
sessionsPath.addMethod("POST", sessionLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const sessionItemPath = sessionsPath.addResource("{sessionId}");
sessionItemPath.addMethod("GET", sessionLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const sessionCompletePath = sessionItemPath.addResource("complete");
sessionCompletePath.addMethod("PUT", sessionLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// /sessions/{sessionId}/survey-response
const sessionSurveyPath = sessionItemPath.addResource("survey-response");
sessionSurveyPath.addMethod("POST", surveyTemplateLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// /survey-templates
const surveyTemplatesPath = myRestApi.root.addResource("survey-templates");
surveyTemplatesPath.addMethod("GET", surveyTemplateLambdaIntegration, { authorizationType: AuthorizationType.NONE });
surveyTemplatesPath.addMethod("POST", surveyTemplateLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const surveyTemplateItemPath = surveyTemplatesPath.addResource("{surveyTemplateId}");
surveyTemplateItemPath.addMethod("GET", surveyTemplateLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// /cognito-user/{userId}/role
const cognitoUserItemPath = cognitoUserPath.addResource("{userId}");
const cognitoUserRolePath = cognitoUserItemPath.addResource("role");
cognitoUserRolePath.addMethod("PUT", cognitoUserLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// /analytics
const analyticsPath = myRestApi.root.addResource("analytics");
const analyticsCohortPath = analyticsPath.addResource("cohort");
analyticsCohortPath.addMethod("GET", analyticsLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const analyticsPlatformPath = analyticsPath.addResource("platform");
analyticsPlatformPath.addMethod("GET", analyticsLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const analyticsSurveysPath = analyticsPath.addResource("surveys");
analyticsSurveysPath.addMethod("GET", analyticsLambdaIntegration, { authorizationType: AuthorizationType.NONE });
const analyticsStudentPath = analyticsPath.addResource("student");
const analyticsStudentItemPath = analyticsStudentPath.addResource("{studentUserId}");
analyticsStudentItemPath.addMethod("GET", analyticsLambdaIntegration, { authorizationType: AuthorizationType.NONE });

// add outputs to the configuration file
backend.addOutput({
  custom: {
    API: {
      [myRestApi.restApiName]: {
        endpoint: myRestApi.url,
        region: Stack.of(myRestApi).region,
        apiName: myRestApi.restApiName,
      },
    },
  },
});
