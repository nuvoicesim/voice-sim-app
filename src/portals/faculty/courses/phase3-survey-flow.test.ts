import { describe, expect, it } from "vitest";
import type { ModuleItem } from "../../../slices/moduleItemSlice";
import type { SurveyTemplate } from "../../../slices/surveyTemplateSlice";
import {
  PHASE3_CARD_SECTIONS,
  PHASE3_FLOW_PARTS_AC,
  PHASE3_FLOW_PART_D,
  PHASE3_PARTS_AC_QUESTION_COUNT,
  PHASE3_PART_D_QUESTION_COUNT,
  findPhase3Flow,
  gatingRequiresItem,
  hasStrictCardSections,
  isPartDConnected,
  isPartsACConnected,
  validateExistingFlowTemplates,
  validatePhase3TemplateSelection,
  type TemplateResolution,
} from "./phase3-survey-flow";

function makeItem(overrides: Partial<ModuleItem>): ModuleItem {
  return {
    moduleItemId: "item-1",
    moduleId: "mod-1",
    courseId: "course-1",
    itemType: "survey",
    title: "Survey",
    position: 0,
    payload: {},
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...overrides,
  } as ModuleItem;
}

function makeTemplate(
  id: string,
  questionCount: number,
  extra: Partial<SurveyTemplate> = {}
): SurveyTemplate {
  return {
    surveyTemplateId: id,
    name: `Template ${id}`,
    questions: Array.from({ length: questionCount }, (_, i) => ({
      id: `q${i + 1}`,
      type: "likert" as const,
      prompt: `Question ${i + 1}`,
      required: true,
      config: { scale: 7, leftAnchor: "Low", rightAnchor: "High" },
    })),
    isActive: true,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-01T00:00:00Z",
    ...extra,
  };
}

/** Fully-wired Parts A–C fixture (matches what the server setup writes). */
function wiredAC(id = "ac-1", position = 0): ModuleItem {
  return makeItem({
    moduleItemId: id,
    position,
    payload: {
      surveyTemplateId: "tpl-ac",
      phase3Flow: PHASE3_FLOW_PARTS_AC,
      feedbackCardsFromItemId: id,
      revealOnSubmit: { unblindAssignmentItemId: id },
      cardSections: PHASE3_CARD_SECTIONS.map((s) => ({ ...s })),
      hideQuestionNumbers: true,
    },
  });
}

/** Fully-wired Part D fixture. */
function wiredD(acId: string, id = "d-1", position = 1): ModuleItem {
  return makeItem({
    moduleItemId: id,
    position,
    payload: {
      surveyTemplateId: "tpl-d",
      phase3Flow: PHASE3_FLOW_PART_D,
      feedbackCardsFromItemId: acId,
      requireFeedbackReveal: true,
      hideQuestionNumbers: true,
    },
    gating: { kind: "after_item", moduleItemId: acId },
  });
}

describe("hasStrictCardSections", () => {
  it("accepts only the exact A@1/B@7/C@13 mapping", () => {
    expect(hasStrictCardSections(PHASE3_CARD_SECTIONS.map((s) => ({ ...s })))).toBe(
      true
    );
    // Array order does not matter — the mapping does.
    expect(
      hasStrictCardSections([
        { displayKey: "B", firstQuestionNumber: 7 },
        { displayKey: "C", firstQuestionNumber: 13 },
        { displayKey: "A", firstQuestionNumber: 1 },
      ])
    ).toBe(true);
  });

  it("rejects shifted mappings like A@2/B@8/C@14", () => {
    expect(
      hasStrictCardSections([
        { displayKey: "A", firstQuestionNumber: 2 },
        { displayKey: "B", firstQuestionNumber: 8 },
        { displayKey: "C", firstQuestionNumber: 14 },
      ])
    ).toBe(false);
  });

  it("rejects swapped keys, duplicates, and missing entries", () => {
    expect(
      hasStrictCardSections([
        { displayKey: "A", firstQuestionNumber: 7 },
        { displayKey: "B", firstQuestionNumber: 1 },
        { displayKey: "C", firstQuestionNumber: 13 },
      ])
    ).toBe(false);
    expect(
      hasStrictCardSections([
        { displayKey: "A", firstQuestionNumber: 1 },
        { displayKey: "A", firstQuestionNumber: 7 },
        { displayKey: "C", firstQuestionNumber: 13 },
      ])
    ).toBe(false);
    expect(hasStrictCardSections(undefined)).toBe(false);
    expect(hasStrictCardSections([])).toBe(false);
  });
});

describe("connection predicates", () => {
  it("recognizes a fully-wired Parts A–C item", () => {
    expect(isPartsACConnected(wiredAC())).toBe(true);
  });

  it("rejects Parts A–C with non-strict cardSections", () => {
    const item = wiredAC();
    item.payload.cardSections = [
      { displayKey: "A", firstQuestionNumber: 2 },
      { displayKey: "B", firstQuestionNumber: 8 },
      { displayKey: "C", firstQuestionNumber: 14 },
    ];
    expect(isPartsACConnected(item)).toBe(false);
  });

  it("rejects Parts A–C without hideQuestionNumbers", () => {
    const item = wiredAC();
    delete item.payload.hideQuestionNumbers;
    expect(isPartsACConnected(item)).toBe(false);
  });

  it("rejects Parts A–C pointing at a different item or missing revealOnSubmit", () => {
    const wrongRef = wiredAC();
    wrongRef.payload.feedbackCardsFromItemId = "other";
    expect(isPartsACConnected(wrongRef)).toBe(false);

    const noReveal = wiredAC();
    delete noReveal.payload.revealOnSubmit;
    expect(isPartsACConnected(noReveal)).toBe(false);
  });

  it("recognizes a fully-wired Part D item", () => {
    expect(isPartDConnected(wiredD("ac-1"), "ac-1")).toBe(true);
  });

  it("rejects Part D missing the reveal gate, after_item gate, or hidden numbers", () => {
    const noReveal = wiredD("ac-1");
    noReveal.payload.requireFeedbackReveal = false;
    expect(isPartDConnected(noReveal, "ac-1")).toBe(false);

    const noGate = wiredD("ac-1");
    noGate.gating = { kind: "open" };
    expect(isPartDConnected(noGate, "ac-1")).toBe(false);

    const numbersShown = wiredD("ac-1");
    delete numbersShown.payload.hideQuestionNumbers;
    expect(isPartDConnected(numbersShown, "ac-1")).toBe(false);
  });

  it("accepts the after_item gate nested inside all_of", () => {
    const item = wiredD("ac-1");
    item.gating = {
      kind: "all_of",
      clauses: [
        { kind: "group_in", groups: ["VOICE_FIRST"] },
        { kind: "after_item", moduleItemId: "ac-1" },
      ],
    };
    expect(isPartDConnected(item, "ac-1")).toBe(true);
  });
});

describe("gatingRequiresItem", () => {
  it("matches only the exact target item", () => {
    expect(
      gatingRequiresItem({ kind: "after_item", moduleItemId: "ac-1" }, "ac-1")
    ).toBe(true);
    expect(
      gatingRequiresItem({ kind: "after_item", moduleItemId: "ac-1" }, "other")
    ).toBe(false);
    expect(gatingRequiresItem({ kind: "open" }, "ac-1")).toBe(false);
    expect(gatingRequiresItem(undefined, "ac-1")).toBe(false);
  });
});

describe("findPhase3Flow", () => {
  it("reports an empty module as no flow", () => {
    const flow = findPhase3Flow([]);
    expect(flow.partsAC).toBeNull();
    expect(flow.partD).toBeNull();
    expect(flow.conflict).toBe(false);
    expect(flow.complete).toBe(false);
  });

  it("is complete only when both items are wired AND adjacent", () => {
    const ac = wiredAC("ac-1", 0);
    const d = wiredD("ac-1", "d-1", 1);
    const trailing = makeItem({
      moduleItemId: "instr-1",
      itemType: "instruction",
      position: 2,
    });
    const flow = findPhase3Flow([ac, d, trailing]);
    expect(flow.orderCorrect).toBe(true);
    expect(flow.complete).toBe(true);
  });

  it("is NOT complete when another item sits between Parts A–C and Part D", () => {
    const ac = wiredAC("ac-1", 0);
    const between = makeItem({
      moduleItemId: "instr-1",
      itemType: "instruction",
      position: 1,
    });
    const d = wiredD("ac-1", "d-1", 2);
    const flow = findPhase3Flow([ac, between, d]);
    expect(flow.partsACConnected).toBe(true);
    expect(flow.partDConnected).toBe(true);
    expect(flow.orderCorrect).toBe(false);
    expect(flow.complete).toBe(false);
  });

  it("is NOT complete when Part D precedes Parts A–C", () => {
    const d = wiredD("ac-1", "d-1", 0);
    const ac = wiredAC("ac-1", 1);
    const flow = findPhase3Flow([d, ac]);
    expect(flow.orderCorrect).toBe(false);
    expect(flow.complete).toBe(false);
  });

  it("reports a conflict (and no chosen item) for multiple Parts A–C candidates", () => {
    const a1 = wiredAC("ac-1", 0);
    const a2 = makeItem({
      moduleItemId: "ac-2",
      position: 1,
      payload: { surveyTemplateId: "tpl-x", phase3Flow: PHASE3_FLOW_PARTS_AC },
    });
    const flow = findPhase3Flow([a1, a2]);
    expect(flow.conflict).toBe(true);
    expect(flow.acCandidates.map((c) => c.moduleItemId)).toEqual(["ac-1", "ac-2"]);
    expect(flow.partsAC).toBeNull();
    expect(flow.complete).toBe(false);
  });

  it("reports a conflict for multiple Part D candidates", () => {
    const ac = wiredAC("ac-1", 0);
    const d1 = wiredD("ac-1", "d-1", 1);
    const d2 = makeItem({
      moduleItemId: "d-2",
      position: 2,
      payload: { surveyTemplateId: "tpl-y", feedbackCardsFromItemId: "ac-1" },
    });
    const flow = findPhase3Flow([ac, d1, d2]);
    expect(flow.conflict).toBe(true);
    expect(flow.dCandidates.map((c) => c.moduleItemId)).toEqual(["d-1", "d-2"]);
    expect(flow.partD).toBeNull();
    expect(flow.complete).toBe(false);
  });

  it("detects a legacy hand-wired flow but marks it incomplete (no hidden numbers)", () => {
    const ac = makeItem({
      moduleItemId: "ac-1",
      position: 0,
      payload: {
        surveyTemplateId: "tpl-ac",
        feedbackCardsFromItemId: "ac-1",
        revealOnSubmit: { unblindAssignmentItemId: "ac-1" },
        cardSections: PHASE3_CARD_SECTIONS.map((s) => ({ ...s })),
      },
    });
    const d = makeItem({
      moduleItemId: "d-1",
      position: 1,
      payload: {
        surveyTemplateId: "tpl-d",
        feedbackCardsFromItemId: "ac-1",
        requireFeedbackReveal: true,
      },
      gating: { kind: "after_item", moduleItemId: "ac-1" },
    });
    const flow = findPhase3Flow([ac, d]);
    expect(flow.partsAC?.moduleItemId).toBe("ac-1");
    expect(flow.partD?.moduleItemId).toBe("d-1");
    // hideQuestionNumbers missing → resumable, not "Configured".
    expect(flow.partsACConnected).toBe(false);
    expect(flow.complete).toBe(false);
  });

  it("never mistakes the Parts A–C item for Part D and ignores non-surveys", () => {
    expect(findPhase3Flow([wiredAC("ac-1")]).partD).toBeNull();
    const impostor = makeItem({
      moduleItemId: "x-1",
      itemType: "instruction",
      payload: { phase3Flow: PHASE3_FLOW_PARTS_AC },
    });
    expect(findPhase3Flow([impostor]).partsAC).toBeNull();
  });
});

describe("validatePhase3TemplateSelection", () => {
  const ac25 = makeTemplate("tpl-ac", PHASE3_PARTS_AC_QUESTION_COUNT);
  const d9 = makeTemplate("tpl-d", PHASE3_PART_D_QUESTION_COUNT);

  it("passes two correctly-sized distinct templates", () => {
    expect(
      validatePhase3TemplateSelection({
        acTemplate: ac25,
        dTemplate: d9,
        needAC: true,
        needD: true,
      })
    ).toEqual([]);
  });

  it("requires both selections when both items are missing", () => {
    expect(
      validatePhase3TemplateSelection({
        acTemplate: null,
        dTemplate: null,
        needAC: true,
        needD: true,
      })
    ).toHaveLength(2);
  });

  it("rejects wrong question counts", () => {
    const errors = validatePhase3TemplateSelection({
      acTemplate: makeTemplate("tpl-ac", 24),
      dTemplate: makeTemplate("tpl-d", 10),
      needAC: true,
      needD: true,
    });
    expect(errors.some((e) => e.includes("25 questions"))).toBe(true);
    expect(errors.some((e) => e.includes("9 questions"))).toBe(true);
  });

  it("rejects using one template for both parts", () => {
    const errors = validatePhase3TemplateSelection({
      acTemplate: ac25,
      dTemplate: ac25,
      needAC: true,
      needD: true,
    });
    expect(errors.some((e) => e.includes("different templates"))).toBe(true);
  });

  it("rejects a selection colliding with the EXISTING counterpart's template", () => {
    const errors = validatePhase3TemplateSelection({
      acTemplate: null,
      dTemplate: makeTemplate("tpl-existing", PHASE3_PART_D_QUESTION_COUNT),
      needAC: false,
      needD: true,
      existingAcTemplateId: "tpl-existing",
    });
    expect(errors.some((e) => e.includes("different templates"))).toBe(true);
  });

  it("skips selection validation for parts that already exist", () => {
    expect(
      validatePhase3TemplateSelection({
        acTemplate: null,
        dTemplate: d9,
        needAC: false,
        needD: true,
        existingAcTemplateId: "tpl-ac",
      })
    ).toEqual([]);
  });
});

describe("validateExistingFlowTemplates", () => {
  const resolver =
    (map: Record<string, TemplateResolution>) =>
    (id: string): TemplateResolution =>
      map[id] ?? "unavailable";

  it("passes a configured flow with valid, distinct, correctly-sized templates", () => {
    const flow = findPhase3Flow([wiredAC("ac-1", 0), wiredD("ac-1", "d-1", 1)]);
    const { errors, pending } = validateExistingFlowTemplates(
      flow,
      resolver({
        "tpl-ac": makeTemplate("tpl-ac", 25),
        "tpl-d": makeTemplate("tpl-d", 9),
      })
    );
    expect(errors).toEqual([]);
    expect(pending).toBe(false);
  });

  it("is pending while a referenced template is still loading", () => {
    const flow = findPhase3Flow([wiredAC("ac-1", 0), wiredD("ac-1", "d-1", 1)]);
    const { errors, pending } = validateExistingFlowTemplates(
      flow,
      resolver({ "tpl-ac": "loading", "tpl-d": makeTemplate("tpl-d", 9) })
    );
    expect(pending).toBe(true);
    expect(errors).toEqual([]);
  });

  it("errors when a referenced template cannot be read", () => {
    const flow = findPhase3Flow([wiredAC("ac-1", 0), wiredD("ac-1", "d-1", 1)]);
    const { errors } = validateExistingFlowTemplates(
      flow,
      resolver({ "tpl-d": makeTemplate("tpl-d", 9) })
    );
    expect(errors.some((e) => e.includes("cannot be read"))).toBe(true);
  });

  it("errors on wrong question counts and inactive templates", () => {
    const flow = findPhase3Flow([wiredAC("ac-1", 0), wiredD("ac-1", "d-1", 1)]);
    const { errors } = validateExistingFlowTemplates(
      flow,
      resolver({
        "tpl-ac": makeTemplate("tpl-ac", 24),
        "tpl-d": makeTemplate("tpl-d", 9, { isActive: false }),
      })
    );
    expect(errors.some((e) => e.includes("exactly 25 questions"))).toBe(true);
    expect(errors.some((e) => e.includes("inactive"))).toBe(true);
  });

  it("errors when both items share one template", () => {
    const ac = wiredAC("ac-1", 0);
    const d = wiredD("ac-1", "d-1", 1);
    d.payload.surveyTemplateId = "tpl-ac";
    const flow = findPhase3Flow([ac, d]);
    const { errors } = validateExistingFlowTemplates(
      flow,
      resolver({ "tpl-ac": makeTemplate("tpl-ac", 25) })
    );
    expect(errors.some((e) => e.includes("two different templates"))).toBe(true);
  });

  it("errors when an item has no template at all", () => {
    const ac = wiredAC("ac-1", 0);
    delete ac.payload.surveyTemplateId;
    const flow = findPhase3Flow([ac]);
    const { errors } = validateExistingFlowTemplates(flow, resolver({}));
    expect(errors.some((e) => e.includes("no survey template"))).toBe(true);
  });
});
