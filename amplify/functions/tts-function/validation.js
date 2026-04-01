const SCENARIOS = ["task1", "task2", "task3"];
function asFiniteNumber(value) {
    if (typeof value !== "number") {
        return undefined;
    }
    return Number.isFinite(value) ? value : undefined;
}
function isInRange(value, min, max) {
    return value !== undefined && value >= min && value <= max;
}
export function validateTtsRequest(payload, options) {
    if (!payload || typeof payload !== "object") {
        return { error: "Request body must be a JSON object" };
    }
    const body = payload;
    if (!body.userID || typeof body.userID !== "string") {
        return { error: "Missing required field: userID" };
    }
    const hasContext = body.context && typeof body.context === "object"
        && typeof body.context.assignmentId === "string"
        && typeof body.context.sessionId === "string";
    if (!hasContext) {
        return { error: "Provide context.assignmentId + context.sessionId" };
    }
    if (typeof body.text !== "string" || body.text.trim() === "") {
        return { error: "Missing required field: text" };
    }
    const text = body.text.trim();
    if (text.length > options.maxTextChars) {
        return { error: `text exceeds max length (${options.maxTextChars})` };
    }
    const voiceProfileInput = (body.voiceProfile || {});
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
    const scenario = typeof body.scenario === "string" && SCENARIOS.includes(body.scenario)
        ? body.scenario
        : "task1";
    return {
        request: {
            userID: body.userID,
            context: hasContext ? { assignmentId: body.context.assignmentId, sessionId: body.context.sessionId } : undefined,
            scenario,
            text,
            voiceProfile: {
                profileId: typeof voiceProfileInput.profileId === "string" ? voiceProfileInput.profileId : undefined,
                voiceId: typeof voiceProfileInput.voiceId === "string" ? voiceProfileInput.voiceId.trim() : undefined,
                modelId: typeof voiceProfileInput.modelId === "string" ? voiceProfileInput.modelId.trim() : undefined,
                stability,
                similarityBoost,
                styleExaggeration,
                speed,
            },
            options: {
                format: typeof optionsInput.format === "string" ? optionsInput.format : "pcm_16000",
                includeAlignment: typeof optionsInput.includeAlignment === "boolean"
                    ? optionsInput.includeAlignment
                    : true,
            },
            metadata: {
                sessionId: typeof metadataInput.sessionId === "string" ? metadataInput.sessionId : undefined,
                turnIndex: typeof metadataInput.turnIndex === "number" ? metadataInput.turnIndex : undefined,
                client: typeof metadataInput.client === "string" ? metadataInput.client : undefined,
            },
        },
    };
}
