/**
 * Phase 3 survey-flow setup — server-side, idempotent, concurrency-safe.
 *
 * POST /modules/{moduleId}/phase3-setup creates and wires the two Phase 3
 * survey ModuleItems in one authoritative server pass, replacing the earlier
 * client-side multi-step orchestration (which could duplicate items across two
 * tabs, two users, or a lost response).
 *
 * Idempotency / concurrency design:
 *  - New items use DETERMINISTIC ids derived from the module
 *    (`p3ac-<moduleId>` / `p3d-<moduleId>`) written with a DynamoDB
 *    conditional put (attribute_not_exists). Two concurrent requests with the
 *    SAME template selection converge on the same two rows: the loser of the
 *    race reads the winner's row and continues.
 *  - A lost create race NEVER overwrites the winner: the loser adopts the
 *    stored row's surveyTemplateId and re-validates the effective pair. If
 *    the stored template differs from the loser's request, the loser returns
 *    409 without writing anything — exactly one template selection can become
 *    the final result, and every 200 response matches what is stored.
 *  - Existing candidates (this setup's marker, the deterministic ids, or a
 *    legacy hand-wired self-referencing item) are adopted, never re-created.
 *  - More than one candidate for either role is a hard 409 conflict — the
 *    setup refuses to silently pick one.
 *  - Every write is a deterministic merge of the current row, so any partial
 *    failure is completed by simply calling the endpoint again.
 *
 * Kept pure (storage injected) so the idempotency and validation rules are
 * unit-testable without DynamoDB, mirroring phase3-cards.ts.
 */

/** Instrument spec (Phase_3_Student_Feedback_Comparison_Survey_FINAL): Parts A–C = Q1–Q25. */
export const PHASE3_PARTS_AC_QUESTION_COUNT = 25;
/** Instrument spec: Part D = Q26–Q34 (9 prompts). */
export const PHASE3_PART_D_QUESTION_COUNT = 9;

/** The one valid mapping: Card A/B/C blocks start at internal study questions
 *  Q1/Q7/Q13. Any other mapping is invalid and gets rewritten to this. */
export const PHASE3_CARD_SECTIONS: ReadonlyArray<{
  displayKey: "A" | "B" | "C";
  firstQuestionNumber: number;
}> = [
  { displayKey: "A", firstQuestionNumber: 1 },
  { displayKey: "B", firstQuestionNumber: 7 },
  { displayKey: "C", firstQuestionNumber: 13 },
];

export const PHASE3_FLOW_PARTS_AC = "parts_ac";
export const PHASE3_FLOW_PART_D = "part_d";

/** Deterministic ModuleItem ids — the idempotency keys for creation. */
export function phase3PartsACItemId(moduleId: string): string {
  return `p3ac-${moduleId}`;
}
export function phase3PartDItemId(moduleId: string): string {
  return `p3d-${moduleId}`;
}

export interface ModuleItemRow {
  moduleItemId: string;
  moduleId: string;
  courseId: string;
  itemType: string;
  title: string;
  position: number;
  gating?: unknown;
  payload: Record<string, unknown>;
  completionRule?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface Phase3SetupDeps {
  listModuleItems(moduleId: string): Promise<ModuleItemRow[]>;
  getTemplate(surveyTemplateId: string): Promise<Record<string, unknown> | null>;
  /** Conditional put (attribute_not_exists(moduleItemId)). Returns true when
   *  the row was written, false when a row with that id already exists. */
  createItemIfAbsent(item: ModuleItemRow): Promise<boolean>;
  getModuleItem(moduleItemId: string): Promise<ModuleItemRow | null>;
  putModuleItem(item: ModuleItemRow): Promise<void>;
  now(): string;
}

export interface Phase3SetupArgs {
  moduleId: string;
  courseId: string;
  partsACTemplateId?: unknown;
  partDTemplateId?: unknown;
}

export type Phase3SetupOutcome =
  | {
      status: 200;
      body: {
        partsAC: ModuleItemRow;
        partD: ModuleItemRow;
        created: { partsAC: boolean; partD: boolean };
      };
    }
  | {
      status: 400 | 409 | 500;
      body: {
        error: string;
        conflicts?: {
          partsACCandidateIds?: string[];
          partDCandidateIds?: string[];
        };
      };
    };

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

/** Add an after_item clause without disturbing other gating the item has. */
export function addAfterItemClause(
  gating: unknown,
  moduleItemId: string
): Record<string, unknown> {
  const clause = { kind: "after_item", moduleItemId };
  if (!isRecord(gating) || gating.kind === "open") return clause;
  if (gatingRequiresItem(gating, moduleItemId)) return gating;
  if (gating.kind === "all_of") {
    const clauses = Array.isArray(gating.clauses) ? gating.clauses : [];
    return { ...gating, clauses: [...clauses, clause] };
  }
  return { kind: "all_of", clauses: [gating, clause] };
}

/**
 * Deterministic merge of the Parts A–C wiring into a payload. Preserves every
 * unrelated field; forces the strict A@1/B@7/C@13 cardSections when the
 * current value deviates.
 */
export function mergePartsACPayload(
  currentPayload: unknown,
  acItemId: string,
  surveyTemplateId: string
): Record<string, unknown> {
  const current = isRecord(currentPayload) ? currentPayload : {};
  return {
    ...current,
    surveyTemplateId,
    phase3Flow: PHASE3_FLOW_PARTS_AC,
    feedbackCardsFromItemId: acItemId,
    revealOnSubmit: {
      ...(isRecord(current.revealOnSubmit) ? current.revealOnSubmit : {}),
      unblindAssignmentItemId: acItemId,
    },
    cardSections: hasStrictCardSections(current.cardSections)
      ? current.cardSections
      : PHASE3_CARD_SECTIONS.map((s) => ({ ...s })),
    // Research instrument: students must never see question numbers.
    hideQuestionNumbers: true,
  };
}

/** Deterministic merge of the Part D wiring into a payload. */
export function mergePartDPayload(
  currentPayload: unknown,
  acItemId: string,
  surveyTemplateId: string
): Record<string, unknown> {
  const current = isRecord(currentPayload) ? currentPayload : {};
  return {
    ...current,
    surveyTemplateId,
    phase3Flow: PHASE3_FLOW_PART_D,
    feedbackCardsFromItemId: acItemId,
    requireFeedbackReveal: true,
    hideQuestionNumbers: true,
  };
}

function surveysOf(items: ModuleItemRow[]): ModuleItemRow[] {
  return (items || []).filter((it) => it?.itemType === "survey");
}

function payloadOf(item: ModuleItemRow): Record<string, unknown> {
  return isRecord(item.payload) ? item.payload : {};
}

/** All Parts A–C candidates: setup marker, deterministic id, or legacy
 *  self-referencing feedbackCardsFromItemId. */
export function findPartsACCandidates(
  items: ModuleItemRow[],
  moduleId: string
): ModuleItemRow[] {
  const detId = phase3PartsACItemId(moduleId);
  return surveysOf(items).filter((it) => {
    const p = payloadOf(it);
    return (
      p.phase3Flow === PHASE3_FLOW_PARTS_AC ||
      it.moduleItemId === detId ||
      (typeof p.feedbackCardsFromItemId === "string" &&
        p.feedbackCardsFromItemId === it.moduleItemId)
    );
  });
}

/** All Part D candidates: setup marker, deterministic id, or a survey pointing
 *  its feedbackCardsFromItemId at the (single) Parts A–C item. */
export function findPartDCandidates(
  items: ModuleItemRow[],
  moduleId: string,
  acItem: ModuleItemRow | null
): ModuleItemRow[] {
  const detId = phase3PartDItemId(moduleId);
  return surveysOf(items).filter((it) => {
    if (acItem && it.moduleItemId === acItem.moduleItemId) return false;
    const p = payloadOf(it);
    return (
      p.phase3Flow === PHASE3_FLOW_PART_D ||
      it.moduleItemId === detId ||
      (acItem != null && p.feedbackCardsFromItemId === acItem.moduleItemId)
    );
  });
}

function templateQuestionCount(template: Record<string, unknown>): number | null {
  return Array.isArray(template.questions) ? template.questions.length : null;
}

async function validateTemplate(
  deps: Phase3SetupDeps,
  surveyTemplateId: string,
  label: string,
  expectedCount: number
): Promise<{ error: string } | { error: null }> {
  let template: Record<string, unknown> | null;
  try {
    template = await deps.getTemplate(surveyTemplateId);
  } catch {
    return { error: `${label} survey template "${surveyTemplateId}" could not be read` };
  }
  if (!template) {
    return { error: `${label} survey template "${surveyTemplateId}" does not exist` };
  }
  if (template.isActive === false) {
    return { error: `${label} survey template "${template.name ?? surveyTemplateId}" has been deleted (inactive)` };
  }
  const count = templateQuestionCount(template);
  if (count !== expectedCount) {
    return {
      error: `${label} survey template "${template.name ?? surveyTemplateId}" must have exactly ${expectedCount} questions (it has ${count ?? "an unknown number of"})`,
    };
  }
  return { error: null };
}

function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function samePayloadAndGating(a: ModuleItemRow, b: ModuleItemRow): boolean {
  return (
    JSON.stringify(a.payload) === JSON.stringify(b.payload) &&
    JSON.stringify(a.gating ?? null) === JSON.stringify(b.gating ?? null)
  );
}

/**
 * Re-validate a template pair after adopting a concurrently created row.
 * The preflight validation ran against the REQUEST's ids; once a lost create
 * race swaps in the winner's stored id, the effective pair must be proven
 * valid again (exists, readable, active, 25/9 questions, distinct) before any
 * further writes. Returns an error string, or null when the pair is valid.
 */
async function revalidateAdoptedPair(
  deps: Phase3SetupDeps,
  acTemplateId: string,
  dTemplateId: string
): Promise<string | null> {
  if (acTemplateId === dTemplateId) {
    return "Parts A–C and Part D must use two different survey templates";
  }
  const acCheck = await validateTemplate(
    deps,
    acTemplateId,
    "Parts A–C",
    PHASE3_PARTS_AC_QUESTION_COUNT
  );
  if (acCheck.error) return acCheck.error;
  const dCheck = await validateTemplate(
    deps,
    dTemplateId,
    "Part D",
    PHASE3_PART_D_QUESTION_COUNT
  );
  if (dCheck.error) return dCheck.error;
  return null;
}

export async function executePhase3Setup(
  deps: Phase3SetupDeps,
  args: Phase3SetupArgs
): Promise<Phase3SetupOutcome> {
  const { moduleId, courseId } = args;
  const items = await deps.listModuleItems(moduleId);

  // ── Candidate discovery + conflict guard ──
  const acCandidates = findPartsACCandidates(items, moduleId);
  if (acCandidates.length > 1) {
    return {
      status: 409,
      body: {
        error: `Multiple Parts A–C candidates exist in this module (${acCandidates
          .map((c) => `"${c.title}" [${c.moduleItemId}]`)
          .join(", ")}). Remove the duplicates before running Phase 3 setup.`,
        conflicts: { partsACCandidateIds: acCandidates.map((c) => c.moduleItemId) },
      },
    };
  }
  let acItem: ModuleItemRow | null = acCandidates[0] ?? null;

  const dCandidates = findPartDCandidates(items, moduleId, acItem);
  if (dCandidates.length > 1) {
    return {
      status: 409,
      body: {
        error: `Multiple Part D candidates exist in this module (${dCandidates
          .map((c) => `"${c.title}" [${c.moduleItemId}]`)
          .join(", ")}). Remove the duplicates before running Phase 3 setup.`,
        conflicts: { partDCandidateIds: dCandidates.map((c) => c.moduleItemId) },
      },
    };
  }
  let dItem: ModuleItemRow | null = dCandidates[0] ?? null;

  // ── Template resolution: an existing item's template always wins ──
  // (`let`: a lost create race re-resolves from the winner's stored row below.)
  let acTemplateId =
    (acItem ? strOrNull(payloadOf(acItem).surveyTemplateId) : null) ??
    strOrNull(args.partsACTemplateId);
  let dTemplateId =
    (dItem ? strOrNull(payloadOf(dItem).surveyTemplateId) : null) ??
    strOrNull(args.partDTemplateId);

  if (!acTemplateId) {
    return { status: 400, body: { error: "partsACTemplateId is required (no existing Parts A–C item to take it from)" } };
  }
  if (!dTemplateId) {
    return { status: 400, body: { error: "partDTemplateId is required (no existing Part D item to take it from)" } };
  }
  if (acTemplateId === dTemplateId) {
    return { status: 400, body: { error: "Parts A–C and Part D must use two different survey templates" } };
  }

  const acTplCheck = await validateTemplate(deps, acTemplateId, "Parts A–C", PHASE3_PARTS_AC_QUESTION_COUNT);
  if (acTplCheck.error) return { status: 400, body: { error: acTplCheck.error } };
  const dTplCheck = await validateTemplate(deps, dTemplateId, "Part D", PHASE3_PART_D_QUESTION_COUNT);
  if (dTplCheck.error) return { status: 400, body: { error: dTplCheck.error } };

  const now = deps.now();
  const maxPosition = items.reduce((max, it) => Math.max(max, it.position ?? 0), -1);
  const created = { partsAC: false, partD: false };

  // ── Parts A–C: create-if-absent (deterministic id), then deterministic merge ──
  if (!acItem) {
    const candidate: ModuleItemRow = {
      moduleItemId: phase3PartsACItemId(moduleId),
      moduleId,
      courseId,
      itemType: "survey",
      title: "Phase 3 Survey — Parts A–C",
      position: maxPosition + 1,
      gating: { kind: "open" },
      payload: mergePartsACPayload(
        { instanceLabel: "Phase 3 Parts A–C" },
        phase3PartsACItemId(moduleId),
        acTemplateId
      ),
      completionRule: { kind: "auto_on_submit" },
      createdAt: now,
      updatedAt: now,
    };
    created.partsAC = await deps.createItemIfAbsent(candidate);
    if (created.partsAC) {
      acItem = candidate;
    } else {
      // Lost the create race. Adopt the winner's row — NEVER overwrite it.
      const adopted = await deps.getModuleItem(phase3PartsACItemId(moduleId));
      if (!adopted) {
        return {
          status: 500,
          body: { error: "Parts A–C item creation raced with another request and the row could not be read back — retry" },
        };
      }
      const adoptedTemplateId = strOrNull(payloadOf(adopted).surveyTemplateId);
      if (adoptedTemplateId && adoptedTemplateId !== acTemplateId) {
        return {
          status: 409,
          body: {
            error: `A concurrent setup already created the Parts A–C item with template "${adoptedTemplateId}", which differs from the requested "${acTemplateId}". Nothing was overwritten — re-run setup to adopt the stored configuration.`,
          },
        };
      }
      acTemplateId = adoptedTemplateId ?? acTemplateId;
      const revalidation = await revalidateAdoptedPair(deps, acTemplateId, dTemplateId);
      if (revalidation) {
        return {
          status: 409,
          body: { error: `Adopted a concurrently created Parts A–C item, but its configuration failed validation: ${revalidation}` },
        };
      }
      acItem = adopted;
    }
  }
  {
    const repaired: ModuleItemRow = {
      ...acItem,
      payload: mergePartsACPayload(acItem.payload, acItem.moduleItemId, acTemplateId),
      updatedAt: now,
    };
    if (!samePayloadAndGating(repaired, acItem)) {
      await deps.putModuleItem(repaired);
    }
    acItem = repaired;
  }

  // ── Part D: create-if-absent fully wired, else deterministic repair ──
  if (!dItem) {
    const candidate: ModuleItemRow = {
      moduleItemId: phase3PartDItemId(moduleId),
      moduleId,
      courseId,
      itemType: "survey",
      title: "Phase 3 Survey — Part D",
      position: maxPosition + 2,
      gating: { kind: "after_item", moduleItemId: acItem.moduleItemId },
      payload: mergePartDPayload(
        { instanceLabel: "Phase 3 Part D" },
        acItem.moduleItemId,
        dTemplateId
      ),
      completionRule: { kind: "auto_on_submit" },
      createdAt: now,
      updatedAt: now,
    };
    created.partD = await deps.createItemIfAbsent(candidate);
    if (created.partD) {
      dItem = candidate;
    } else {
      // Lost the create race. Adopt the winner's row — NEVER overwrite it.
      const adopted = await deps.getModuleItem(phase3PartDItemId(moduleId));
      if (!adopted) {
        return {
          status: 500,
          body: { error: "Part D item creation raced with another request and the row could not be read back — retry" },
        };
      }
      const adoptedTemplateId = strOrNull(payloadOf(adopted).surveyTemplateId);
      if (adoptedTemplateId && adoptedTemplateId !== dTemplateId) {
        return {
          status: 409,
          body: {
            error: `A concurrent setup already created the Part D item with template "${adoptedTemplateId}", which differs from the requested "${dTemplateId}". Nothing was overwritten — re-run setup to adopt the stored configuration.`,
          },
        };
      }
      dTemplateId = adoptedTemplateId ?? dTemplateId;
      const revalidation = await revalidateAdoptedPair(deps, acTemplateId, dTemplateId);
      if (revalidation) {
        return {
          status: 409,
          body: { error: `Adopted a concurrently created Part D item, but its configuration failed validation: ${revalidation}` },
        };
      }
      dItem = adopted;
    }
  }
  {
    const repaired: ModuleItemRow = {
      ...dItem,
      payload: mergePartDPayload(dItem.payload, acItem.moduleItemId, dTemplateId),
      gating: addAfterItemClause(dItem.gating, acItem.moduleItemId),
      updatedAt: now,
    };
    if (!samePayloadAndGating(repaired, dItem)) {
      await deps.putModuleItem(repaired);
    }
    dItem = repaired;
  }

  // ── Ordering: Part D must sit IMMEDIATELY after Parts A–C ──
  // Built from the initial listing plus the rows written above (a re-scan may
  // not see just-written rows under eventual consistency). Other items keep
  // their relative order.
  let acFinal: ModuleItemRow = acItem;
  let dFinal: ModuleItemRow = dItem;
  const byId = new Map<string, ModuleItemRow>();
  for (const it of items) byId.set(it.moduleItemId, it);
  byId.set(acFinal.moduleItemId, acFinal);
  byId.set(dFinal.moduleItemId, dFinal);
  const sorted = [...byId.values()].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0)
  );
  const withoutD = sorted.filter((it) => it.moduleItemId !== dFinal.moduleItemId);
  const acIdx = withoutD.findIndex((it) => it.moduleItemId === acFinal.moduleItemId);
  const ordered = [
    ...withoutD.slice(0, acIdx + 1),
    dFinal,
    ...withoutD.slice(acIdx + 1),
  ];
  for (let i = 0; i < ordered.length; i++) {
    const it = ordered[i];
    if ((it.position ?? 0) !== i) {
      const repositioned = { ...it, position: i, updatedAt: now };
      await deps.putModuleItem(repositioned);
      if (it.moduleItemId === acFinal.moduleItemId) acFinal = repositioned;
      if (it.moduleItemId === dFinal.moduleItemId) dFinal = repositioned;
    }
  }

  return {
    status: 200,
    body: { partsAC: acFinal, partD: dFinal, created },
  };
}
