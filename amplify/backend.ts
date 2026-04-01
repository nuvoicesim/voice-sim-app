import { defineBackend } from "@aws-amplify/backend";
import { RemovalPolicy, Stack } from "aws-cdk-lib";
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  RestApi,
} from "aws-cdk-lib/aws-apigateway";
import { Distribution, PriceClass, ViewerProtocolPolicy } from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { preSurveyFunction } from "./functions/pre-survey-function/resource";
import { postSurveyFunction } from "./functions/post-survey-function/resource";
import { simulationDataFunction } from "./functions/simulation-data-function/resource";
import { debriefFunction } from "./functions/debrief-function/resource";
import { cognitoUserFunction } from "./functions/cognito-user-function/resource";
import { downloadUrlFunction } from "./functions/download-url-function/resource";
import { llmDialogueFunction } from "./functions/llm-dialogue-function/resource";
import { llmScoringFunction } from "./functions/llm-scoring-function/resource";
import { ttsFunction } from "./functions/tts-function/resource";
import { sceneCatalogFunction } from "./functions/scene-catalog-function/resource";
import { patientProfileFunction } from "./functions/patient-profile-function/resource";
import { unityBuildFunction } from "./functions/unity-build-function/resource";
import { assignmentFunction } from "./functions/assignment-function/resource";
import { sessionFunction } from "./functions/session-function/resource";
import { surveyTemplateFunction } from "./functions/survey-template-function/resource";
import { analyticsFunction } from "./functions/analytics-function/resource";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { BlockPublicAccess, Bucket, BucketEncryption, HttpMethods } from "aws-cdk-lib/aws-s3";

const backend = defineBackend({
  auth,
  data,
  preSurveyFunction,
  postSurveyFunction,
  simulationDataFunction,
  debriefFunction,
  cognitoUserFunction,
  downloadUrlFunction,
  llmDialogueFunction,
  llmScoringFunction,
  ttsFunction,
  sceneCatalogFunction,
  patientProfileFunction,
  unityBuildFunction,
  assignmentFunction,
  sessionFunction,
  surveyTemplateFunction,
  analyticsFunction,
});

const storageStack = backend.createStack("unity-storage-stack");
const unityUploadAllowedOrigins = (
  process.env.UNITY_BUILD_UPLOAD_ALLOWED_ORIGINS ??
  "https://www.voice-sim.org,https://voice-sim.org,https://sandbox.d1yrflacecv45f.amplifyapp.com"
)
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
const unityUploadAllowedHeaders = ["Content-Type"];

const unityStorageBucket = new Bucket(storageStack, "UnityStorageBucket", {
  blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
  encryption: BucketEncryption.S3_MANAGED,
  enforceSSL: true,
  removalPolicy: RemovalPolicy.RETAIN,
  cors: [
    {
      allowedOrigins: unityUploadAllowedOrigins,
      allowedMethods: [HttpMethods.GET, HttpMethods.HEAD, HttpMethods.PUT],
      allowedHeaders: unityUploadAllowedHeaders,
      exposedHeaders: ["ETag"],
      maxAge: 300,
    },
  ],
});

const unityStorageDistribution = new Distribution(storageStack, "UnityStorageDistribution", {
  comment: "Voice Sim Unity build delivery",
  defaultBehavior: {
    origin: new S3Origin(unityStorageBucket),
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
  },
  priceClass: PriceClass.PRICE_CLASS_100,
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
const patientProfileTable = backend.data.resources.tables["PatientProfile"];
const unityBuildTable = backend.data.resources.tables["UnityBuild"];
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
unityBuildTable.grantReadData(backend.sceneCatalogFunction.resources.lambda);
backend.sceneCatalogFunction.addEnvironment("UNITY_BUILD_TABLE_NAME", unityBuildTable.tableName);

// Patient Profile function
patientProfileTable.grantReadWriteData(backend.patientProfileFunction.resources.lambda);
backend.patientProfileFunction.addEnvironment("TABLE_NAME", patientProfileTable.tableName);

// Unity Build function
unityBuildTable.grantReadWriteData(backend.unityBuildFunction.resources.lambda);
backend.unityBuildFunction.addEnvironment("TABLE_NAME", unityBuildTable.tableName);

// Assignment function
assignmentTable.grantReadWriteData(backend.assignmentFunction.resources.lambda);
enrollmentTable.grantReadWriteData(backend.assignmentFunction.resources.lambda);
patientProfileTable.grantReadData(backend.assignmentFunction.resources.lambda);
sceneCatalogTable.grantReadData(backend.assignmentFunction.resources.lambda);
backend.assignmentFunction.addEnvironment("TABLE_NAME", assignmentTable.tableName);
backend.assignmentFunction.addEnvironment("ENROLLMENT_TABLE_NAME", enrollmentTable.tableName);
backend.assignmentFunction.addEnvironment("PATIENT_PROFILE_TABLE_NAME", patientProfileTable.tableName);
backend.assignmentFunction.addEnvironment("SCENE_CATALOG_TABLE_NAME", sceneCatalogTable.tableName);

// Session function — needs access to sessions, assignments, enrollments, turns, evaluations
sessionTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
assignmentTable.grantReadData(backend.sessionFunction.resources.lambda);
sceneCatalogTable.grantReadData(backend.sessionFunction.resources.lambda);
patientProfileTable.grantReadData(backend.sessionFunction.resources.lambda);
unityBuildTable.grantReadData(backend.sessionFunction.resources.lambda);
enrollmentTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
turnTable.grantReadData(backend.sessionFunction.resources.lambda);
evaluationTable.grantReadData(backend.sessionFunction.resources.lambda);
backend.sessionFunction.addEnvironment("TABLE_NAME", sessionTable.tableName);
backend.sessionFunction.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
backend.sessionFunction.addEnvironment("SCENE_CATALOG_TABLE_NAME", sceneCatalogTable.tableName);
backend.sessionFunction.addEnvironment("PATIENT_PROFILE_TABLE_NAME", patientProfileTable.tableName);
backend.sessionFunction.addEnvironment("UNITY_BUILD_TABLE_NAME", unityBuildTable.tableName);
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
  patientProfileTable.grantReadData(fn.resources.lambda);
  unityBuildTable.grantReadData(fn.resources.lambda);
  sessionTable.grantReadData(fn.resources.lambda);
  turnTable.grantReadWriteData(fn.resources.lambda);
  fn.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
  fn.addEnvironment("SCENE_CATALOG_TABLE_NAME", sceneCatalogTable.tableName);
  fn.addEnvironment("PATIENT_PROFILE_TABLE_NAME", patientProfileTable.tableName);
  fn.addEnvironment("UNITY_BUILD_TABLE_NAME", unityBuildTable.tableName);
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

for (const fn of [
  backend.assignmentFunction,
  backend.sessionFunction,
  backend.surveyTemplateFunction,
  backend.analyticsFunction,
  backend.sceneCatalogFunction,
  backend.patientProfileFunction,
  backend.unityBuildFunction,
]) {
  fn.addEnvironment("USER_POOL_ID", userPoolId);
  fn.resources.lambda.addToRolePolicy(
    new PolicyStatement({
      actions: ["cognito-idp:AdminGetUser"],
      resources: [userPool.userPoolArn],
    })
  );
}

const runtimeTokenSecret = process.env.RUNTIME_TOKEN_SECRET ?? "";
const runtimeTokenTtlSeconds = process.env.RUNTIME_TOKEN_TTL_SECONDS ?? "1800";
const unityDevBootstrapEnabled =
  process.env.UNITY_DEV_BOOTSTRAP_ENABLED ??
  ((process.env.AMPLIFY_ENV || "dev") === "prod" ? "false" : "true");
for (const fn of [
  backend.sessionFunction,
  backend.surveyTemplateFunction,
  backend.llmDialogueFunction,
  backend.llmScoringFunction,
  backend.ttsFunction,
]) {
  fn.addEnvironment("RUNTIME_TOKEN_SECRET", runtimeTokenSecret);
  fn.addEnvironment("RUNTIME_TOKEN_TTL_SECONDS", runtimeTokenTtlSeconds);
}
backend.sessionFunction.addEnvironment("UNITY_DEV_BOOTSTRAP_ENABLED", unityDevBootstrapEnabled);
backend.sessionFunction.addEnvironment("UNITY_DEV_BOOTSTRAP_KEY", process.env.UNITY_DEV_BOOTSTRAP_KEY ?? "");

// Provision managed storage for signed uploads/downloads and public Unity delivery.
const s3BucketName = unityStorageBucket.bucketName;
const unityBuildPublicBaseUrl = `https://${unityStorageDistribution.distributionDomainName}`;

backend.downloadUrlFunction.addEnvironment("S3_BUCKET_NAME", s3BucketName);
backend.downloadUrlFunction.addEnvironment("APP_NAME", "VOICE.zip");
unityStorageBucket.grantRead(backend.downloadUrlFunction.resources.lambda);
backend.unityBuildFunction.addEnvironment("S3_BUCKET_NAME", s3BucketName);
backend.unityBuildFunction.addEnvironment(
  "UNITY_BUILD_PUBLIC_BASE_URL",
  unityBuildPublicBaseUrl
);
unityStorageBucket.grantReadWrite(backend.unityBuildFunction.resources.lambda);

// Configure LLM functions environment variables
const defaultLlmAllowedOrigins = [
  "http://localhost:3000",
  "http://localhost:4173",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:5173",
  "https://www.voice-sim.org",
  "https://voice-sim.org",
  unityBuildPublicBaseUrl,
].join(",");
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
      "X-Dev-Bootstrap-Key",
    ],
  },
});

const appUserPoolAuthorizer = new CognitoUserPoolsAuthorizer(apiStack, "AppUserPoolAuthorizer", {
  cognitoUserPools: [backend.auth.resources.userPool],
});
const publicMethodOptions = { authorizationType: AuthorizationType.NONE };
const cognitoMethodOptions = {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: appUserPoolAuthorizer,
};

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
preSurveyPath.addMethod("GET", preSurveyLambdaIntegration, publicMethodOptions);
preSurveyPath.addMethod("POST", preSurveyLambdaIntegration, publicMethodOptions);

// create a new resource path with no authorization for post-survey
const postSurveyPath = myRestApi.root.addResource("post-survey");
postSurveyPath.addMethod("GET", postSurveyLambdaIntegration, publicMethodOptions);
postSurveyPath.addMethod("POST", postSurveyLambdaIntegration, publicMethodOptions);

// create a new resource path with no authorization for simulation-data
const simulationDataPath = myRestApi.root.addResource("simulation-data");
simulationDataPath.addMethod("GET", simulationDataLambdaIntegration, publicMethodOptions);
simulationDataPath.addMethod("POST", simulationDataLambdaIntegration, publicMethodOptions);

// create a new resource path with no authorization for debrief
const debriefPath = myRestApi.root.addResource("debrief");
debriefPath.addMethod("GET", debriefLambdaIntegration, publicMethodOptions);
debriefPath.addMethod("POST", debriefLambdaIntegration, publicMethodOptions);

// create a new resource path with no authorization for cognito-user
const cognitoUserPath = myRestApi.root.addResource("cognito-user");
cognitoUserPath.addMethod("GET", cognitoUserLambdaIntegration, cognitoMethodOptions);
cognitoUserPath.addMethod("POST", cognitoUserLambdaIntegration, cognitoMethodOptions);

const cognitoUserResolvePath = cognitoUserPath.addResource("resolve");
cognitoUserResolvePath.addMethod("POST", cognitoUserLambdaIntegration, cognitoMethodOptions);

// create a new resource path for download URL
const downloadPath = myRestApi.root.addResource("download-url");
downloadPath.addMethod("POST", downloadUrlLambdaIntegration, publicMethodOptions);

// create resource path for llm-dialogue
const llmDialoguePath = myRestApi.root.addResource("llm-dialogue");
llmDialoguePath.addMethod("POST", llmDialogueLambdaIntegration, publicMethodOptions);

const llmDialogueHealthPath = llmDialoguePath.addResource("health");
llmDialogueHealthPath.addMethod("GET", llmDialogueLambdaIntegration, publicMethodOptions);

// create resource path for llm-scoring
const llmScoringPath = myRestApi.root.addResource("llm-scoring");
llmScoringPath.addMethod("POST", llmScoringLambdaIntegration, publicMethodOptions);

const llmScoringHealthPath = llmScoringPath.addResource("health");
llmScoringHealthPath.addMethod("GET", llmScoringLambdaIntegration, publicMethodOptions);

// create resource path for tts
const ttsPath = myRestApi.root.addResource("tts");
ttsPath.addMethod("POST", ttsLambdaIntegration, publicMethodOptions);

const ttsHealthPath = ttsPath.addResource("health");
ttsHealthPath.addMethod("GET", ttsLambdaIntegration, publicMethodOptions);

// ─── New assignment-centric API routes ───

const sceneCatalogLambdaIntegration = new LambdaIntegration(
  backend.sceneCatalogFunction.resources.lambda
);
const patientProfileLambdaIntegration = new LambdaIntegration(
  backend.patientProfileFunction.resources.lambda
);
const unityBuildLambdaIntegration = new LambdaIntegration(
  backend.unityBuildFunction.resources.lambda
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
sceneCatalogPath.addMethod("GET", sceneCatalogLambdaIntegration, cognitoMethodOptions);
sceneCatalogPath.addMethod("POST", sceneCatalogLambdaIntegration, cognitoMethodOptions);
const sceneCatalogItemPath = sceneCatalogPath.addResource("{sceneId}");
sceneCatalogItemPath.addMethod("GET", sceneCatalogLambdaIntegration, cognitoMethodOptions);
sceneCatalogItemPath.addMethod("PUT", sceneCatalogLambdaIntegration, cognitoMethodOptions);
const sceneCatalogArchivePath = sceneCatalogItemPath.addResource("archive");
sceneCatalogArchivePath.addMethod("POST", sceneCatalogLambdaIntegration, cognitoMethodOptions);

// /patient-profiles
const patientProfilesPath = myRestApi.root.addResource("patient-profiles");
patientProfilesPath.addMethod("GET", patientProfileLambdaIntegration, cognitoMethodOptions);
patientProfilesPath.addMethod("POST", patientProfileLambdaIntegration, cognitoMethodOptions);
const patientProfileItemPath = patientProfilesPath.addResource("{patientProfileId}");
patientProfileItemPath.addMethod("GET", patientProfileLambdaIntegration, cognitoMethodOptions);
patientProfileItemPath.addMethod("PUT", patientProfileLambdaIntegration, cognitoMethodOptions);
const patientProfileArchivePath = patientProfileItemPath.addResource("archive");
patientProfileArchivePath.addMethod("POST", patientProfileLambdaIntegration, cognitoMethodOptions);

// /unity-builds
const unityBuildsPath = myRestApi.root.addResource("unity-builds");
unityBuildsPath.addMethod("GET", unityBuildLambdaIntegration, cognitoMethodOptions);
const unityBuildUploadUrlPath = unityBuildsPath.addResource("upload-url");
unityBuildUploadUrlPath.addMethod("POST", unityBuildLambdaIntegration, cognitoMethodOptions);
const unityBuildItemPath = unityBuildsPath.addResource("{unityBuildId}");
unityBuildItemPath.addMethod("GET", unityBuildLambdaIntegration, cognitoMethodOptions);
unityBuildItemPath.addMethod("PUT", unityBuildLambdaIntegration, cognitoMethodOptions);
const unityBuildItemUploadUrlPath = unityBuildItemPath.addResource("upload-url");
unityBuildItemUploadUrlPath.addMethod("POST", unityBuildLambdaIntegration, cognitoMethodOptions);
const unityBuildPublishPath = unityBuildItemPath.addResource("publish");
unityBuildPublishPath.addMethod("POST", unityBuildLambdaIntegration, cognitoMethodOptions);
const unityBuildArchivePath = unityBuildItemPath.addResource("archive");
unityBuildArchivePath.addMethod("POST", unityBuildLambdaIntegration, cognitoMethodOptions);

// /assignments
const assignmentsPath = myRestApi.root.addResource("assignments");
assignmentsPath.addMethod("GET", assignmentLambdaIntegration, cognitoMethodOptions);
assignmentsPath.addMethod("POST", assignmentLambdaIntegration, cognitoMethodOptions);
const assignmentItemPath = assignmentsPath.addResource("{assignmentId}");
assignmentItemPath.addMethod("GET", assignmentLambdaIntegration, cognitoMethodOptions);
assignmentItemPath.addMethod("PUT", assignmentLambdaIntegration, cognitoMethodOptions);
const assignmentStatusPath = assignmentItemPath.addResource("status");
assignmentStatusPath.addMethod("PUT", assignmentLambdaIntegration, cognitoMethodOptions);

// /assignments/{assignmentId}/sessions
const assignmentSessionsPath = assignmentItemPath.addResource("sessions");
assignmentSessionsPath.addMethod("GET", sessionLambdaIntegration, cognitoMethodOptions);

// /sessions
const sessionsPath = myRestApi.root.addResource("sessions");
sessionsPath.addMethod("GET", sessionLambdaIntegration, cognitoMethodOptions);
sessionsPath.addMethod("POST", sessionLambdaIntegration, cognitoMethodOptions);
const sessionDevBootstrapPath = sessionsPath.addResource("dev-bootstrap");
sessionDevBootstrapPath.addMethod("POST", sessionLambdaIntegration, publicMethodOptions);
const sessionItemPath = sessionsPath.addResource("{sessionId}");
sessionItemPath.addMethod("GET", sessionLambdaIntegration, cognitoMethodOptions);
const sessionCompletePath = sessionItemPath.addResource("complete");
sessionCompletePath.addMethod("PUT", sessionLambdaIntegration, publicMethodOptions);
const sessionRuntimeTokenPath = sessionItemPath.addResource("runtime-token");
sessionRuntimeTokenPath.addMethod("POST", sessionLambdaIntegration, cognitoMethodOptions);
const sessionTurnsPath = sessionItemPath.addResource("turns");
const sessionTurnItemPath = sessionTurnsPath.addResource("{turnIndex}");
sessionTurnItemPath.addMethod("PUT", sessionLambdaIntegration, publicMethodOptions);

// /sessions/{sessionId}/survey-response
const sessionSurveyPath = sessionItemPath.addResource("survey-response");
sessionSurveyPath.addMethod("POST", surveyTemplateLambdaIntegration, publicMethodOptions);

// /survey-templates
const surveyTemplatesPath = myRestApi.root.addResource("survey-templates");
surveyTemplatesPath.addMethod("GET", surveyTemplateLambdaIntegration, cognitoMethodOptions);
surveyTemplatesPath.addMethod("POST", surveyTemplateLambdaIntegration, cognitoMethodOptions);
const surveyTemplateItemPath = surveyTemplatesPath.addResource("{surveyTemplateId}");
surveyTemplateItemPath.addMethod("GET", surveyTemplateLambdaIntegration, cognitoMethodOptions);

// /cognito-user/{userId}/role
const cognitoUserItemPath = cognitoUserPath.addResource("{userId}");
const cognitoUserRolePath = cognitoUserItemPath.addResource("role");
cognitoUserRolePath.addMethod("PUT", cognitoUserLambdaIntegration, cognitoMethodOptions);

// /analytics
const analyticsPath = myRestApi.root.addResource("analytics");
const analyticsCohortPath = analyticsPath.addResource("cohort");
analyticsCohortPath.addMethod("GET", analyticsLambdaIntegration, cognitoMethodOptions);
const analyticsPlatformPath = analyticsPath.addResource("platform");
analyticsPlatformPath.addMethod("GET", analyticsLambdaIntegration, cognitoMethodOptions);
const analyticsSurveysPath = analyticsPath.addResource("surveys");
analyticsSurveysPath.addMethod("GET", analyticsLambdaIntegration, cognitoMethodOptions);
const analyticsStudentPath = analyticsPath.addResource("student");
const analyticsStudentItemPath = analyticsStudentPath.addResource("{studentUserId}");
analyticsStudentItemPath.addMethod("GET", analyticsLambdaIntegration, cognitoMethodOptions);

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
    UnityStorage: {
      bucketName: unityStorageBucket.bucketName,
      distributionDomainName: unityStorageDistribution.distributionDomainName,
      publicBaseUrl: unityBuildPublicBaseUrl,
    },
  },
});
