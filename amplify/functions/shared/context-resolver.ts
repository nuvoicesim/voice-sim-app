/**
 * Context resolver: resolves assignment/session context to scene and scenario details.
 * Replaces the old simulationLevel -> task mapping with assignment-based lookups.
 */

import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { getItem } from "./database";

export interface RuntimeContext {
  assignmentId: string;
  sessionId: string;
}

export interface ResolvedContext {
  assignmentId: string;
  sessionId: string;
  sceneId: string;
  scenarioKey: string;
  mode: string;
}

const LEGACY_LEVEL_TO_SCENARIO: Record<number, string> = {
  1: "task1",
  2: "task2",
  3: "task3",
};

/**
 * Resolve runtime context from assignmentId to full scene/scenario details.
 * Looks up the Assignment table, then the SceneCatalog table.
 */
export async function resolveContext(
  context: RuntimeContext,
  assignmentTableName: string,
  sceneTableName: string,
  dynamo: DynamoDBDocumentClient
): Promise<ResolvedContext> {
  const assignment = await getItem(assignmentTableName, { assignmentId: context.assignmentId }, dynamo);

  if (!assignment) {
    throw new ContextResolutionError(`Assignment not found: ${context.assignmentId}`);
  }

  const scene = await getItem(sceneTableName, { sceneId: assignment.sceneId }, dynamo);

  if (!scene) {
    throw new ContextResolutionError(`Scene not found: ${assignment.sceneId}`);
  }

  if (!scene.isActive) {
    throw new ContextResolutionError(`Scene is inactive: ${assignment.sceneId}`);
  }

  return {
    assignmentId: context.assignmentId,
    sessionId: context.sessionId,
    sceneId: scene.sceneId,
    scenarioKey: scene.scenarioKey,
    mode: assignment.mode,
  };
}

/**
 * Fallback: resolve scenario from legacy simulationLevel.
 * Used during migration when clients still send simulationLevel.
 */
export function resolveFromLegacyLevel(simulationLevel: number): string {
  const scenario = LEGACY_LEVEL_TO_SCENARIO[simulationLevel];
  if (!scenario) {
    throw new ContextResolutionError(`Invalid simulationLevel: ${simulationLevel}`);
  }
  return scenario;
}

/**
 * Determine whether the request uses the new context format or legacy level format.
 * Returns the resolved scenarioKey either way.
 */
export async function resolveScenarioKey(
  body: { context?: RuntimeContext; simulationLevel?: number },
  assignmentTableName: string,
  sceneTableName: string,
  dynamo: DynamoDBDocumentClient
): Promise<{ scenarioKey: string; resolved: ResolvedContext | null; isLegacy: boolean }> {
  if (body.context?.assignmentId && body.context?.sessionId) {
    const resolved = await resolveContext(body.context, assignmentTableName, sceneTableName, dynamo);
    return { scenarioKey: resolved.scenarioKey, resolved, isLegacy: false };
  }

  if (body.simulationLevel != null) {
    console.warn(`[DEPRECATED] Request using legacy simulationLevel=${body.simulationLevel}. Migrate to context.assignmentId + context.sessionId.`);
    const scenarioKey = resolveFromLegacyLevel(body.simulationLevel);
    return { scenarioKey, resolved: null, isLegacy: true };
  }

  throw new ContextResolutionError("Request must include context.assignmentId + context.sessionId, or simulationLevel");
}

export class ContextResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextResolutionError";
  }
}
