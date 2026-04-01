export class ElevenLabsUpstreamError extends Error {
    statusCode;
    retryable;
    constructor(message, statusCode, retryable) {
        super(message);
        this.name = "ElevenLabsUpstreamError";
        this.statusCode = statusCode;
        this.retryable = retryable;
    }
}
function toNumberArray(values, msToSeconds) {
    if (!Array.isArray(values)) {
        return [];
    }
    return values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .map((value) => (msToSeconds ? value / 1000 : value));
}
function normalizeAlignment(raw) {
    if (!raw) {
        return undefined;
    }
    const characters = Array.isArray(raw.characters)
        ? raw.characters.filter((ch) => typeof ch === "string")
        : [];
    const startsSeconds = raw.character_start_times_seconds !== undefined
        ? toNumberArray(raw.character_start_times_seconds, false)
        : toNumberArray(raw.character_start_times_ms, true);
    const endsSeconds = raw.character_end_times_seconds !== undefined
        ? toNumberArray(raw.character_end_times_seconds, false)
        : toNumberArray(raw.character_end_times_ms, true);
    if (characters.length === 0 ||
        startsSeconds.length !== characters.length ||
        endsSeconds.length !== characters.length) {
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
function isRetryableStatus(status) {
    return status === 408 || status === 429 || status >= 500;
}
export async function synthesizeWithElevenLabs(params) {
    const apiKey = params.apiKey.trim();
    if (!apiKey) {
        throw new ElevenLabsUpstreamError("ElevenLabs API key is empty", 401, false);
    }
    const voiceId = params.voiceProfile.voiceId?.trim();
    if (!voiceId) {
        throw new ElevenLabsUpstreamError("ElevenLabs voiceId is missing", 400, false);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), params.timeoutMs);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${encodeURIComponent(params.format)}`;
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
                const errorBody = (await response.json());
                detail = typeof errorBody.detail === "string" ? errorBody.detail : JSON.stringify(errorBody.detail ?? {});
            }
            catch {
                detail = await response.text();
            }
            throw new ElevenLabsUpstreamError(`ElevenLabs upstream error (${response.status}) ${detail}`.trim(), response.status, isRetryableStatus(response.status));
        }
        const body = (await response.json());
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
    }
    catch (error) {
        if (error instanceof ElevenLabsUpstreamError) {
            throw error;
        }
        const isAbortError = !!error &&
            typeof error === "object" &&
            "name" in error &&
            error.name === "AbortError";
        if (isAbortError) {
            throw new ElevenLabsUpstreamError("ElevenLabs request timed out", 504, true);
        }
        throw new ElevenLabsUpstreamError(error instanceof Error ? error.message : "Unexpected ElevenLabs error", 502, true);
    }
    finally {
        clearTimeout(timer);
    }
}
