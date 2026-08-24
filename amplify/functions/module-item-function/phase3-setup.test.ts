import { describe, expect, it } from "vitest";
import {
  executePhase3Setup,
  findPartDCandidates,
  findPartsACCandidates,
  hasStrictCardSections,
  mergePartsACPayload,
  phase3PartDItemId,
  phase3PartsACItemId,
  type ModuleItemRow,
  type Phase3SetupDeps,
} from "./phase3-setup";

const MODULE_ID = "mod-1";
const COURSE_ID = "course-1";
const NOW = "2026-08-23T00:00:00Z";

function template(id: string, count: number, extra: Record<string, unknown> = {}) {
  return {
    surveyTemplateId: id,
    name: `Template ${id}`,
    questions: Array.from({ length: count }, (_, i) => ({ id: `q${i + 1}` })),
    isActive: true,
    ...extra,
  };
}

function row(overrides: Partial<ModuleItemRow>): ModuleItemRow {
  return {
    moduleItemId: "item-x",
    moduleId: MODULE_ID,
    courseId: COURSE_ID,
    itemType: "survey",
    title: "Survey",
    position: 0,
    payload: {},
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** In-memory fake of the DynamoDB operations, with an atomic conditional put. */
function makeStore(
  seedItems: ModuleItemRow[] = [],
  seedTemplates: Record<string, unknown>[] = [
    template("tpl-ac", 25),
    template("tpl-d", 9),
  ]
) {
  const items = new Map<string, ModuleItemRow>(
    seedItems.map((i) => [i.moduleItemId, { ...i }])
  );
  const templates = new Map(
    seedTemplates.map((t) => [t.surveyTemplateId as string, t])
  );
  let puts = 0;
  const deps: Phase3SetupDeps = {
    listModuleItems: async (moduleId) =>
      [...items.values()]
        .filter((i) => i.moduleId === moduleId)
        .map((i) => ({ ...i })),
    getTemplate: async (id) => {
      const t = templates.get(id);
      return t ? { ...t } : null;
    },
    createItemIfAbsent: async (item) => {
      if (items.has(item.moduleItemId)) return false;
      items.set(item.moduleItemId, { ...item });
      return true;
    },
    getModuleItem: async (id) => {
      const it = items.get(id);
      return it ? { ...it } : null;
    },
    putModuleItem: async (item) => {
      puts += 1;
      items.set(item.moduleItemId, { ...item });
    },
    now: () => NOW,
  };
  return {
    deps,
    items,
    getPuts: () => puts,
    sorted: () =>
      [...items.values()].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)),
  };
}

function run(
  store: ReturnType<typeof makeStore>,
  body: { partsACTemplateId?: unknown; partDTemplateId?: unknown } = {
    partsACTemplateId: "tpl-ac",
    partDTemplateId: "tpl-d",
  }
) {
  return executePhase3Setup(store.deps, {
    moduleId: MODULE_ID,
    courseId: COURSE_ID,
    ...body,
  });
}

describe("hasStrictCardSections", () => {
  it("accepts only the exact A@1/B@7/C@13 mapping (any array order)", () => {
    expect(
      hasStrictCardSections([
        { displayKey: "A", firstQuestionNumber: 1 },
        { displayKey: "B", firstQuestionNumber: 7 },
        { displayKey: "C", firstQuestionNumber: 13 },
      ])
    ).toBe(true);
    expect(
      hasStrictCardSections([
        { displayKey: "C", firstQuestionNumber: 13 },
        { displayKey: "A", firstQuestionNumber: 1 },
        { displayKey: "B", firstQuestionNumber: 7 },
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

  it("rejects missing, duplicate, or malformed entries", () => {
    expect(hasStrictCardSections(undefined)).toBe(false);
    expect(hasStrictCardSections([])).toBe(false);
    expect(
      hasStrictCardSections([
        { displayKey: "A", firstQuestionNumber: 1 },
        { displayKey: "A", firstQuestionNumber: 7 },
        { displayKey: "C", firstQuestionNumber: 13 },
      ])
    ).toBe(false);
  });
});

describe("executePhase3Setup — fresh module", () => {
  it("creates both items fully wired and adjacent", async () => {
    const store = makeStore();
    const outcome = await run(store);
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(outcome.body.created).toEqual({ partsAC: true, partD: true });

    const ac = outcome.body.partsAC;
    const d = outcome.body.partD;
    expect(ac.moduleItemId).toBe(phase3PartsACItemId(MODULE_ID));
    expect(ac.payload.surveyTemplateId).toBe("tpl-ac");
    expect(ac.payload.feedbackCardsFromItemId).toBe(ac.moduleItemId);
    expect(
      (ac.payload.revealOnSubmit as Record<string, unknown>).unblindAssignmentItemId
    ).toBe(ac.moduleItemId);
    expect(hasStrictCardSections(ac.payload.cardSections)).toBe(true);
    expect(ac.payload.hideQuestionNumbers).toBe(true);

    expect(d.moduleItemId).toBe(phase3PartDItemId(MODULE_ID));
    expect(d.payload.surveyTemplateId).toBe("tpl-d");
    expect(d.payload.feedbackCardsFromItemId).toBe(ac.moduleItemId);
    expect(d.payload.requireFeedbackReveal).toBe(true);
    expect(d.payload.hideQuestionNumbers).toBe(true);
    expect(d.gating).toEqual({ kind: "after_item", moduleItemId: ac.moduleItemId });

    expect(d.position).toBe(ac.position + 1);
    expect(store.items.size).toBe(2);
  });
});

describe("executePhase3Setup — idempotency and concurrency", () => {
  it("a second identical call changes nothing", async () => {
    const store = makeStore();
    await run(store);
    const before = JSON.stringify(store.sorted());
    const putsBefore = store.getPuts();

    const second = await run(store);
    expect(second.status).toBe(200);
    if (second.status !== 200) return;
    expect(second.body.created).toEqual({ partsAC: false, partD: false });
    expect(store.items.size).toBe(2);
    expect(store.getPuts()).toBe(putsBefore); // no rewrites at all
    expect(JSON.stringify(store.sorted())).toBe(before);
  });

  it("two concurrent requests with the SAME templates converge on the same two rows", async () => {
    const store = makeStore();
    const [a, b] = await Promise.all([run(store), run(store)]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(store.items.size).toBe(2);
    // Exactly one request won each conditional create.
    const wins = [a, b]
      .filter((o) => o.status === 200)
      .map((o) => (o.status === 200 ? o.body.created : null));
    expect(wins.filter((w) => w?.partsAC).length).toBe(1);
    expect(wins.filter((w) => w?.partD).length).toBe(1);
    // Every 200 response reports the template ids that are actually stored.
    const storedAc = store.items.get(phase3PartsACItemId(MODULE_ID))!;
    const storedD = store.items.get(phase3PartDItemId(MODULE_ID))!;
    expect(storedAc.payload.surveyTemplateId).toBe("tpl-ac");
    expect(storedD.payload.surveyTemplateId).toBe("tpl-d");
    for (const outcome of [a, b]) {
      if (outcome.status !== 200) continue;
      expect(outcome.body.partsAC.payload.surveyTemplateId).toBe(
        storedAc.payload.surveyTemplateId
      );
      expect(outcome.body.partD.payload.surveyTemplateId).toBe(
        storedD.payload.surveyTemplateId
      );
    }
  });

  it("the loser of the create race adopts the winner's row (createItemIfAbsent=false)", async () => {
    const store = makeStore();
    // Simulate: another request created both rows between our list and create.
    const original = store.deps.listModuleItems;
    let injected = false;
    store.deps.listModuleItems = async (mid) => {
      const result = await original(mid);
      if (!injected) {
        injected = true;
        await run(makeStoreView(store)); // winner completes first
      }
      return result; // stale empty listing for the loser
    };
    const outcome = await run(store);
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(outcome.body.created).toEqual({ partsAC: false, partD: false });
    expect(store.items.size).toBe(2);
  });
});

/** A second deps view over the same underlying maps (same store, new counters). */
function makeStoreView(store: ReturnType<typeof makeStore>) {
  return {
    deps: {
      ...store.deps,
      listModuleItems: async (mid: string) =>
        [...store.items.values()].filter((i) => i.moduleId === mid),
    },
    items: store.items,
    getPuts: store.getPuts,
    sorted: store.sorted,
  } as ReturnType<typeof makeStore>;
}

describe("executePhase3Setup — concurrent requests with DIFFERENT template selections", () => {
  const FOUR_TEMPLATES = [
    template("tpl-ac", 25),
    template("tpl-ac2", 25),
    template("tpl-d", 9),
    template("tpl-d2", 9),
  ];

  it("only one selection becomes the final result; every 200 matches storage", async () => {
    const store = makeStore([], FOUR_TEMPLATES);
    const [a, b] = await Promise.all([
      run(store, { partsACTemplateId: "tpl-ac", partDTemplateId: "tpl-d" }),
      run(store, { partsACTemplateId: "tpl-ac2", partDTemplateId: "tpl-d2" }),
    ]);

    // No extra items, ever.
    expect(store.items.size).toBe(2);
    const storedAc = store.items.get(phase3PartsACItemId(MODULE_ID))!;
    const storedD = store.items.get(phase3PartDItemId(MODULE_ID))!;

    // Exactly one coherent selection persisted — never a mix of the two.
    expect([
      ["tpl-ac", "tpl-d"],
      ["tpl-ac2", "tpl-d2"],
    ]).toContainEqual([
      storedAc.payload.surveyTemplateId,
      storedD.payload.surveyTemplateId,
    ]);

    // At least one request succeeded; a diverging loser reports 409.
    const outcomes = [a, b];
    expect(outcomes.some((o) => o.status === 200)).toBe(true);
    for (const outcome of outcomes) {
      expect([200, 409]).toContain(outcome.status);
      if (outcome.status === 200) {
        // A success response always matches what is actually stored.
        expect(outcome.body.partsAC.payload.surveyTemplateId).toBe(
          storedAc.payload.surveyTemplateId
        );
        expect(outcome.body.partD.payload.surveyTemplateId).toBe(
          storedD.payload.surveyTemplateId
        );
      } else if (outcome.status === 409) {
        expect(outcome.body.error).toMatch(/differs from the requested/);
      }
    }
  });

  it("a stale loser with a fully different selection cannot overwrite the winner", async () => {
    const store = makeStore([], FOUR_TEMPLATES);
    const winner = await run(store, {
      partsACTemplateId: "tpl-ac",
      partDTemplateId: "tpl-d",
    });
    expect(winner.status).toBe(200);
    const putsAfterWinner = store.getPuts();

    // Stale listing forces the loser down the create-race path.
    const staleDeps: Phase3SetupDeps = {
      ...store.deps,
      listModuleItems: async () => [],
    };
    const loser = await executePhase3Setup(staleDeps, {
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
      partsACTemplateId: "tpl-ac2",
      partDTemplateId: "tpl-d2",
    });

    expect(loser.status).toBe(409);
    if (loser.status === 409) {
      expect(loser.body.error).toMatch(/Nothing was overwritten/);
    }
    // Zero writes by the loser; the winner's configuration is intact.
    expect(store.getPuts()).toBe(putsAfterWinner);
    expect(store.items.size).toBe(2);
    expect(
      store.items.get(phase3PartsACItemId(MODULE_ID))!.payload.surveyTemplateId
    ).toBe("tpl-ac");
    expect(
      store.items.get(phase3PartDItemId(MODULE_ID))!.payload.surveyTemplateId
    ).toBe("tpl-d");
  });

  it("a stale loser diverging only on Part D stops at Part D without overwriting", async () => {
    const store = makeStore([], FOUR_TEMPLATES);
    const winner = await run(store, {
      partsACTemplateId: "tpl-ac",
      partDTemplateId: "tpl-d",
    });
    expect(winner.status).toBe(200);
    const putsAfterWinner = store.getPuts();

    const staleDeps: Phase3SetupDeps = {
      ...store.deps,
      listModuleItems: async () => [],
    };
    const loser = await executePhase3Setup(staleDeps, {
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
      partsACTemplateId: "tpl-ac", // same Parts A–C → adopted silently
      partDTemplateId: "tpl-d2", // different Part D → 409, no overwrite
    });

    expect(loser.status).toBe(409);
    if (loser.status === 409) {
      expect(loser.body.error).toMatch(/Part D item with template "tpl-d"/);
    }
    expect(store.getPuts()).toBe(putsAfterWinner);
    expect(
      store.items.get(phase3PartDItemId(MODULE_ID))!.payload.surveyTemplateId
    ).toBe("tpl-d");
  });

  it("a retry after a divergence 409 is idempotent: adopts the winner, zero writes", async () => {
    const store = makeStore([], FOUR_TEMPLATES);
    await run(store, { partsACTemplateId: "tpl-ac", partDTemplateId: "tpl-d" });
    const staleDeps: Phase3SetupDeps = {
      ...store.deps,
      listModuleItems: async () => [],
    };
    const denied = await executePhase3Setup(staleDeps, {
      moduleId: MODULE_ID,
      courseId: COURSE_ID,
      partsACTemplateId: "tpl-ac2",
      partDTemplateId: "tpl-d2",
    });
    expect(denied.status).toBe(409);

    // Retry with a fresh listing (no template args needed — existing items win).
    const putsBefore = store.getPuts();
    const retry = await run(store, {});
    expect(retry.status).toBe(200);
    if (retry.status !== 200) return;
    expect(retry.body.created).toEqual({ partsAC: false, partD: false });
    expect(retry.body.partsAC.payload.surveyTemplateId).toBe("tpl-ac");
    expect(retry.body.partD.payload.surveyTemplateId).toBe("tpl-d");
    expect(store.items.size).toBe(2);
    expect(store.getPuts()).toBe(putsBefore);
  });
});

describe("executePhase3Setup — resume after partial failure", () => {
  it("connects an orphan Parts A–C item and creates only Part D", async () => {
    const store = makeStore([
      row({
        moduleItemId: "legacy-ac",
        title: "Phase 3 Survey — Parts A–C",
        position: 0,
        payload: {
          surveyTemplateId: "tpl-ac",
          instanceLabel: "keep-me",
          phase3Flow: "parts_ac",
        },
      }),
    ]);
    const outcome = await run(store, { partDTemplateId: "tpl-d" });
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    expect(outcome.body.created).toEqual({ partsAC: false, partD: true });
    expect(store.items.size).toBe(2);

    const ac = outcome.body.partsAC;
    expect(ac.moduleItemId).toBe("legacy-ac");
    expect(ac.payload.instanceLabel).toBe("keep-me"); // preserved
    expect(ac.payload.feedbackCardsFromItemId).toBe("legacy-ac");
    expect(hasStrictCardSections(ac.payload.cardSections)).toBe(true);
    expect(outcome.body.partD.payload.feedbackCardsFromItemId).toBe("legacy-ac");
  });

  it("rewrites wrong cardSections to the strict mapping, preserving other fields", async () => {
    const store = makeStore([
      row({
        moduleItemId: "legacy-ac",
        position: 0,
        payload: {
          surveyTemplateId: "tpl-ac",
          phase3Flow: "parts_ac",
          customNote: "do-not-lose",
          feedbackCardsFromItemId: "legacy-ac",
          revealOnSubmit: { unblindAssignmentItemId: "legacy-ac", note: "keep" },
          cardSections: [
            { displayKey: "A", firstQuestionNumber: 2 },
            { displayKey: "B", firstQuestionNumber: 8 },
            { displayKey: "C", firstQuestionNumber: 14 },
          ],
        },
      }),
    ]);
    const outcome = await run(store, { partDTemplateId: "tpl-d" });
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    const ac = outcome.body.partsAC;
    expect(ac.payload.cardSections).toEqual([
      { displayKey: "A", firstQuestionNumber: 1 },
      { displayKey: "B", firstQuestionNumber: 7 },
      { displayKey: "C", firstQuestionNumber: 13 },
    ]);
    expect(ac.payload.customNote).toBe("do-not-lose");
    expect(
      (ac.payload.revealOnSubmit as Record<string, unknown>).note
    ).toBe("keep");
  });

  it("repairs an existing Part D without losing payload fields or gating clauses", async () => {
    const acData = mergePartsACPayload(
      { surveyTemplateId: "tpl-ac" },
      "legacy-ac",
      "tpl-ac"
    );
    const store = makeStore([
      row({ moduleItemId: "legacy-ac", position: 0, payload: acData }),
      row({
        moduleItemId: "legacy-d",
        title: "Part D",
        position: 1,
        payload: {
          surveyTemplateId: "tpl-d",
          phase3Flow: "part_d",
          extra: "keep",
        },
        gating: { kind: "group_in", groups: ["VOICE_FIRST"] },
      }),
    ]);
    const outcome = await run(store, {});
    expect(outcome.status).toBe(200);
    if (outcome.status !== 200) return;
    const d = outcome.body.partD;
    expect(d.moduleItemId).toBe("legacy-d");
    expect(d.payload.extra).toBe("keep");
    expect(d.payload.requireFeedbackReveal).toBe(true);
    expect(d.payload.hideQuestionNumbers).toBe(true);
    expect(d.gating).toEqual({
      kind: "all_of",
      clauses: [
        { kind: "group_in", groups: ["VOICE_FIRST"] },
        { kind: "after_item", moduleItemId: "legacy-ac" },
      ],
    });
    expect(store.items.size).toBe(2);
  });
});

describe("executePhase3Setup — conflicts", () => {
  it("refuses to pick between multiple Parts A–C candidates", async () => {
    const store = makeStore([
      row({
        moduleItemId: "ac-1",
        position: 0,
        payload: { surveyTemplateId: "tpl-ac", phase3Flow: "parts_ac" },
      }),
      row({
        moduleItemId: "ac-2",
        position: 1,
        payload: { surveyTemplateId: "tpl-ac", feedbackCardsFromItemId: "ac-2" },
      }),
    ]);
    const outcome = await run(store);
    expect(outcome.status).toBe(409);
    if (outcome.status !== 409) return;
    expect(outcome.body.conflicts?.partsACCandidateIds).toEqual(["ac-1", "ac-2"]);
    expect(store.getPuts()).toBe(0);
    expect(store.items.size).toBe(2); // nothing created
  });

  it("refuses to pick between multiple Part D candidates", async () => {
    const acPayload = mergePartsACPayload(
      { surveyTemplateId: "tpl-ac" },
      "ac-1",
      "tpl-ac"
    );
    const store = makeStore([
      row({ moduleItemId: "ac-1", position: 0, payload: acPayload }),
      row({
        moduleItemId: "d-1",
        position: 1,
        payload: { surveyTemplateId: "tpl-d", phase3Flow: "part_d" },
      }),
      row({
        moduleItemId: "d-2",
        position: 2,
        payload: { surveyTemplateId: "tpl-d", feedbackCardsFromItemId: "ac-1" },
      }),
    ]);
    const outcome = await run(store);
    expect(outcome.status).toBe(409);
    if (outcome.status !== 409) return;
    expect(outcome.body.conflicts?.partDCandidateIds).toEqual(["d-1", "d-2"]);
    expect(store.getPuts()).toBe(0);
  });
});

describe("executePhase3Setup — template validation", () => {
  it("requires template ids when no existing item provides them", async () => {
    const store = makeStore();
    const noAc = await run(store, { partDTemplateId: "tpl-d" });
    expect(noAc.status).toBe(400);
    const noD = await run(store, { partsACTemplateId: "tpl-ac" });
    expect(noD.status).toBe(400);
    expect(store.items.size).toBe(0);
  });

  it("rejects a missing template", async () => {
    const store = makeStore([], [template("tpl-d", 9)]);
    const outcome = await run(store);
    expect(outcome.status).toBe(400);
    if (outcome.status === 400) {
      expect(outcome.body.error).toMatch(/does not exist/);
    }
  });

  it("rejects wrong question counts (24 for A–C, 10 for D)", async () => {
    const store = makeStore([], [template("tpl-ac", 24), template("tpl-d", 9)]);
    const outcome = await run(store);
    expect(outcome.status).toBe(400);
    if (outcome.status === 400) {
      expect(outcome.body.error).toMatch(/exactly 25 questions/);
    }

    const store2 = makeStore([], [template("tpl-ac", 25), template("tpl-d", 10)]);
    const outcome2 = await run(store2);
    expect(outcome2.status).toBe(400);
    if (outcome2.status === 400) {
      expect(outcome2.body.error).toMatch(/exactly 9 questions/);
    }
  });

  it("rejects the same template for both parts", async () => {
    const store = makeStore();
    const outcome = await run(store, {
      partsACTemplateId: "tpl-ac",
      partDTemplateId: "tpl-ac",
    });
    expect(outcome.status).toBe(400);
    if (outcome.status === 400) {
      expect(outcome.body.error).toMatch(/different survey templates/);
    }
  });

  it("rejects an inactive (soft-deleted) template", async () => {
    const store = makeStore(
      [],
      [template("tpl-ac", 25, { isActive: false }), template("tpl-d", 9)]
    );
    const outcome = await run(store);
    expect(outcome.status).toBe(400);
    if (outcome.status === 400) {
      expect(outcome.body.error).toMatch(/inactive/);
    }
  });

  it("rejects when the template store cannot be read", async () => {
    const store = makeStore();
    store.deps.getTemplate = async () => {
      throw new Error("boom");
    };
    const outcome = await run(store);
    expect(outcome.status).toBe(400);
    if (outcome.status === 400) {
      expect(outcome.body.error).toMatch(/could not be read/);
    }
  });

  it("validates templates on a legacy flow too (existing item's template wins)", async () => {
    const acPayload = mergePartsACPayload(
      { surveyTemplateId: "tpl-legacy" },
      "ac-1",
      "tpl-legacy"
    );
    const store = makeStore(
      [row({ moduleItemId: "ac-1", position: 0, payload: acPayload })],
      [template("tpl-legacy", 24), template("tpl-d", 9)] // wrong count
    );
    const outcome = await run(store, { partDTemplateId: "tpl-d" });
    expect(outcome.status).toBe(400);
    if (outcome.status === 400) {
      expect(outcome.body.error).toMatch(/exactly 25 questions/);
    }
  });
});

describe("executePhase3Setup — ordering", () => {
  it("moves Part D directly after Parts A–C, preserving other items' relative order", async () => {
    const acPayload = mergePartsACPayload(
      { surveyTemplateId: "tpl-ac" },
      "ac-1",
      "tpl-ac"
    );
    const store = makeStore([
      row({ moduleItemId: "instr-0", itemType: "instruction", position: 0, payload: {} }),
      row({
        moduleItemId: "d-1",
        position: 1,
        payload: { surveyTemplateId: "tpl-d", phase3Flow: "part_d" },
        gating: { kind: "after_item", moduleItemId: "ac-1" },
      }),
      row({ moduleItemId: "instr-1", itemType: "instruction", position: 2, payload: {} }),
      row({ moduleItemId: "ac-1", position: 3, payload: acPayload }),
    ]);
    const outcome = await run(store, {});
    expect(outcome.status).toBe(200);
    expect(store.sorted().map((i) => i.moduleItemId)).toEqual([
      "instr-0",
      "instr-1",
      "ac-1",
      "d-1",
    ]);
    expect(store.sorted().map((i) => i.position)).toEqual([0, 1, 2, 3]);
  });

  it("closes a gap when another item sits between Parts A–C and Part D", async () => {
    const acPayload = mergePartsACPayload(
      { surveyTemplateId: "tpl-ac" },
      "ac-1",
      "tpl-ac"
    );
    const store = makeStore([
      row({ moduleItemId: "ac-1", position: 0, payload: acPayload }),
      row({ moduleItemId: "instr-0", itemType: "instruction", position: 1, payload: {} }),
      row({
        moduleItemId: "d-1",
        position: 2,
        payload: { surveyTemplateId: "tpl-d", phase3Flow: "part_d" },
        gating: { kind: "after_item", moduleItemId: "ac-1" },
      }),
    ]);
    const outcome = await run(store, {});
    expect(outcome.status).toBe(200);
    expect(store.sorted().map((i) => i.moduleItemId)).toEqual([
      "ac-1",
      "d-1",
      "instr-0",
    ]);
  });
});

describe("candidate discovery", () => {
  it("detects marker, deterministic-id, and legacy self-referencing candidates", () => {
    const items = [
      row({ moduleItemId: "m-1", payload: { phase3Flow: "parts_ac" } }),
      row({ moduleItemId: phase3PartsACItemId(MODULE_ID), payload: {} }),
      row({ moduleItemId: "l-1", payload: { feedbackCardsFromItemId: "l-1" } }),
      row({ moduleItemId: "other", payload: {} }),
      row({ moduleItemId: "not-survey", itemType: "instruction", payload: { phase3Flow: "parts_ac" } }),
    ];
    expect(findPartsACCandidates(items, MODULE_ID).map((i) => i.moduleItemId)).toEqual([
      "m-1",
      phase3PartsACItemId(MODULE_ID),
      "l-1",
    ]);
  });

  it("Part D candidates exclude the Parts A–C item itself", () => {
    const ac = row({
      moduleItemId: "ac-1",
      payload: { phase3Flow: "parts_ac", feedbackCardsFromItemId: "ac-1" },
    });
    const d = row({
      moduleItemId: "d-1",
      payload: { feedbackCardsFromItemId: "ac-1" },
    });
    expect(findPartDCandidates([ac, d], MODULE_ID, ac).map((i) => i.moduleItemId)).toEqual([
      "d-1",
    ]);
  });
});
