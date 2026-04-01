/**
 * Context resolver: resolves assignment/session context to scene and scenario details.
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

export class ContextResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContextResolutionError";
  }
}
