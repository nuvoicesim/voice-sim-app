import type { TtsVoiceProfile } from "./validation";

export type ValidationMode = "lenient" | "strict";
type SimulationLevel = 1 | 2 | 3;

export interface VoicePolicyResult {
  effectiveProfile: TtsVoiceProfile;
  adjustedFields: string[];
}

const SIMULATION_LEVEL_VOICE_ID_MAP: Record<SimulationLevel, string> = {
  1: "QXFI3J7JB0fOlMwKDUxE",
  2: "KjIBD4QnlzAqKHmoYfdZ",
  3: "nlPFgtYJ0K18Hij3YdiX",
};

const DEFAULT_PROFILE: Required<
  Pick<TtsVoiceProfile, "modelId" | "stability" | "similarityBoost" | "styleExaggeration" | "speed">
> = {
  modelId: "eleven_multilingual_v2",
  stability: 0.4,
  similarityBoost: 0.75,
  styleExaggeration: 0.3,
  speed: 1.0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function applyVoicePolicy(
  voiceProfile: TtsVoiceProfile,
  simulationLevel: SimulationLevel,
  mode: ValidationMode
): VoicePolicyResult {
  const adjustedFields: string[] = [];
  const mappedVoiceId = SIMULATION_LEVEL_VOICE_ID_MAP[simulationLevel];

  const effectiveProfile: TtsVoiceProfile = {
    ...voiceProfile,
    voiceId: mappedVoiceId,
    modelId: voiceProfile.modelId || DEFAULT_PROFILE.modelId,
  };

  if (voiceProfile.voiceId !== mappedVoiceId) {
    adjustedFields.push("voiceId");
  }

  const normalize = (
    key: "stability" | "similarityBoost" | "styleExaggeration",
    min: number,
    max: number,
    fallback: number
  ) => {
    const value = effectiveProfile[key];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      effectiveProfile[key] = fallback;
      adjustedFields.push(key);
      return;
    }

    if (value < min || value > max) {
      if (mode === "lenient") {
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
  } else if (effectiveProfile.speed < 0.7 || effectiveProfile.speed > 1.2) {
    if (mode === "lenient") {
      effectiveProfile.speed = clamp(effectiveProfile.speed, 0.7, 1.2);
      adjustedFields.push("speed");
    }
  }

  return { effectiveProfile, adjustedFields };
}
