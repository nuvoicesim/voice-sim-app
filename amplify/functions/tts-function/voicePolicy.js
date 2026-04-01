const DEFAULT_PROFILE = {
    modelId: "eleven_multilingual_v2",
    stability: 0.4,
    similarityBoost: 0.75,
    styleExaggeration: 0.3,
    speed: 1.0,
};
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
export function applyVoicePolicy(voiceProfile, options) {
    const adjustedFields = [];
    const mappedVoiceId = options.enforcedVoiceId
        || voiceProfile.voiceId;
    const effectiveProfile = {
        ...voiceProfile,
        voiceId: mappedVoiceId,
        modelId: options.enforcedModelId || voiceProfile.modelId || DEFAULT_PROFILE.modelId,
    };
    if (voiceProfile.voiceId !== mappedVoiceId) {
        adjustedFields.push("voiceId");
    }
    const normalize = (key, min, max, fallback) => {
        const value = effectiveProfile[key];
        if (typeof value !== "number" || !Number.isFinite(value)) {
            effectiveProfile[key] = fallback;
            adjustedFields.push(key);
            return;
        }
        if (value < min || value > max) {
            if (options.mode === "lenient") {
                effectiveProfile[key] = clamp(value, min, max);
                adjustedFields.push(key);
            }
        }
    };
    normalize("stability", 0, 1, DEFAULT_PROFILE.stability);
    normalize("similarityBoost", 0, 1, DEFAULT_PROFILE.similarityBoost);
    normalize("styleExaggeration", 0, 1, DEFAULT_PROFILE.styleExaggeration);
    if (typeof effectiveProfile.speed !== "number" || !Number.isFinite(effectiveProfile.speed)) {
        effectiveProfile.speed = DEFAULT_PROFILE.speed;
        adjustedFields.push("speed");
    }
    else if (effectiveProfile.speed < 0.7 || effectiveProfile.speed > 1.2) {
        if (options.mode === "lenient") {
            effectiveProfile.speed = clamp(effectiveProfile.speed, 0.7, 1.2);
            adjustedFields.push("speed");
        }
    }
    return { effectiveProfile, adjustedFields };
}
