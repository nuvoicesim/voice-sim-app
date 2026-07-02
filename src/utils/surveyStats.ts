// Pure aggregation of student survey responses into per-question statistics
// for the faculty Survey Results view (and later research/CHI exports).
//
// Read-only computation over already-fetched data: no API calls, no state,
// no side effects. Statistics are computed over SUBMITTED instances only —
// in-progress answers are still changing and are reported as a count, never
// aggregated.

import {
  OTHER_VALUE,
  otherTextKey,
  type SurveyQuestionDef,
} from "./surveyAnswerFormat";

/** Minimal structural shape of a survey instance this module needs. */
export interface SurveyInstanceLike {
  studentUserId: string;
  status: string;
  answers?: Record<string, unknown> | null;
}

export interface ChoiceOptionStat {
  value: string;
  label: string;
  count: number;
  /**
   * 0–100 share of this question's respondents. For choice_multi each
   * respondent can pick several options, so percentages may sum past 100.
   */
  pct: number;
  /** True for the synthetic "Other" bucket. */
  isOther?: boolean;
  /**
   * True when the stored value matches no option in the question definition
   * (option deleted/relabeled after the snapshot). Shown as the raw value so
   * the response is never silently dropped.
   */
  isOrphan?: boolean;
}

export interface LikertStats {
  scale: number;
  leftAnchor?: string;
  rightAnchor?: string;
  /** counts[k] = respondents who picked scale point k (1-based; index 0 unused). */
  counts: number[];
  mean: number | null;
  median: number | null;
}

export interface FreeTextEntry {
  studentUserId: string;
  text: string;
}

export interface QuestionStats {
  question: SurveyQuestionDef;
  /** Submitted instances that answered this question. */
  respondents: number;
  /** Submitted instances that left this question unanswered. */
  skipped: number;
  /** choice_single / choice_multi distributions. */
  options?: ChoiceOptionStat[];
  /** Free texts typed for the "Other" option. */
  otherTexts?: string[];
  likert?: LikertStats;
  /** free_text answers (also the fallback for unknown question types). */
  texts?: FreeTextEntry[];
}

export interface SurveyAggregation {
  submitted: number;
  inProgress: number;
  questions: QuestionStats[];
}

function isEmptyAnswer(v: unknown): boolean {
  return (
    v === undefined ||
    v === null ||
    v === "" ||
    (Array.isArray(v) && v.length === 0)
  );
}

function aggregateChoice(
  q: SurveyQuestionDef,
  answered: Array<{ inst: SurveyInstanceLike; raw: unknown }>
): Pick<QuestionStats, "options" | "otherTexts"> {
  const countsByValue = new Map<string, number>();
  const otherTexts: string[] = [];
  for (const { inst, raw } of answered) {
    const values =
      q.type === "choice_multi"
        ? Array.isArray(raw)
          ? raw
          : [raw]
        : [raw];
    for (const v of values.map(String)) {
      countsByValue.set(v, (countsByValue.get(v) ?? 0) + 1);
      if (v === OTHER_VALUE) {
        const txt = inst.answers?.[otherTextKey(q.id)];
        if (txt && String(txt).trim().length > 0) otherTexts.push(String(txt));
      }
    }
  }

  const denom = Math.max(1, answered.length);
  const pctOf = (count: number) => (count / denom) * 100;
  const options: ChoiceOptionStat[] = [];
  const seen = new Set<string>();

  // Defined options first, in authoring order. Duplicate values (possible
  // after delete-then-add in the editor) collapse into the first occurrence
  // since stored answers cannot distinguish them.
  for (const def of q.config?.options ?? []) {
    if (def == null || seen.has(def.value)) continue;
    seen.add(def.value);
    const count = countsByValue.get(def.value) ?? 0;
    options.push({
      value: def.value,
      label: def.label || def.value,
      count,
      pct: pctOf(count),
    });
  }

  // Synthetic "Other" bucket when the question allows it or the data has it.
  if (q.config?.allowOther || countsByValue.has(OTHER_VALUE)) {
    seen.add(OTHER_VALUE);
    const count = countsByValue.get(OTHER_VALUE) ?? 0;
    options.push({
      value: OTHER_VALUE,
      label: q.config?.otherLabel || "Other",
      count,
      pct: pctOf(count),
      isOther: true,
    });
  }

  // Orphaned stored values last, flagged, so nothing is silently dropped.
  for (const [value, count] of countsByValue) {
    if (seen.has(value)) continue;
    options.push({ value, label: value, count, pct: pctOf(count), isOrphan: true });
  }

  return { options, otherTexts };
}

function aggregateLikert(
  q: SurveyQuestionDef,
  answered: Array<{ raw: unknown }>
): LikertStats {
  const rawScale = Number(q.config?.scale);
  const scale =
    Number.isFinite(rawScale) && rawScale >= 2 ? Math.floor(rawScale) : 7;
  const counts = new Array<number>(scale + 1).fill(0);
  const valid: number[] = [];
  for (const { raw } of answered) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= scale) {
      counts[n] += 1;
      valid.push(n);
    }
  }
  valid.sort((a, b) => a - b);
  const mean =
    valid.length > 0 ? valid.reduce((s, n) => s + n, 0) / valid.length : null;
  let median: number | null = null;
  if (valid.length > 0) {
    const mid = Math.floor(valid.length / 2);
    median =
      valid.length % 2 === 1 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  }
  return {
    scale,
    leftAnchor: q.config?.leftAnchor || undefined,
    rightAnchor: q.config?.rightAnchor || undefined,
    counts,
    mean,
    median,
  };
}

/**
 * Aggregate submitted survey instances into per-question statistics.
 *
 * `questions` should come from an instance schemaSnapshot (frozen at first
 * open) so value→label mapping reflects what students actually saw. Values
 * not matching any known option surface as flagged orphans rather than
 * disappearing.
 */
export function aggregateSurvey(
  questions: SurveyQuestionDef[],
  instances: SurveyInstanceLike[]
): SurveyAggregation {
  const submittedInstances = instances.filter((i) => i.status === "submitted");
  const inProgress = instances.filter((i) => i.status === "in_progress").length;

  const questionStats = questions.map<QuestionStats>((q) => {
    const answered: Array<{ inst: SurveyInstanceLike; raw: unknown }> = [];
    let skipped = 0;
    for (const inst of submittedInstances) {
      const raw = inst.answers?.[q.id];
      if (isEmptyAnswer(raw)) skipped += 1;
      else answered.push({ inst, raw });
    }

    const base: QuestionStats = {
      question: q,
      respondents: answered.length,
      skipped,
    };

    if (q.type === "choice_single" || q.type === "choice_multi") {
      Object.assign(base, aggregateChoice(q, answered));
    } else if (q.type === "likert") {
      base.likert = aggregateLikert(q, answered);
    } else {
      // free_text and unknown/legacy types: list the raw values.
      base.texts = answered
        .map(({ inst, raw }) => ({
          studentUserId: inst.studentUserId,
          text: typeof raw === "string" ? raw : JSON.stringify(raw),
        }))
        .filter((t) => t.text.trim().length > 0);
    }
    return base;
  });

  return {
    submitted: submittedInstances.length,
    inProgress,
    questions: questionStats,
  };
}
