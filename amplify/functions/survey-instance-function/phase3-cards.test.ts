import { describe, it, expect } from "vitest";
import {
  assessPhase3Eligibility,
  buildPhase3Cards,
  canonicalCardContent,
  hashCanonicalCardContent,
  isFullyRevealed,
  selectRowsForStudent,
  SOURCE_LABEL_AI,
  SOURCE_LABEL_FACULTY,
  type ReviewerFeedbackRow,
} from "./phase3-cards";

const STUDENT = "student-sub-1";
const OTHER_STUDENT = "student-sub-2";

/** Mirrors what scripts/seed-phase3.mjs writes for one participant. */
function seededSet(
  studentUserId = STUDENT,
  overrides: Partial<Record<"A" | "B" | "C", Partial<ReviewerFeedbackRow>>> = {}
): ReviewerFeedbackRow[] {
  const base: Array<["A" | "B" | "C", string, string]> = [
    ["A", "reviewer", "Faculty 1"],
    ["B", "ai", "AI"],
    ["C", "reviewer", "Faculty 2"],
  ];
  return base.map(([displayKey, source, displayLabel]) => {
    const body = `Integrated narrative for card ${displayKey}.`;
    return {
      feedbackId: `phase3:${studentUserId}:${displayKey}`,
      studentUserId,
      moduleItemId: "item-p3ac",
      source,
      displayLabel,
      reviewerUserId: null,
      body,
      dimensionScores: { d1: "3", d2: "N/A", d3: "4" },
      displayKey,
      contentHash: hashCanonicalCardContent("3", "N/A", "4", body),
      revealed: false,
      locked: true,
      ...(overrides[displayKey] || {}),
    };
  });
}

describe("selectRowsForStudent", () => {
  it("drops rows belonging to another student", () => {
    const mixed = [...seededSet(STUDENT), ...seededSet(OTHER_STUDENT)];
    const mine = selectRowsForStudent(mixed, STUDENT);
    expect(mine).toHaveLength(3);
    expect(mine.every((r) => r.studentUserId === STUDENT)).toBe(true);
  });

  it("returns empty for a student with no rows", () => {
    expect(selectRowsForStudent(seededSet(OTHER_STUDENT), STUDENT)).toEqual([]);
  });
});

describe("assessPhase3Eligibility", () => {
  it("admits a complete A/B/C set", () => {
    expect(assessPhase3Eligibility(seededSet())).toEqual({
      eligible: true,
      reason: "ok",
      cardCount: 3,
    });
  });

  it("rejects a student with no cards", () => {
    expect(assessPhase3Eligibility([])).toMatchObject({
      eligible: false,
      reason: "no_cards",
    });
  });

  it("rejects a partial set (seed interrupted after two rows)", () => {
    expect(assessPhase3Eligibility(seededSet().slice(0, 2))).toMatchObject({
      eligible: false,
      reason: "incomplete_card_set",
      cardCount: 2,
    });
  });

  it("rejects a duplicated display key", () => {
    const rows = seededSet();
    rows[2].displayKey = "A";
    expect(assessPhase3Eligibility(rows)).toMatchObject({
      eligible: false,
      reason: "duplicate_display_key",
    });
  });

  it("rejects an out-of-range display key", () => {
    const rows = seededSet();
    rows[2].displayKey = "D";
    expect(assessPhase3Eligibility(rows)).toMatchObject({
      eligible: false,
      reason: "invalid_display_key",
    });
  });

  it("rejects a missing display key", () => {
    const rows = seededSet();
    delete rows[1].displayKey;
    expect(assessPhase3Eligibility(rows)).toMatchObject({
      eligible: false,
      reason: "invalid_display_key",
    });
  });

  it("rejects a well-formed but stale content hash", () => {
    const rows = seededSet();
    rows[0].body = "Narrative changed after the study artifact was frozen.";
    expect(assessPhase3Eligibility(rows)).toMatchObject({
      eligible: false,
      reason: "invalid_card_content",
    });
  });
});

describe("buildPhase3Cards — blind state", () => {
  it("orders cards A, B, C regardless of stored row order", () => {
    const shuffled = [seededSet()[2], seededSet()[0], seededSet()[1]];
    const cards = buildPhase3Cards(shuffled, STUDENT)!;
    expect(cards.map((c) => c.displayKey)).toEqual(["A", "B", "C"]);
  });

  it("never emits a source label before reveal", () => {
    const cards = buildPhase3Cards(seededSet(), STUDENT)!;
    expect(cards.every((c) => c.sourceType === null)).toBe(true);
  });

  it("emits ONLY whitelisted keys — no source/displayLabel/reviewerUserId/contentHash", () => {
    const cards = buildPhase3Cards(seededSet(), STUDENT)!;
    for (const card of cards) {
      expect(Object.keys(card).sort()).toEqual([
        "d1",
        "d2",
        "d3",
        "displayKey",
        "narrative",
        "sourceType",
      ]);
    }
  });

  it("leaks nothing identifying through JSON serialization of the blind payload", () => {
    const serialized = JSON.stringify(buildPhase3Cards(seededSet(), STUDENT));
    for (const forbidden of [
      "Faculty 1",
      "Faculty 2",
      '"ai"',
      "reviewerUserId",
      "displayLabel",
      "contentHash",
      "414141",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("carries the frozen D1-D3 values and full narrative verbatim", () => {
    const cards = buildPhase3Cards(seededSet(), STUDENT)!;
    expect(cards[0]).toMatchObject({
      d1: "3",
      d2: "N/A",
      d3: "4",
      narrative: "Integrated narrative for card A.",
    });
  });

  it("returns null when the student holds no complete set", () => {
    expect(buildPhase3Cards([], STUDENT)).toBeNull();
    expect(buildPhase3Cards(seededSet().slice(0, 2), STUDENT)).toBeNull();
  });

  it("returns null for a student whose rows belong to someone else", () => {
    expect(buildPhase3Cards(seededSet(OTHER_STUDENT), STUDENT)).toBeNull();
  });
});

describe("buildPhase3Cards — reveal is fail-closed", () => {
  const allRevealed = () =>
    seededSet(STUDENT, {
      A: { revealed: true },
      B: { revealed: true },
      C: { revealed: true },
    });

  it("labels AI vs Faculty once every card is revealed", () => {
    const cards = buildPhase3Cards(allRevealed(), STUDENT)!;
    expect(cards.map((c) => c.sourceType)).toEqual([
      SOURCE_LABEL_FACULTY, // A = Faculty 1
      SOURCE_LABEL_AI, // B = AI
      SOURCE_LABEL_FACULTY, // C = Faculty 2
    ]);
  });

  it("never distinguishes Faculty 1 from Faculty 2 after reveal", () => {
    const serialized = JSON.stringify(buildPhase3Cards(allRevealed(), STUDENT));
    expect(serialized).not.toContain("Faculty 1");
    expect(serialized).not.toContain("Faculty 2");
    expect(serialized).toContain(SOURCE_LABEL_FACULTY);
  });

  it("keeps ALL cards blind when only some are revealed", () => {
    const partial = seededSet(STUDENT, {
      A: { revealed: true },
      B: { revealed: true },
      // C left blind — e.g. reveal loop crashed midway
    });
    expect(isFullyRevealed(partial)).toBe(false);
    const cards = buildPhase3Cards(partial, STUDENT)!;
    expect(cards.every((c) => c.sourceType === null)).toBe(true);
  });

  it("treats the AI card being the only revealed row as still blind", () => {
    const partial = seededSet(STUDENT, { B: { revealed: true } });
    const cards = buildPhase3Cards(partial, STUDENT)!;
    expect(cards.every((c) => c.sourceType === null)).toBe(true);
  });
});

describe("score normalization", () => {
  it("passes through 1-4 and N/A", () => {
    const body = "Integrated narrative for card A.";
    const rows = seededSet(STUDENT, {
      A: {
        dimensionScores: { d1: "1", d2: "2", d3: "N/A" },
        contentHash: hashCanonicalCardContent("1", "2", "N/A", body),
      },
    });
    expect(buildPhase3Cards(rows, STUDENT)![0]).toMatchObject({
      d1: "1",
      d2: "2",
      d3: "N/A",
    });
  });

  it("accepts numeric values written without quotes", () => {
    const body = "Integrated narrative for card A.";
    const rows = seededSet(STUDENT, {
      A: {
        dimensionScores: { d1: 3, d2: 4, d3: 1 },
        contentHash: hashCanonicalCardContent("3", "4", "1", body),
      },
    });
    expect(buildPhase3Cards(rows, STUDENT)![0]).toMatchObject({
      d1: "3",
      d2: "4",
      d3: "1",
    });
  });

  it("fails closed on unreadable or out-of-range scores instead of converting them to N/A", () => {
    const rows = seededSet(STUDENT, {
      A: { dimensionScores: { d1: "9", d2: "", d3: "excellent" } },
    });
    expect(assessPhase3Eligibility(rows)).toMatchObject({
      eligible: false,
      reason: "invalid_card_content",
    });
    expect(buildPhase3Cards(rows, STUDENT)).toBeNull();
  });

  it("parses dimensionScores stored as a JSON string", () => {
    const body = "Integrated narrative for card A.";
    const rows = seededSet(STUDENT, {
      A: {
        dimensionScores: '{"d1":"2","d2":"3","d3":"N/A"}',
        contentHash: hashCanonicalCardContent("2", "3", "N/A", body),
      },
    });
    expect(buildPhase3Cards(rows, STUDENT)![0]).toMatchObject({
      d1: "2",
      d2: "3",
      d3: "N/A",
    });
  });

  it("fails closed when dimensionScores is missing entirely", () => {
    const rows = seededSet(STUDENT, { A: { dimensionScores: undefined } });
    expect(assessPhase3Eligibility(rows)).toMatchObject({
      eligible: false,
      reason: "invalid_card_content",
    });
    expect(buildPhase3Cards(rows, STUDENT)).toBeNull();
  });

  it("fails closed when the source set is not exactly one AI and two faculty cards", () => {
    const rows = seededSet(STUDENT, { B: { source: "reviewer" } });
    expect(assessPhase3Eligibility(rows)).toMatchObject({
      eligible: false,
      reason: "invalid_source_set",
    });
  });
});

describe("canonicalCardContent", () => {
  it("is stable and separator-unambiguous", () => {
    expect(canonicalCardContent("3", "N/A", "4", "Narrative.")).toBe(
      ["3", "N/A", "4", "Narrative."].join("\u0000")
    );
  });

  it("distinguishes field boundaries that naive concatenation would collide", () => {
    expect(canonicalCardContent("1", "2", "3", "x")).not.toBe(
      canonicalCardContent("12", "3", "", "x")
    );
  });
});
