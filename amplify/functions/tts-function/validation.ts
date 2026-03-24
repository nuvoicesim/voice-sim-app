type SimulationLevel = 1 | 2 | 3;
type Scenario = "task1" | "task2" | "task3";

export interface TtsVoiceProfile {
  profileId?: string;
  voiceId: string;
  modelId: string;
  stability?: number;
  similarityBoost?: number;
  styleExaggeration?: number;
  speed?: number;
}

export interface RuntimeContext {
  assignmentId: string;
  sessionId: string;
}

export interface TtsRequestBody {
  userID: string;
  simulationLevel?: SimulationLevel;
  context?: RuntimeContext;
  scenario?: string;
  text: string;
  voiceProfile: TtsVoiceProfile;
  options?: {
    format?: string;
    includeAlignment?: boolean;
  };
  metadata?: {
    sessionId?: string;
    turnIndex?: number;
    client?: string;
  };
}

export interface ValidatedTtsRequest {
  userID: string;
  simulationLevel?: SimulationLevel;
  context?: RuntimeContext;
  scenario: Scenario;
  text: string;
  voiceProfile: TtsVoiceProfile;
  options: {
    format: string;
    includeAlignment: boolean;
  };
  metadata: {
    sessionId?: string;
    turnIndex?: number;
    client?: string;
  };
}

interface ValidationOptions {
  maxTextChars: number;
}

const SCENARIOS: Scenario[] = ["task1", "task2", "task3"];

function asFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number") {
    return undefined;
  }
  return Number.isFinite(value) ? value : undefined;
}

function mapScenarioFromLevel(simulationLevel: SimulationLevel): Scenario {
  if (simulationLevel === 1) return "task1";
  if (simulationLevel === 2) return "task2";
  return "task3";
}

function isInRange(value: number | undefined, min: number, max: number): boolean {
  return value !== undefined && value >= min && value <= max;
}

export function validateTtsRequest(
  payload: unknown,
  options: ValidationOptions
): { request?: ValidatedTtsRequest; error?: string } {
  if (!payload || typeof payload !== "object") {
    return { error: "Request body must be a JSON object" };
  }

  const body = payload as Partial<TtsRequestBody>;
  if (!body.userID || typeof body.userID !== "string") {
    return { error: "Missing required field: userID" };
  }

  const hasContext = body.context && typeof body.context === "object"
    && typeof body.context.assignmentId === "string"
    && typeof body.context.sessionId === "string";
  const hasLevel = typeof body.simulationLevel === "number" && [1, 2, 3].includes(body.simulationLevel);

  if (!hasContext && !hasLevel) {
    return { error: "Provide context.assignmentId + context.sessionId, or simulationLevel (1, 2, or 3)" };
  }

  if (typeof body.text !== "string" || body.text.trim() === "") {
    return { error: "Missing required field: text" };
  }

  const text = body.text.trim();
  if (text.length > options.maxTextChars) {
    return { error: `text exceeds max length (${options.maxTextChars})` };
  }

  if (!body.voiceProfile || typeof body.voiceProfile !== "object") {
    return { error: "Missing required field: voiceProfile" };
  }

  const voiceProfileInput = body.voiceProfile as Partial<TtsVoiceProfile>;
  if (!voiceProfileInput.voiceId || typeof voiceProfileInput.voiceId !== "string") {
    return { error: "Missing required field: voiceProfile.voiceId" };
  }

  if (!voiceProfileInput.modelId || typeof voiceProfileInput.modelId !== "string") {
    return { error: "Missing required field: voiceProfile.modelId" };
  }

  const stability = asFiniteNumber(voiceProfileInput.stability);
  if (stability !== undefined && !isInRange(stability, 0, 1)) {
    return { error: "Invalid voice settings: stability out of range" };
  }

  const similarityBoost = asFiniteNumber(voiceProfileInput.similarityBoost);
  if (similarityBoost !== undefined && !isInRange(similarityBoost, 0, 1)) {
    return { error: "Invalid voice settings: similarityBoost out of range" };
  }

  const styleExaggeration = asFiniteNumber(voiceProfileInput.styleExaggeration);
  if (styleExaggeration !== undefined && !isInRange(styleExaggeration, 0, 1)) {
    return { error: "Invalid voice settings: styleExaggeration out of range" };
  }

  const speed = asFiniteNumber(voiceProfileInput.speed);
  if (speed !== undefined && !isInRange(speed, 0.7, 1.2)) {
    return { error: "Invalid voice settings: speed out of range" };
  }

  const optionsInput = body.options && typeof body.options === "object" ? body.options : {};
  const metadataInput = body.metadata && typeof body.metadata === "object" ? body.metadata : {};
  const scenario =
    typeof body.scenario === "string" && SCENARIOS.includes(body.scenario as Scenario)
      ? (body.scenario as Scenario)
      : hasLevel ? mapScenarioFromLevel(body.simulationLevel as SimulationLevel) : "task1";

  return {
    request: {
      userID: body.userID,
      simulationLevel: hasLevel ? body.simulationLevel : undefined,
      context: hasContext ? { assignmentId: body.context!.assignmentId, sessionId: body.context!.sessionId } : undefined,
      scenario,
      text,
      voiceProfile: {
        profileId:
          typeof voiceProfileInput.profileId === "string" ? voiceProfileInput.profileId : undefined,
        voiceId: voiceProfileInput.voiceId.trim(),
        modelId: voiceProfileInput.modelId.trim(),
        stability,
        similarityBoost,
        styleExaggeration,
        speed,
      },
      options: {
        format: typeof optionsInput.format === "string" ? optionsInput.format : "pcm_16000",
        includeAlignment:
          typeof optionsInput.includeAlignment === "boolean"
            ? optionsInput.includeAlignment
            : true,
      },
      metadata: {
        sessionId:
          typeof metadataInput.sessionId === "string" ? metadataInput.sessionId : undefined,
        turnIndex:
          typeof metadataInput.turnIndex === "number" ? metadataInput.turnIndex : undefined,
        client: typeof metadataInput.client === "string" ? metadataInput.client : undefined,
      },
    },
  };
}
