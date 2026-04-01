import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getItem } from "./database";
import {
  resolveContext,
  type RuntimeContext,
} from "./context-resolver";

export interface PromptRuntimeConfig {
  systemPrompt?: string;
  version?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface TtsRuntimeConfig {
  profileId?: string;
  version?: string;
  voiceId?: string;
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  styleExaggeration?: number;
  speed?: number;
}

export interface SceneRuntimeConfig {
  dialogue?: PromptRuntimeConfig;
  scoring?: PromptRuntimeConfig;
  tts?: TtsRuntimeConfig;
}

export interface ResolvedRuntimeConfig {
  scenarioKey: string;
  unityBuildFolder?: string;
  dialogue?: PromptRuntimeConfig;
  scoring?: PromptRuntimeConfig;
  tts?: TtsRuntimeConfig;
}

interface RuntimeResolutionBody {
  context?: RuntimeContext;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizePromptConfig(value: unknown): PromptRuntimeConfig | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;

  const config: PromptRuntimeConfig = {};
  if (typeof obj.systemPrompt === "string" && obj.systemPrompt.trim() !== "") {
    config.systemPrompt = obj.systemPrompt.trim();
  }
  if (typeof obj.version === "string" && obj.version.trim() !== "") {
    config.version = obj.version.trim();
  }
  if (typeof obj.model === "string" && obj.model.trim() !== "") {
    config.model = obj.model.trim();
  }
  config.temperature = asFiniteNumber(obj.temperature);
  config.maxOutputTokens = asFiniteNumber(obj.maxOutputTokens);

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeTtsConfig(value: unknown): TtsRuntimeConfig | undefined {
  const obj = asObject(value);
  if (!obj) return undefined;

  const config: TtsRuntimeConfig = {};
  if (typeof obj.profileId === "string" && obj.profileId.trim() !== "") {
    config.profileId = obj.profileId.trim();
  }
  if (typeof obj.version === "string" && obj.version.trim() !== "") {
    config.version = obj.version.trim();
  }
  if (typeof obj.voiceId === "string" && obj.voiceId.trim() !== "") {
    config.voiceId = obj.voiceId.trim();
  }
  if (typeof obj.modelId === "string" && obj.modelId.trim() !== "") {
    config.modelId = obj.modelId.trim();
  }
  config.stability = asFiniteNumber(obj.stability);
  config.similarityBoost = asFiniteNumber(obj.similarityBoost);
  config.styleExaggeration = asFiniteNumber(obj.styleExaggeration);
  config.speed = asFiniteNumber(obj.speed);

  return Object.keys(config).length > 0 ? config : undefined;
}

function normalizeRuntimeConfig(value: unknown): SceneRuntimeConfig {
  const obj = asObject(value);
  if (!obj) return {};

  return {
    dialogue: normalizePromptConfig(obj.dialogue),
    scoring: normalizePromptConfig(obj.scoring),
    tts: normalizeTtsConfig(obj.tts),
  };
}

function mergePromptConfig(
  base?: PromptRuntimeConfig,
  override?: PromptRuntimeConfig
): PromptRuntimeConfig | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base || {}),
    ...(override || {}),
  };
}

function mergeTtsConfig(
  base?: TtsRuntimeConfig,
  override?: TtsRuntimeConfig
): TtsRuntimeConfig | undefined {
  if (!base && !override) return undefined;
  return {
    ...(base || {}),
    ...(override || {}),
  };
}

export async function resolveRuntimeConfig(
  body: RuntimeResolutionBody,
  assignmentTableName: string,
  sceneTableName: string,
  patientProfileTableName: string,
  dynamo: DynamoDBDocumentClient
): Promise<ResolvedRuntimeConfig> {
  if (!body.context?.assignmentId || !body.context?.sessionId) {
    throw new Error("Runtime context is required");
  }

  const resolvedContext = await resolveContext(body.context, assignmentTableName, sceneTableName, dynamo);

  const assignment = await getItem(assignmentTableName, { assignmentId: resolvedContext.assignmentId }, dynamo);
  const scene = await getItem(sceneTableName, { sceneId: resolvedContext.sceneId }, dynamo);
  const patientProfileId =
    typeof assignment?.patientProfileId === "string" ? assignment.patientProfileId : undefined;
  if (!patientProfileId) {
    throw new Error("Assignment is missing patientProfileId");
  }

  const patientProfile = await getItem(
    patientProfileTableName,
    { patientProfileId },
    dynamo
  );
  if (!patientProfile) {
    throw new Error("Patient profile not found for assignment");
  }

  const profileConfig = normalizeRuntimeConfig({
    dialogue: patientProfile.dialogueConfig,
    scoring: patientProfile.scoringConfig,
    tts: patientProfile.ttsConfig,
  });

  return {
    scenarioKey: resolvedContext.scenarioKey,
    unityBuildFolder: typeof scene?.unityBuildFolder === "string" ? scene.unityBuildFolder : undefined,
    dialogue: mergePromptConfig(undefined, profileConfig.dialogue),
    scoring: mergePromptConfig(undefined, profileConfig.scoring),
    tts: mergeTtsConfig(undefined, profileConfig.tts),
  };
}
