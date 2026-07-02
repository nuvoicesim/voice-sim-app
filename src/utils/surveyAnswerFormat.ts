// Shared value→label helpers for rendering student survey answers in
// faculty-facing views.
//
// The student survey flow stores choice answers as internal option values
// (e.g. "opt1"); the human-readable labels live in the question definitions
// frozen into each SurveyInstance's schemaSnapshot at first open. These
// helpers map stored values back to labels for display. Read-only display
// logic — never used by the student-facing survey flow.
//
// The mapping rules mirror the proven implementation in
// src/portals/faculty/StudentsDataPage.tsx (deliberately left untouched for
// now; consolidating it onto this util is deferred while the user study is
// live).

export interface SurveyOptionDef {
  value: string;
  label: string;
}

/**
 * Known config fields across the four question types. Snapshots are parsed
 * JSON, so every field is optional and read defensively.
 */
export interface SurveyQuestionConfig {
  options?: SurveyOptionDef[];
  allowOther?: boolean;
  otherLabel?: string;
  minSelected?: number;
  scale?: number;
  leftAnchor?: string;
  rightAnchor?: string;
  minWords?: number;
  maxWords?: number;
  placeholder?: string;
}

export interface SurveyQuestionDef {
  id: string;
  /** Missing/unknown types fall back to plain-string rendering. */
  type?: "likert" | "choice_single" | "choice_multi" | "free_text" | string;
  prompt: string;
  required?: boolean;
  config?: SurveyQuestionConfig;
}

/** Sentinel stored when a student selects the "Other (specify)" option. */
export const OTHER_VALUE = "__other__";

/** Companion answer key holding the free text typed for "Other". */
export const otherTextKey = (qId: string) => `${qId}__other_text`;

function renderOtherLabel(
  q: SurveyQuestionDef,
  answers: Record<string, unknown>
): string {
  const base = q.config?.otherLabel || "Other";
  const txt = answers?.[otherTextKey(q.id)];
  return txt && String(txt).trim().length > 0
    ? `${base}: ${String(txt)}`
    : base;
}

/**
 * Label for a single stored choice value. Orphaned values (option deleted or
 * relabeled after the snapshot was taken) fall back to the raw stored value
 * so the data is never silently hidden.
 */
export function choiceOptionLabel(
  q: SurveyQuestionDef,
  value: string
): string {
  const opt = (q.config?.options ?? []).find((o) => o.value === value);
  return opt?.label ?? String(value);
}

/**
 * Human-readable rendering of one stored answer, given its question
 * definition (from the instance's schemaSnapshot).
 *
 * - likert      → the numeric rating as a string
 * - choice_single → the option label ("__other__" → other-label + typed text)
 * - choice_multi  → comma-joined option labels
 * - free_text / unknown → the raw value as a string
 */
export function formatAnswer(
  q: SurveyQuestionDef,
  raw: unknown,
  answers: Record<string, unknown> = {},
  emptyText = "—"
): string {
  if (raw === undefined || raw === null || raw === "") return emptyText;
  if (q.type === "likert") return String(raw);
  if (q.type === "choice_single") {
    if (raw === OTHER_VALUE) return renderOtherLabel(q, answers);
    return choiceOptionLabel(q, String(raw));
  }
  if (q.type === "choice_multi") {
    if (!Array.isArray(raw) || raw.length === 0) return emptyText;
    return raw
      .map((v) =>
        v === OTHER_VALUE
          ? renderOtherLabel(q, answers)
          : choiceOptionLabel(q, String(v))
      )
      .join(", ");
  }
  if (Array.isArray(raw)) return raw.map(String).join(", ");
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

/**
 * Scale-anchor hint for likert questions, e.g. "1 = Not at all · 7 =
 * Extremely confident". Null when the question is not likert or has no
 * anchors to show.
 */
export function likertScaleHint(q: SurveyQuestionDef): string | null {
  if (q.type !== "likert") return null;
  const scale = Number(q.config?.scale);
  const left = q.config?.leftAnchor;
  const right = q.config?.rightAnchor;
  if (!left && !right) return null;
  const hi = Number.isFinite(scale) && scale >= 2 ? scale : "max";
  const parts: string[] = [];
  if (left) parts.push(`1 = ${left}`);
  if (right) parts.push(`${hi} = ${right}`);
  return parts.join(" · ");
}
