import type { ModuleItem } from "../../../slices/moduleItemSlice";
import type { SurveyTemplate } from "../../../slices/surveyTemplateSlice";

/**
 * Phase 3 survey-flow status logic (pure, client-side).
 *
 * The actual creation/wiring is performed server-side by the idempotent
 * POST /modules/{moduleId}/phase3-setup endpoint
 * (amplify/functions/module-item-function/phase3-setup.ts). This module only
 * DESCRIBES the state of a module's Phase 3 flow for the setup panel:
 *
 *   Parts A–C: feedbackCardsFromItemId = <its own moduleItemId>
 *              revealOnSubmit.unblindAssignmentItemId = <its own moduleItemId>
 *              cardSections strictly A@Q1 / B@Q7 / C@Q13
 *              hideQuestionNumbers = true
 *   Part D:    feedbackCardsFromItemId = <Parts A–C moduleItemId>
 *              requireFeedbackReveal = true
 *              hideQuestionNumbers = true
 *              gating after_item(<Parts A–C moduleItemId>)
 *   Order:     Parts A–C immediately followed by Part D.
 *
 * Internal study question numbers (Q1–Q34) never reach students: the
 * cardSections entries are translated into text-only section headers by
 * buildPhase3SectionHeaders, and hideQuestionNumbers suppresses the
 * SurveyRunner position badges.
 */

/** Instrument spec (Phase_3_Student_Feedback_Comparison_Survey_FINAL): Parts A–C = Q1–Q25. */
export const PHASE3_PARTS_AC_QUESTION_COUNT = 25;
/** Instrument spec: Part D = Q26–Q34 (9 prompts). */
export const PHASE3_PART_D_QUESTION_COUNT = 9;

/** The ONLY valid mapping: Card A/B/C blocks start at internal study
 *  questions Q1/Q7/Q13 (research-team numbering only — students see text
 *  headers, never these numbers). Any other mapping is invalid; the server
 *  setup rewrites it back to this. */
export const PHASE3_CARD_SECTIONS: ReadonlyArray<{
  displayKey: "A" | "B" | "C";
  firstQuestionNumber: number;
}> = [
  { displayKey: "A", firstQuestionNumber: 1 },
  { displayKey: "B", firstQuestionNumber: 7 },
  { displayKey: "C", firstQuestionNumber: 13 },
];

/** payload.phase3Flow marker values written by the server setup. */
export const PHASE3_FLOW_PARTS_AC = "parts_ac";
export const PHASE3_FLOW_PART_D = "part_d";

export interface Phase3FlowState {
  partsAC: ModuleItem | null;
  partD: ModuleItem | null;
  /** More than one candidate for a role — setup must stop, never pick one. */
  acCandidates: ModuleItem[];
  dCandidates: ModuleItem[];
  conflict: boolean;
  /** Parts A–C payload carries all wiring fields with strict cardSections. */
  partsACConnected: boolean;
  /** Part D payload + gating both point at the Parts A–C item. */
  partDConnected: boolean;
  /** Parts A–C sits immediately before Part D in the module order. */
  orderCorrect: boolean;
  /** Structurally complete: both wired, adjacent, no conflicts. Template
   *  validation is a separate async concern (validateExistingFlowTemplates) —
   *  only the two together justify showing "Configured". */
  complete: boolean;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Strict check: exactly A→Q1, B→Q7, C→Q13 (array order irrelevant). */
export function hasStrictCardSections(sections: unknown): boolean {
  if (!Array.isArray(sections) || sections.length !== PHASE3_CARD_SECTIONS.length) {
    return false;
  }
  const seen = new Map<string, number>();
  for (const s of sections) {
    if (!isRecord(s)) return false;
    const key = s.displayKey;
    if (typeof key !== "string" || seen.has(key)) return false;
    seen.set(key, Number(s.firstQuestionNumber));
  }
  return PHASE3_CARD_SECTIONS.every(
    (expected) => seen.get(expected.displayKey) === expected.firstQuestionNumber
  );
}

export function isPartsACConnected(item: ModuleItem): boolean {
  const p = isRecord(item.payload) ? item.payload : {};
  return (
    p.feedbackCardsFromItemId === item.moduleItemId &&
    isRecord(p.revealOnSubmit) &&
    p.revealOnSubmit.unblindAssignmentItemId === item.moduleItemId &&
    hasStrictCardSections(p.cardSections) &&
    p.hideQuestionNumbers === true
  );
}

/** True when gating (directly or inside all_of) requires the given item. */
export function gatingRequiresItem(gating: unknown, moduleItemId: string): boolean {
  if (!isRecord(gating)) return false;
  if (gating.kind === "after_item") return gating.moduleItemId === moduleItemId;
  if (gating.kind === "all_of") {
    const clauses = Array.isArray(gating.clauses) ? gating.clauses : [];
    return clauses.some((c: unknown) => gatingRequiresItem(c, moduleItemId));
  }
  return false;
}

export function isPartDConnected(item: ModuleItem, acItemId: string): boolean {
  const p = isRecord(item.payload) ? item.payload : {};
  return (
    p.feedbackCardsFromItemId === acItemId &&
    p.requireFeedbackReveal === true &&
    p.hideQuestionNumbers === true &&
    gatingRequiresItem(item.gating, acItemId)
  );
}

/**
 * Describe the module's Phase 3 flow. Candidates cover items created by the
 * server setup (payload.phase3Flow marker) and legacy hand-wired items
 * (self-referencing feedbackCardsFromItemId). Multiple candidates for either
 * role are surfaced as a conflict — never silently resolved.
 */
export function findPhase3Flow(items: ModuleItem[]): Phase3FlowState {
  const list = items || [];
  const surveys = list.filter((it) => it?.itemType === "survey");

  const acCandidates = surveys.filter((it) => {
    const p = isRecord(it.payload) ? it.payload : {};
    return (
      p.phase3Flow === PHASE3_FLOW_PARTS_AC ||
      (typeof p.feedbackCardsFromItemId === "string" &&
        p.feedbackCardsFromItemId === it.moduleItemId)
    );
  });
  const partsAC = acCandidates.length === 1 ? acCandidates[0] : null;

  const dCandidates = surveys.filter((it) => {
    if (acCandidates.some((c) => c.moduleItemId === it.moduleItemId)) return false;
    const p = isRecord(it.payload) ? it.payload : {};
    return (
      p.phase3Flow === PHASE3_FLOW_PART_D ||
      (partsAC != null && p.feedbackCardsFromItemId === partsAC.moduleItemId)
    );
  });
  const partD = dCandidates.length === 1 ? dCandidates[0] : null;

  const conflict = acCandidates.length > 1 || dCandidates.length > 1;

  const partsACConnected = partsAC ? isPartsACConnected(partsAC) : false;
  const partDConnected =
    partD && partsAC ? isPartDConnected(partD, partsAC.moduleItemId) : false;

  // Adjacency: in the full module order, Part D directly follows Parts A–C.
  let orderCorrect = false;
  if (partsAC && partD) {
    const orderedIds = [...list]
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((it) => it.moduleItemId);
    const acIdx = orderedIds.indexOf(partsAC.moduleItemId);
    const dIdx = orderedIds.indexOf(partD.moduleItemId);
    orderCorrect = acIdx !== -1 && dIdx === acIdx + 1;
  }

  return {
    partsAC,
    partD,
    acCandidates,
    dCandidates,
    conflict,
    partsACConnected,
    partDConnected,
    orderCorrect,
    complete: Boolean(
      !conflict &&
        partsAC &&
        partD &&
        partsACConnected &&
        partDConnected &&
        orderCorrect
    ),
  };
}

export function templateQuestionCount(
  template: SurveyTemplate | null | undefined
): number | null {
  return Array.isArray(template?.questions) ? template!.questions.length : null;
}

/**
 * Validate the template selection for whichever items still need creating.
 * `existingAcTemplateId` / `existingDTemplateId` carry the template of an
 * already-existing counterpart so a selection can't collide with it.
 * Returns human-readable errors (empty array = OK to proceed).
 */
export function validatePhase3TemplateSelection(opts: {
  acTemplate: SurveyTemplate | null;
  dTemplate: SurveyTemplate | null;
  needAC: boolean;
  needD: boolean;
  existingAcTemplateId?: string | null;
  existingDTemplateId?: string | null;
}): string[] {
  const errors: string[] = [];
  const { acTemplate, dTemplate, needAC, needD } = opts;

  if (needAC && !acTemplate) {
    errors.push("Select the Parts A–C survey template.");
  }
  if (needD && !dTemplate) {
    errors.push("Select the Part D survey template.");
  }
  const acId = needAC ? acTemplate?.surveyTemplateId : opts.existingAcTemplateId;
  const dId = needD ? dTemplate?.surveyTemplateId : opts.existingDTemplateId;
  if (acId && dId && acId === dId) {
    errors.push("Parts A–C and Part D must use two different templates.");
  }
  if (needAC && acTemplate) {
    const count = templateQuestionCount(acTemplate);
    if (count !== PHASE3_PARTS_AC_QUESTION_COUNT) {
      errors.push(
        `Parts A–C template must have exactly ${PHASE3_PARTS_AC_QUESTION_COUNT} questions (“${acTemplate.name}” has ${count ?? "an unknown number of"}).`
      );
    }
  }
  if (needD && dTemplate) {
    const count = templateQuestionCount(dTemplate);
    if (count !== PHASE3_PART_D_QUESTION_COUNT) {
      errors.push(
        `Part D template must have exactly ${PHASE3_PART_D_QUESTION_COUNT} questions (“${dTemplate.name}” has ${count ?? "an unknown number of"}).`
      );
    }
  }
  return errors;
}

/** How a referenced template resolved on the client: the template row, still
 *  loading, or not readable (missing / access denied). */
export type TemplateResolution = SurveyTemplate | "loading" | "unavailable";

/**
 * Validate the templates of the EXISTING flow items (new, resumed, legacy, or
 * seemingly configured — all states). "Configured" may only be shown when this
 * returns no errors and nothing is pending; while a template cannot be
 * confirmed, setup must stop with a visible error instead.
 */
export function validateExistingFlowTemplates(
  flow: Phase3FlowState,
  resolve: (surveyTemplateId: string) => TemplateResolution
): { errors: string[]; pending: boolean } {
  const errors: string[] = [];
  let pending = false;

  const check = (
    item: ModuleItem | null,
    label: string,
    expectedCount: number
  ): string | null => {
    if (!item) return null;
    const p = isRecord(item.payload) ? item.payload : {};
    const id = typeof p.surveyTemplateId === "string" ? p.surveyTemplateId : "";
    if (!id) {
      errors.push(`${label} item "${item.title}" has no survey template.`);
      return null;
    }
    const resolved = resolve(id);
    if (resolved === "loading") {
      pending = true;
      return id;
    }
    if (resolved === "unavailable") {
      errors.push(
        `${label} survey template (${id}) cannot be read — it may have been deleted or belongs to another account.`
      );
      return id;
    }
    if (resolved.isActive === false) {
      errors.push(
        `${label} survey template “${resolved.name}” has been deleted (inactive).`
      );
      return id;
    }
    const count = templateQuestionCount(resolved);
    if (count !== expectedCount) {
      errors.push(
        `${label} survey template “${resolved.name}” must have exactly ${expectedCount} questions (it has ${count ?? "an unknown number of"}).`
      );
    }
    return id;
  };

  const acId = check(flow.partsAC, "Parts A–C", PHASE3_PARTS_AC_QUESTION_COUNT);
  const dId = check(flow.partD, "Part D", PHASE3_PART_D_QUESTION_COUNT);
  if (acId && dId && acId === dId) {
    errors.push("Parts A–C and Part D must use two different templates.");
  }

  return { errors, pending };
}
