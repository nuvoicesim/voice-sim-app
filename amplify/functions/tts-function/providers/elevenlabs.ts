import type { TtsVoiceProfile } from "../validation";

export interface TtsAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

export interface ElevenLabsSynthesisResult {
  audio_base64: string;
  alignment?: TtsAlignment;
}

export class ElevenLabsUpstreamError extends Error {
  statusCode: number;
  retryable: boolean;

  constructor(message: string, statusCode: number, retryable: boolean) {
    super(message);
    this.name = "ElevenLabsUpstreamError";
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

interface SynthesizeParams {
  apiKey: string;
  voiceProfile: TtsVoiceProfile;
  text: string;
  format: string;
  includeAlignment: boolean;
  timeoutMs: number;
}

interface ElevenLabsAlignmentRaw {
  characters?: string[];
  character_start_times_seconds?: number[];
  character_end_times_seconds?: number[];
  character_start_times_ms?: number[];
  character_end_times_ms?: number[];
}

interface ElevenLabsResponseRaw {
  audio_base64?: string;
  alignment?: ElevenLabsAlignmentRaw;
  normalized_alignment?: ElevenLabsAlignmentRaw;
  detail?: unknown;
}

function toNumberArray(values: unknown, msToSeconds: boolean): number[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value))
    .map((value) => (msToSeconds ? value / 1000 : value));
}

function normalizeAlignment(raw?: ElevenLabsAlignmentRaw): TtsAlignment | undefined {
  if (!raw) {
    return undefined;
  }

  const characters = Array.isArray(raw.characters)
    ? raw.characters.filter((ch): ch is string => typeof ch === "string")
    : [];
  const startsSeconds =
    raw.character_start_times_seconds !== undefined
      ? toNumberArray(raw.character_start_times_seconds, false)
      : toNumberArray(raw.character_start_times_ms, true);
  const endsSeconds =
    raw.character_end_times_seconds !== undefined
      ? toNumberArray(raw.character_end_times_seconds, false)
      : toNumberArray(raw.character_end_times_ms, true);

  if (
    characters.length === 0 ||
    startsSeconds.length !== characters.length ||
    endsSeconds.length !== characters.length
  ) {
    return undefined;
  }

  for (let i = 0; i < startsSeconds.length; i += 1) {
    if (startsSeconds[i] > endsSeconds[i]) {
      return undefined;
    }
    if (i > 0 && startsSeconds[i] < startsSeconds[i - 1]) {
      return undefined;
    }
  }

  return {
    characters,
    character_start_times_seconds: startsSeconds,
    character_end_times_seconds: endsSeconds,
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function synthesizeWithElevenLabs(params: SynthesizeParams): Promise<ElevenLabsSynthesisResult> {
  const apiKey = params.apiKey.trim();
  if (!apiKey) {
    throw new ElevenLabsUpstreamError("ElevenLabs API key is empty", 401, false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(
    params.voiceProfile.voiceId
  )}/with-timestamps?output_format=${encodeURIComponent(params.format)}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: params.text,
        model_id: params.voiceProfile.modelId,
        voice_settings: {
          stability: params.voiceProfile.stability,
          similarity_boost: params.voiceProfile.similarityBoost,
          style: params.voiceProfile.styleExaggeration,
          speed: params.voiceProfile.speed,
        },
      }),
    });

    if (!response.ok) {
      let detail = "";
      try {
        const errorBody = (await response.json()) as ElevenLabsResponseRaw;
        detail = typeof errorBody.detail === "string" ? errorBody.detail : JSON.stringify(errorBody.detail ?? {});
      } catch {
        detail = await response.text();
      }

      throw new ElevenLabsUpstreamError(
        `ElevenLabs upstream error (${response.status}) ${detail}`.trim(),
        response.status,
        isRetryableStatus(response.status)
      );
    }

    const body = (await response.json()) as ElevenLabsResponseRaw;
    if (!body.audio_base64 || typeof body.audio_base64 !== "string") {
      throw new ElevenLabsUpstreamError("ElevenLabs response missing audio payload", 502, true);
    }

    const alignment = normalizeAlignment(body.alignment ?? body.normalized_alignment);
    if (params.includeAlignment && !alignment) {
      throw new ElevenLabsUpstreamError("ElevenLabs response missing valid alignment", 502, true);
    }

    return {
      audio_base64: body.audio_base64,
      alignment,
    };
  } catch (error) {
    if (error instanceof ElevenLabsUpstreamError) {
      throw error;
    }

    const isAbortError =
      !!error &&
      typeof error === "object" &&
      "name" in error &&
      (error as { name?: string }).name === "AbortError";

    if (isAbortError) {
      throw new ElevenLabsUpstreamError("ElevenLabs request timed out", 504, true);
    }

    throw new ElevenLabsUpstreamError(
      error instanceof Error ? error.message : "Unexpected ElevenLabs error",
      502,
      true
    );
  } finally {
    clearTimeout(timer);
  }
}
