import { describe, it, expect } from "vitest";
import { validateRandomizerPayload } from "../amplify/functions/module-item-function/balanced";

describe("validateRandomizerPayload", () => {
  it("accepts undefined payload fields", () => {
    expect(validateRandomizerPayload({})).toBeNull();
  });

  it("accepts valid groups + strategy + consentItemId", () => {
    expect(
      validateRandomizerPayload({
        groups: [{ key: "A" }, { key: "B" }],
        strategy: "balanced",
        consentItemId: "ci-1",
      })
    ).toBeNull();
  });

  it("rejects non-array groups", () => {
    expect(validateRandomizerPayload({ groups: "nope" })).toMatch(/groups/);
  });

  it("rejects unknown strategy values", () => {
    expect(validateRandomizerPayload({ strategy: "round-robin" })).toMatch(/strategy/);
  });

  it("accepts the three known strategy values", () => {
    for (const s of ["uniform", "weighted", "balanced"]) {
      expect(validateRandomizerPayload({ strategy: s })).toBeNull();
    }
  });

  it("rejects non-string consentItemId", () => {
    expect(validateRandomizerPayload({ consentItemId: 5 })).toMatch(/consentItemId/);
  });

  it("rejects empty-string consentItemId", () => {
    expect(validateRandomizerPayload({ consentItemId: "" })).toMatch(/consentItemId/);
  });
});
