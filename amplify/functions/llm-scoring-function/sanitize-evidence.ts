// Local sanitizer for SessionEvidence DynamoDB writes.
//
// The shared DynamoDB document client is not configured with
// removeUndefinedValues, so any `undefined` value in a putItem record causes
// AWS SDK v3 to throw at marshalling time. Both new persistence paths
// (phase1-rubric.ts, phase2-evidence.ts) sometimes carry undefined for fields
// that are intentionally absent (itemId on multi-item submissions,
// promptVersion / rubricAssessmentPayload on Phase 2, optional taskContext
// fields when Unity didn't include them).
//
// stripUndefined recursively removes ONLY undefined values from nested
// objects and arrays. null, false, 0, and "" are preserved verbatim because
// they are legitimate values in evidence payloads (e.g. cueUsed: false,
// validUniqueResponseCount: 0, taskSummary: "").

export function stripUndefined<T>(value: T): T {
  if (value === undefined) return value;
  if (value === null) return value;
  if (Array.isArray(value)) {
    const cleaned: unknown[] = [];
    for (const entry of value) {
      const sanitized = stripUndefined(entry);
      if (sanitized !== undefined) cleaned.push(sanitized);
    }
    return cleaned as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      const sanitized = stripUndefined(v);
      if (sanitized !== undefined) out[k] = sanitized;
    }
    return out as unknown as T;
  }
  return value;
}
