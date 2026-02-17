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

// Assign table permissions and environment variables to each function
for (let i = 0; i < fns.length; i++) {
  tableMap[i].grantReadWriteData(fns[i].resources.lambda);
  fns[i].addEnvironment("TABLE_NAME", tableMap[i].tableName);
}

// Grant Cognito permissions to cognito-user-function and add environment variable for USER_POOL_ID
const userPool = backend.auth.resources.userPool;
const userPoolId = userPool.userPoolId;
backend.cognitoUserFunction.addEnvironment("USER_POOL_ID", userPoolId);
backend.cognitoUserFunction.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ["cognito-idp:AdminCreateUser", "cognito-idp:AdminGetUser", "cognito-idp:AdminSetUserPassword"],
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
const defaultLlmAllowedOrigins = "http://localhost:8000,http://127.0.0.1:8000,http://localhost:5173";
const llmEnvShared = {
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  LLM_ALLOWED_ORIGINS: process.env.LLM_ALLOWED_ORIGINS ?? defaultLlmAllowedOrigins,
  LLM_UPSTREAM_RETRIES: process.env.LLM_UPSTREAM_RETRIES ?? "1",
};

for (const [key, value] of Object.entries(llmEnvShared)) {
  backend.llmDialogueFunction.addEnvironment(key, value);
  backend.llmScoringFunction.addEnvironment(key, value);
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
    allowHeaders: Cors.DEFAULT_HEADERS,
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
