import { describe, expect, it } from "vitest";
import { buildPhase3SectionHeaders } from "./phase3-section-headers";

describe("buildPhase3SectionHeaders", () => {
  it("maps frozen Phase 3 blocks Q1/Q7/Q13 to zero-based A/B/C headings", () => {
    expect(
      buildPhase3SectionHeaders({
        payload: {
          cardSections: [
            { displayKey: "A", firstQuestionNumber: 1 },
            { displayKey: "B", firstQuestionNumber: 7 },
            { displayKey: "C", firstQuestionNumber: 13 },
          ],
        },
      })
    ).toEqual({
      0: "The following questions are about Feedback Card A",
      6: "The following questions are about Feedback Card B",
      12: "The following questions are about Feedback Card C",
    });
  });

  it("ignores invalid keys and question numbers", () => {
    expect(
      buildPhase3SectionHeaders({
        payload: {
          cardSections: [
            { displayKey: "D", firstQuestionNumber: 1 },
            { displayKey: "A", firstQuestionNumber: 0 },
          ],
        },
      })
    ).toBeUndefined();
  });
});
