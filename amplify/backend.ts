import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineBackend } from "@aws-amplify/backend";
import { RemovalPolicy, Stack } from "aws-cdk-lib";

// Load .env.local (and .env as a fallback) from the repo root before any
// process.env reads below. Explicit shell env vars always win, so CI/Amplify
// Hosting can still inject overrides. The files are gitignored — see README.
function loadDotEnv(filename: string) {
  const path = resolve(process.cwd(), filename);
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}
loadDotEnv(".env.local");
loadDotEnv(".env");
import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  Cors,
  LambdaIntegration,
  ResponseType,
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
// Course-LMS feature functions:
import { courseFunction } from "./functions/course-function/resource";
import { moduleFunction } from "./functions/module-function/resource";
import { moduleItemFunction } from "./functions/module-item-function/resource";
import { surveyInstanceFunction } from "./functions/survey-instance-function/resource";
import { eventLogFunction } from "./functions/event-log-function/resource";
import { migrationFunction } from "./functions/migration-function/resource";
import { moduleAssetFunction } from "./functions/module-asset-function/resource";
import { auth } from "./auth/resource";
import { data } from "./data/resource";
import { type IGrantable, PolicyStatement } from "aws-cdk-lib/aws-iam";
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
  courseFunction,
  moduleFunction,
  moduleItemFunction,
  surveyInstanceFunction,
  eventLogFunction,
  migrationFunction,
  moduleAssetFunction,
});

const storageStack = backend.createStack("unity-storage-stack");
const unityUploadAllowedOrigins = (
  process.env.UNITY_BUILD_UPLOAD_ALLOWED_ORIGINS ??
  "https://www.voice-sim.org,https://voice-sim.org,https://sandbox.d1yrflacecv45f.amplifyapp.com,http://localhost:5173,http://localhost:5174,http://localhost:4173"
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
const sessionTaskProgressTable = backend.data.resources.tables["SessionTaskProgress"];
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
turnTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
evaluationTable.grantReadData(backend.sessionFunction.resources.lambda);
sessionTaskProgressTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
backend.sessionFunction.addEnvironment("TABLE_NAME", sessionTable.tableName);
backend.sessionFunction.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
backend.sessionFunction.addEnvironment("SCENE_CATALOG_TABLE_NAME", sceneCatalogTable.tableName);
backend.sessionFunction.addEnvironment("PATIENT_PROFILE_TABLE_NAME", patientProfileTable.tableName);
backend.sessionFunction.addEnvironment("UNITY_BUILD_TABLE_NAME", unityBuildTable.tableName);
backend.sessionFunction.addEnvironment("ENROLLMENT_TABLE_NAME", enrollmentTable.tableName);
backend.sessionFunction.addEnvironment("TURN_TABLE_NAME", turnTable.tableName);
backend.sessionFunction.addEnvironment("EVALUATION_TABLE_NAME", evaluationTable.tableName);
backend.sessionFunction.addEnvironment(
  "SESSION_TASK_PROGRESS_TABLE_NAME",
  sessionTaskProgressTable.tableName
);
backend.sessionFunction.addEnvironment(
  "SESSION_TASK_PROGRESS_BY_SESSION_INDEX_NAME",
  "bySessionProgressKey"
);

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

// ─── Canvas-like LMS tables ───
const courseTable = backend.data.resources.tables["Course"];
const courseInstructorTable = backend.data.resources.tables["CourseInstructor"];
const courseEnrollmentTable = backend.data.resources.tables["CourseEnrollment"];
const moduleTable = backend.data.resources.tables["Module"];
const moduleItemTable = backend.data.resources.tables["ModuleItem"];
const surveyInstanceTable = backend.data.resources.tables["SurveyInstance"];
const studentItemProgressTable = backend.data.resources.tables["StudentItemProgress"];
const studentGroupAssignmentTable = backend.data.resources.tables["StudentGroupAssignment"];
const reviewerAssignmentTable = backend.data.resources.tables["ReviewerAssignment"];
const reviewerFeedbackTable = backend.data.resources.tables["ReviewerFeedback"];
const eventLogTable = backend.data.resources.tables["EventLog"];
const migrationLogTable = backend.data.resources.tables["MigrationLog"];
const consentDecisionTable = backend.data.resources.tables["ConsentDecision"];
const sessionEvidenceTable = backend.data.resources.tables["SessionEvidence"];

// Helper: attach common course-auth env vars to a function so requireCourseInstructor/etc. work.
type BackendFunctionLike = {
  addEnvironment(name: string, value: string): void;
  resources: { lambda: IGrantable };
};

function attachCourseAuthEnv(fn: BackendFunctionLike) {
  fn.addEnvironment("COURSE_TABLE_NAME", courseTable.tableName);
  fn.addEnvironment("COURSE_INSTRUCTOR_TABLE_NAME", courseInstructorTable.tableName);
  fn.addEnvironment("COURSE_ENROLLMENT_TABLE_NAME", courseEnrollmentTable.tableName);
  fn.addEnvironment("MODULE_TABLE_NAME", moduleTable.tableName);
  fn.addEnvironment("MODULE_ITEM_TABLE_NAME", moduleItemTable.tableName);
  fn.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
  fn.addEnvironment("SESSION_TABLE_NAME", sessionTable.tableName);
}
function grantCourseAuthReadTables(fn: BackendFunctionLike) {
  courseTable.grantReadData(fn.resources.lambda);
  courseInstructorTable.grantReadData(fn.resources.lambda);
  courseEnrollmentTable.grantReadData(fn.resources.lambda);
}

// course-function — RW course/instructor/enrollment.
// USER_POOL_ID env + cognito-idp:AdminGetUser are added by the loop below; we add
// the extra cognito-idp:ListUsers here for email -> sub resolution.
courseTable.grantReadWriteData(backend.courseFunction.resources.lambda);
courseInstructorTable.grantReadWriteData(backend.courseFunction.resources.lambda);
courseEnrollmentTable.grantReadWriteData(backend.courseFunction.resources.lambda);
studentGroupAssignmentTable.grantReadData(backend.courseFunction.resources.lambda);
backend.courseFunction.addEnvironment(
  "STUDENT_GROUP_ASSIGNMENT_TABLE_NAME",
  studentGroupAssignmentTable.tableName
);
studentItemProgressTable.grantReadData(backend.courseFunction.resources.lambda);
backend.courseFunction.addEnvironment(
  "STUDENT_ITEM_PROGRESS_TABLE_NAME",
  studentItemProgressTable.tableName
);
attachCourseAuthEnv(backend.courseFunction);
backend.courseFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:ListUsers"],
    resources: [backend.auth.resources.userPool.userPoolArn],
  })
);

// module-function — RW Module, R Course/CourseInstructor, RW ModuleItem (cascade delete)
moduleTable.grantReadWriteData(backend.moduleFunction.resources.lambda);
moduleItemTable.grantReadWriteData(backend.moduleFunction.resources.lambda);
grantCourseAuthReadTables(backend.moduleFunction);
attachCourseAuthEnv(backend.moduleFunction);

// module-item-function — RW ModuleItem/StudentItemProgress/StudentGroupAssignment/ReviewerAssignment/ReviewerFeedback
moduleItemTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
studentItemProgressTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
studentGroupAssignmentTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
reviewerAssignmentTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
reviewerFeedbackTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
surveyInstanceTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
eventLogTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
moduleTable.grantReadData(backend.moduleItemFunction.resources.lambda);
assignmentTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
sessionTable.grantReadData(backend.moduleItemFunction.resources.lambda);
turnTable.grantReadData(backend.moduleItemFunction.resources.lambda);
evaluationTable.grantReadData(backend.moduleItemFunction.resources.lambda);
grantCourseAuthReadTables(backend.moduleItemFunction);
attachCourseAuthEnv(backend.moduleItemFunction);
backend.moduleItemFunction.addEnvironment(
  "STUDENT_ITEM_PROGRESS_TABLE_NAME",
  studentItemProgressTable.tableName
);
backend.moduleItemFunction.addEnvironment(
  "STUDENT_GROUP_ASSIGNMENT_TABLE_NAME",
  studentGroupAssignmentTable.tableName
);
backend.moduleItemFunction.addEnvironment(
  "REVIEWER_ASSIGNMENT_TABLE_NAME",
  reviewerAssignmentTable.tableName
);
backend.moduleItemFunction.addEnvironment(
  "REVIEWER_FEEDBACK_TABLE_NAME",
  reviewerFeedbackTable.tableName
);
backend.moduleItemFunction.addEnvironment(
  "SURVEY_INSTANCE_TABLE_NAME",
  surveyInstanceTable.tableName
);
backend.moduleItemFunction.addEnvironment("TURN_TABLE_NAME", turnTable.tableName);
backend.moduleItemFunction.addEnvironment("EVALUATION_TABLE_NAME", evaluationTable.tableName);
backend.moduleItemFunction.addEnvironment("EVENT_LOG_TABLE_NAME", eventLogTable.tableName);
// Consent decisions (3 new routes live in module-item-function):
consentDecisionTable.grantReadWriteData(backend.moduleItemFunction.resources.lambda);
backend.moduleItemFunction.addEnvironment(
  "CONSENT_DECISION_TABLE_NAME",
  consentDecisionTable.tableName
);

// survey-instance-function — RW SurveyInstance, R/W ReviewerFeedback (reveal flips), R SurveyTemplate
surveyInstanceTable.grantReadWriteData(backend.surveyInstanceFunction.resources.lambda);
reviewerFeedbackTable.grantReadWriteData(backend.surveyInstanceFunction.resources.lambda);
surveyTemplateTable.grantReadData(backend.surveyInstanceFunction.resources.lambda);
moduleItemTable.grantReadData(backend.surveyInstanceFunction.resources.lambda);
// Faculty roster endpoint reads Assignment to resolve courseId / wrapping moduleItemId.
assignmentTable.grantReadData(backend.surveyInstanceFunction.resources.lambda);
studentItemProgressTable.grantReadWriteData(backend.surveyInstanceFunction.resources.lambda);
eventLogTable.grantReadWriteData(backend.surveyInstanceFunction.resources.lambda);
grantCourseAuthReadTables(backend.surveyInstanceFunction);
attachCourseAuthEnv(backend.surveyInstanceFunction);
backend.surveyInstanceFunction.addEnvironment(
  "SURVEY_INSTANCE_TABLE_NAME",
  surveyInstanceTable.tableName
);
backend.surveyInstanceFunction.addEnvironment(
  "SURVEY_TEMPLATE_TABLE_NAME",
  surveyTemplateTable.tableName
);
backend.surveyInstanceFunction.addEnvironment(
  "REVIEWER_FEEDBACK_TABLE_NAME",
  reviewerFeedbackTable.tableName
);
backend.surveyInstanceFunction.addEnvironment(
  "STUDENT_ITEM_PROGRESS_TABLE_NAME",
  studentItemProgressTable.tableName
);
backend.surveyInstanceFunction.addEnvironment("EVENT_LOG_TABLE_NAME", eventLogTable.tableName);
// Consent hard-gate on survey instance access:
consentDecisionTable.grantReadData(backend.surveyInstanceFunction.resources.lambda);
backend.surveyInstanceFunction.addEnvironment(
  "CONSENT_DECISION_TABLE_NAME",
  consentDecisionTable.tableName
);

// event-log-function — RW EventLog, R Course/CourseEnrollment for auth
eventLogTable.grantReadWriteData(backend.eventLogFunction.resources.lambda);
grantCourseAuthReadTables(backend.eventLogFunction);
attachCourseAuthEnv(backend.eventLogFunction);
backend.eventLogFunction.addEnvironment("EVENT_LOG_TABLE_NAME", eventLogTable.tableName);

// migration-function — RW everything new + Assignment + read SimulationSession/SessionEvaluation
courseTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
courseInstructorTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
courseEnrollmentTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
moduleTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
moduleItemTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
studentItemProgressTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
migrationLogTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
assignmentTable.grantReadWriteData(backend.migrationFunction.resources.lambda);
enrollmentTable.grantReadData(backend.migrationFunction.resources.lambda);
sessionTable.grantReadData(backend.migrationFunction.resources.lambda);
evaluationTable.grantReadData(backend.migrationFunction.resources.lambda);
backend.migrationFunction.addEnvironment("ASSIGNMENT_TABLE_NAME", assignmentTable.tableName);
backend.migrationFunction.addEnvironment("ENROLLMENT_TABLE_NAME", enrollmentTable.tableName);
backend.migrationFunction.addEnvironment("SESSION_TABLE_NAME", sessionTable.tableName);
backend.migrationFunction.addEnvironment("EVALUATION_TABLE_NAME", evaluationTable.tableName);
backend.migrationFunction.addEnvironment("COURSE_TABLE_NAME", courseTable.tableName);
backend.migrationFunction.addEnvironment(
  "COURSE_INSTRUCTOR_TABLE_NAME",
  courseInstructorTable.tableName
);
backend.migrationFunction.addEnvironment(
  "COURSE_ENROLLMENT_TABLE_NAME",
  courseEnrollmentTable.tableName
);
backend.migrationFunction.addEnvironment("MODULE_TABLE_NAME", moduleTable.tableName);
backend.migrationFunction.addEnvironment("MODULE_ITEM_TABLE_NAME", moduleItemTable.tableName);
backend.migrationFunction.addEnvironment(
  "STUDENT_ITEM_PROGRESS_TABLE_NAME",
  studentItemProgressTable.tableName
);
backend.migrationFunction.addEnvironment(
  "MIGRATION_LOG_TABLE_NAME",
  migrationLogTable.tableName
);

// Extend session-function with course-LMS env (needed for the markCourseProgressCompleted hook).
moduleItemTable.grantReadData(backend.sessionFunction.resources.lambda);
studentItemProgressTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
eventLogTable.grantReadWriteData(backend.sessionFunction.resources.lambda);
backend.sessionFunction.addEnvironment("MODULE_ITEM_TABLE_NAME", moduleItemTable.tableName);
backend.sessionFunction.addEnvironment(
  "STUDENT_ITEM_PROGRESS_TABLE_NAME",
  studentItemProgressTable.tableName
);
backend.sessionFunction.addEnvironment("EVENT_LOG_TABLE_NAME", eventLogTable.tableName);

// Extend llm-scoring-function to mirror AI feedback into ReviewerFeedback after writing SessionEvaluation.
moduleItemTable.grantReadData(backend.llmScoringFunction.resources.lambda);
studentItemProgressTable.grantReadWriteData(backend.llmScoringFunction.resources.lambda);
reviewerFeedbackTable.grantReadWriteData(backend.llmScoringFunction.resources.lambda);
eventLogTable.grantReadWriteData(backend.llmScoringFunction.resources.lambda);
backend.llmScoringFunction.addEnvironment("SESSION_TABLE_NAME", sessionTable.tableName);
backend.llmScoringFunction.addEnvironment("MODULE_ITEM_TABLE_NAME", moduleItemTable.tableName);
backend.llmScoringFunction.addEnvironment(
  "STUDENT_ITEM_PROGRESS_TABLE_NAME",
  studentItemProgressTable.tableName
);
backend.llmScoringFunction.addEnvironment(
  "REVIEWER_FEEDBACK_TABLE_NAME",
  reviewerFeedbackTable.tableName
);
backend.llmScoringFunction.addEnvironment("EVENT_LOG_TABLE_NAME", eventLogTable.tableName);

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

// VOICE study evidence persistence for Phase 1 rubric + Phase 2 training submissions.
sessionEvidenceTable.grantReadWriteData(backend.llmScoringFunction.resources.lambda);
backend.llmScoringFunction.addEnvironment("SESSION_EVIDENCE_TABLE_NAME", sessionEvidenceTable.tableName);

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
  backend.courseFunction,
  backend.moduleFunction,
  backend.moduleItemFunction,
  backend.surveyInstanceFunction,
  backend.eventLogFunction,
  backend.migrationFunction,
  backend.moduleAssetFunction,
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

// module-asset-function — scoped to module-assets/* (faculty rich-text uploads)
// and module-submissions/* (student external-link screenshots) only (NOT bucket-wide)
backend.moduleAssetFunction.addEnvironment("S3_BUCKET_NAME", s3BucketName);
backend.moduleAssetFunction.addEnvironment(
  "UNITY_BUILD_PUBLIC_BASE_URL",
  unityBuildPublicBaseUrl
);
backend.moduleAssetFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["s3:PutObject", "s3:AbortMultipartUpload"],
    resources: [
      `${unityStorageBucket.bucketArn}/module-assets/*`,
      `${unityStorageBucket.bucketArn}/module-submissions/*`,
    ],
  })
);

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

// /assignments/{assignmentId}/survey-instances — faculty roster of survey responses
// for sibling survey/debrief module items in the assignment's module. Defined here
// (above the LMS section) because the integration is created later, so we add the
// route after surveyInstanceLambdaIntegration is initialized.

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
const sessionTaskProgressPath = sessionItemPath.addResource("task-progress");
sessionTaskProgressPath.addMethod("GET", sessionLambdaIntegration, publicMethodOptions);
const sessionTaskProgressItemPath = sessionTaskProgressPath.addResource("{progressKey}");
const sessionTaskProgressCompletePath = sessionTaskProgressItemPath.addResource("complete");
sessionTaskProgressCompletePath.addMethod("PUT", sessionLambdaIntegration, publicMethodOptions);
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

// ─── Canvas-like LMS routes ───
const courseLambdaIntegration = new LambdaIntegration(backend.courseFunction.resources.lambda);
const moduleLambdaIntegration = new LambdaIntegration(backend.moduleFunction.resources.lambda);
const moduleItemLambdaIntegration = new LambdaIntegration(
  backend.moduleItemFunction.resources.lambda
);
const surveyInstanceLambdaIntegration = new LambdaIntegration(
  backend.surveyInstanceFunction.resources.lambda
);
const eventLogLambdaIntegration = new LambdaIntegration(backend.eventLogFunction.resources.lambda);
const migrationLambdaIntegration = new LambdaIntegration(
  backend.migrationFunction.resources.lambda
);

// /courses
const coursesPath = myRestApi.root.addResource("courses");
coursesPath.addMethod("GET", courseLambdaIntegration, cognitoMethodOptions);
coursesPath.addMethod("POST", courseLambdaIntegration, cognitoMethodOptions);
const courseItemPath = coursesPath.addResource("{courseId}");
courseItemPath.addMethod("GET", courseLambdaIntegration, cognitoMethodOptions);
courseItemPath.addMethod("PUT", courseLambdaIntegration, cognitoMethodOptions);
courseItemPath.addMethod("DELETE", courseLambdaIntegration, cognitoMethodOptions);
const courseStatusPath = courseItemPath.addResource("status");
courseStatusPath.addMethod("PUT", courseLambdaIntegration, cognitoMethodOptions);
const courseInstructorsPath = courseItemPath.addResource("instructors");
courseInstructorsPath.addMethod("GET", courseLambdaIntegration, cognitoMethodOptions);
courseInstructorsPath.addMethod("POST", courseLambdaIntegration, cognitoMethodOptions);
const courseInstructorItemPath = courseInstructorsPath.addResource("{facultyUserId}");
courseInstructorItemPath.addMethod("DELETE", courseLambdaIntegration, cognitoMethodOptions);
const courseInstructorRolePath = courseInstructorItemPath.addResource("role");
courseInstructorRolePath.addMethod("PUT", courseLambdaIntegration, cognitoMethodOptions);
const courseMyGroupsPath = courseItemPath.addResource("my-groups");
courseMyGroupsPath.addMethod("GET", courseLambdaIntegration, cognitoMethodOptions);
const courseEnrollmentsPath = courseItemPath.addResource("enrollments");
courseEnrollmentsPath.addMethod("GET", courseLambdaIntegration, cognitoMethodOptions);
courseEnrollmentsPath.addMethod("POST", courseLambdaIntegration, cognitoMethodOptions);
const courseEnrollmentItemPath = courseEnrollmentsPath.addResource("{studentUserId}");
courseEnrollmentItemPath.addMethod("DELETE", courseLambdaIntegration, cognitoMethodOptions);

// /courses/{courseId}/modules
const courseModulesPath = courseItemPath.addResource("modules");
courseModulesPath.addMethod("GET", moduleLambdaIntegration, cognitoMethodOptions);
courseModulesPath.addMethod("POST", moduleLambdaIntegration, cognitoMethodOptions);
const courseModulesReorderPath = courseModulesPath.addResource("reorder");
courseModulesReorderPath.addMethod("POST", moduleLambdaIntegration, cognitoMethodOptions);

// /modules/{moduleId}
const modulesPath = myRestApi.root.addResource("modules");
const moduleItemPath2 = modulesPath.addResource("{moduleId}");
moduleItemPath2.addMethod("GET", moduleLambdaIntegration, cognitoMethodOptions);
moduleItemPath2.addMethod("PUT", moduleLambdaIntegration, cognitoMethodOptions);
moduleItemPath2.addMethod("DELETE", moduleLambdaIntegration, cognitoMethodOptions);
const moduleReorderPath = moduleItemPath2.addResource("reorder");
moduleReorderPath.addMethod("POST", moduleLambdaIntegration, cognitoMethodOptions);

// /modules/{moduleId}/items
const moduleItemsPath = moduleItemPath2.addResource("items");
moduleItemsPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);
moduleItemsPath.addMethod("POST", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}
const moduleItemsRoot = myRestApi.root.addResource("module-items");
const moduleItemEntityPath = moduleItemsRoot.addResource("{itemId}");
moduleItemEntityPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);
moduleItemEntityPath.addMethod("PUT", moduleItemLambdaIntegration, cognitoMethodOptions);
moduleItemEntityPath.addMethod("DELETE", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/progress
const moduleItemProgressPath = moduleItemEntityPath.addResource("progress");
moduleItemProgressPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);
moduleItemProgressPath.addMethod("POST", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/randomize
const moduleItemRandomizePath = moduleItemEntityPath.addResource("randomize");
moduleItemRandomizePath.addMethod("POST", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/reviewers
const moduleItemReviewersPath = moduleItemEntityPath.addResource("reviewers");
moduleItemReviewersPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);
moduleItemReviewersPath.addMethod("POST", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/feedback
const moduleItemFeedbackPath = moduleItemEntityPath.addResource("feedback");
moduleItemFeedbackPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);
moduleItemFeedbackPath.addMethod("POST", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/best-session
const moduleItemBestSessionPath = moduleItemEntityPath.addResource("best-session");
moduleItemBestSessionPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/sub-questions
const moduleItemSubQuestionsPath = moduleItemEntityPath.addResource("sub-questions");
moduleItemSubQuestionsPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/sub-answer
const moduleItemSubAnswerPath = moduleItemEntityPath.addResource("sub-answer");
moduleItemSubAnswerPath.addMethod("POST", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/consent-decision  (consent item: student records agree/decline)
const moduleItemConsentDecisionPath = moduleItemEntityPath.addResource("consent-decision");
moduleItemConsentDecisionPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);
moduleItemConsentDecisionPath.addMethod("POST", moduleItemLambdaIntegration, cognitoMethodOptions);

// /courses/{courseId}/consent-decisions  (instructor/admin only roster export — handled
// by module-item-function despite the courses/* path, see plan)
const courseConsentDecisionsPath = courseItemPath.addResource("consent-decisions");
courseConsentDecisionsPath.addMethod("GET", moduleItemLambdaIntegration, cognitoMethodOptions);

// /module-items/{itemId}/survey-instance
const moduleItemSurveyInstancePath = moduleItemEntityPath.addResource("survey-instance");
moduleItemSurveyInstancePath.addMethod("GET", surveyInstanceLambdaIntegration, cognitoMethodOptions);
moduleItemSurveyInstancePath.addMethod("PUT", surveyInstanceLambdaIntegration, cognitoMethodOptions);
const moduleItemSurveyInstanceSubmitPath = moduleItemSurveyInstancePath.addResource("submit");
moduleItemSurveyInstanceSubmitPath.addMethod(
  "POST",
  surveyInstanceLambdaIntegration,
  cognitoMethodOptions
);

// /assignments/{assignmentId}/survey-instances — faculty roster of survey responses
const assignmentSurveyInstancesPath = assignmentItemPath.addResource("survey-instances");
assignmentSurveyInstancesPath.addMethod(
  "GET",
  surveyInstanceLambdaIntegration,
  cognitoMethodOptions
);

// /survey-templates/{surveyTemplateId} — extend with PUT/DELETE
const surveyTemplateItemPathExt = surveyTemplateItemPath; // already declared above
surveyTemplateItemPathExt.addMethod("PUT", surveyTemplateLambdaIntegration, cognitoMethodOptions);
surveyTemplateItemPathExt.addMethod(
  "DELETE",
  surveyTemplateLambdaIntegration,
  cognitoMethodOptions
);

// /events
const eventsPath = myRestApi.root.addResource("events");
eventsPath.addMethod("GET", eventLogLambdaIntegration, cognitoMethodOptions);
eventsPath.addMethod("POST", eventLogLambdaIntegration, cognitoMethodOptions);

// /admin/migrate-to-courses
const adminPath = myRestApi.root.addResource("admin");
const adminMigratePath = adminPath.addResource("migrate-to-courses");
adminMigratePath.addMethod("GET", migrationLambdaIntegration, cognitoMethodOptions);
adminMigratePath.addMethod("POST", migrationLambdaIntegration, cognitoMethodOptions);

// ─── ModuleAssetAPI ──────────────────────────────────────────────────────
// /module-assets/upload-url lives on its OWN RestApi in its OWN CloudFormation
// stack because the main NurseTownAPI stack is at the 500-resource CFN limit.
// This isolation also means future module-asset endpoints can grow without
// pressuring the legacy stack.
const moduleAssetStack = backend.createStack("module-asset-api-stack");

const moduleAssetRestApi = new RestApi(moduleAssetStack, "ModuleAssetRestApi", {
  restApiName: "ModuleAssetAPI",
  deploy: true,
  deployOptions: {
    stageName: process.env.AMPLIFY_ENV || "dev",
  },
  defaultCorsPreflightOptions: {
    allowOrigins: Cors.ALL_ORIGINS,
    allowMethods: Cors.ALL_METHODS,
    allowHeaders: [...Cors.DEFAULT_HEADERS, "X-Request-ID"],
  },
});

const moduleAssetAuthorizer = new CognitoUserPoolsAuthorizer(
  moduleAssetStack,
  "ModuleAssetAuthorizer",
  { cognitoUserPools: [backend.auth.resources.userPool] }
);
const moduleAssetCognitoMethodOptions = {
  authorizationType: AuthorizationType.COGNITO,
  authorizer: moduleAssetAuthorizer,
};

const moduleAssetLambdaIntegration = new LambdaIntegration(
  backend.moduleAssetFunction.resources.lambda
);
const moduleAssetsPath = moduleAssetRestApi.root.addResource("module-assets");
const moduleAssetsUploadUrlPath = moduleAssetsPath.addResource("upload-url");
moduleAssetsUploadUrlPath.addMethod(
  "POST",
  moduleAssetLambdaIntegration,
  moduleAssetCognitoMethodOptions
);

// CORS headers on auth-failure responses so the browser surfaces the real
// 401/403 instead of an opaque CORS error.
moduleAssetRestApi.addGatewayResponse("Default4XX", {
  type: ResponseType.DEFAULT_4XX,
  responseHeaders: {
    "Access-Control-Allow-Origin": "'*'",
    "Access-Control-Allow-Headers": "'*'",
  },
});
moduleAssetRestApi.addGatewayResponse("Default5XX", {
  type: ResponseType.DEFAULT_5XX,
  responseHeaders: {
    "Access-Control-Allow-Origin": "'*'",
    "Access-Control-Allow-Headers": "'*'",
  },
});

// add outputs to the configuration file
backend.addOutput({
  custom: {
    API: {
      [myRestApi.restApiName]: {
        endpoint: myRestApi.url,
        region: Stack.of(myRestApi).region,
        apiName: myRestApi.restApiName,
      },
      [moduleAssetRestApi.restApiName]: {
        endpoint: moduleAssetRestApi.url,
        region: Stack.of(moduleAssetRestApi).region,
        apiName: moduleAssetRestApi.restApiName,
      },
    },
    UnityStorage: {
      bucketName: unityStorageBucket.bucketName,
      distributionDomainName: unityStorageDistribution.distributionDomainName,
      publicBaseUrl: unityBuildPublicBaseUrl,
    },
  },
});
