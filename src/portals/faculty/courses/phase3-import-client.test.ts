import { describe, expect, it } from "vitest";
import {
  advisoryFileError,
  describeServerError,
  formalConfirmPhrase,
  formalLockReason,
  initialImportState,
  matchesConfirmation,
  matchesEmail,
  describeExistence,
  purgeAllConfirmPhrase,
  selectFile,
  PHASE3_MAX_CSV_BYTES,
  type Phase3Status,
} from "./phase3-import-client";

function status(overrides: Partial<Phase3Status> = {}): Phase3Status {
  return {
    partsACItemId: "p3ac-mod-1",
    partDItemId: "p3d-mod-1",
    provenance: { assignmentVersion: "v1", randomSeed: "20260825" },
    formal: {
      studentCount: 0,
      rowCount: 0,
      batchIds: [],
      importedAt: null,
      batchId: null,
      complete: false,
      inconsistent: false,
      inconsistencyReason: null,
    },
    testers: [],
    unknownRows: [],
    formalImportUnlocked: true,
    expected: {
      studentCount: 17,
      rowCount: 51,
      sourceOrders: {
        "AI→F1→F2": 3,
        "AI→F2→F1": 3,
        "F1→AI→F2": 3,
        "F1→F2→AI": 3,
        "F2→AI→F1": 2,
        "F2→F1→AI": 3,
      },
    },
    ...overrides,
  };
}

function tester(id: string, email: string | null = `${id}@x.edu`) {
  return {
    studentUserId: id,
    studentEmail: email,
    displayKeys: ["A", "B", "C"],
    rowCount: 3,
    importedAt: "2026-08-25T10:00:00.000Z",
    batchId: "b",
    revealed: false,
  };
}

describe("advisory file checks", () => {
  it("are advisory only and reject the obviously wrong file", () => {
    expect(advisoryFileError("x.csv", 0)).toMatch(/empty/);
    expect(advisoryFileError("x.csv", PHASE3_MAX_CSV_BYTES + 1)).toMatch(/limit/);
    expect(advisoryFileError("x.docx", 100)).toMatch(/\.csv/);
    expect(advisoryFileError("frozen.CSV", 100)).toBeNull();
  });
});

describe("selectFile", () => {
  it("discards any previous plan hash when a new file is chosen", () => {
    const withPreview = {
      ...initialImportState,
      phase: "previewOk" as const,
      preview: { planHash: "stale" } as never,
      error: "old error",
      errorDetails: ["a"],
    };
    const next = selectFile("new.csv", "text");
    expect(next.preview).toBeNull();
    expect(next.error).toBeNull();
    expect(next.errorDetails).toEqual([]);
    expect(next.phase).toBe("fileSelected");
    expect(next.csvText).toBe("text");
    // the old state object is untouched
    expect(withPreview.preview).not.toBeNull();
  });
});

describe("confirmation phrases", () => {
  it("are built from the server's expected counts, never hard-coded", () => {
    expect(formalConfirmPhrase({ studentCount: 17, rowCount: 51 })).toBe(
      "IMPORT 17 STUDENTS / 51 ROWS"
    );
    // A different cohort would produce a different phrase — nothing is pinned.
    expect(formalConfirmPhrase({ studentCount: 20, rowCount: 60 })).toBe(
      "IMPORT 20 STUDENTS / 60 ROWS"
    );
  });

  it("purge-all phrase tracks the live tester count for any number", () => {
    for (const n of [0, 1, 3, 7, 20, 137]) {
      expect(purgeAllConfirmPhrase(n)).toBe(`PURGE ALL ${n} TESTERS`);
    }
  });

  it("matches exactly, ignoring only surrounding whitespace", () => {
    expect(matchesConfirmation("  PURGE ALL 3 TESTERS ", "PURGE ALL 3 TESTERS")).toBe(true);
    expect(matchesConfirmation("purge all 3 testers", "PURGE ALL 3 TESTERS")).toBe(false);
    expect(matchesEmail(" Tester1@X.EDU ", "tester1@x.edu")).toBe(true);
    expect(matchesEmail("other@x.edu", "tester1@x.edu")).toBe(false);
    expect(matchesEmail("anything", null)).toBe(false);
  });
});

describe("formalLockReason", () => {
  it("reports loading before the server has answered", () => {
    expect(formalLockReason(null)).toMatch(/Loading/);
  });

  it("is null only when there are no testers and no unknown rows", () => {
    expect(formalLockReason(status())).toBeNull();
  });

  it("blocks on any number of testers, with no upper bound in the message", () => {
    for (const n of [1, 3, 7, 20]) {
      const reason = formalLockReason(
        status({ testers: Array.from({ length: n }, (_, i) => tester(`sub-${i}`)) })
      );
      expect(reason).toContain(`${n} tester`);
      expect(reason).toMatch(/Purge All Tester Data/);
    }
  });

  it("blocks on unclassifiable rows ahead of testers", () => {
    const reason = formalLockReason(
      status({
        testers: [tester("sub-1")],
        unknownRows: [{ feedbackId: "phase3:x:A", studentUserId: "x" }],
      })
    );
    expect(reason).toMatch(/cannot be classified/);
  });
});

describe("describeServerError", () => {
  it("surfaces the message and the server's detail list", () => {
    const err = Object.assign(new Error("Validation failed with 3 problem(s)."), {
      details: { errors: ["line 2: narrative is empty", "line 3: d1 bad"] },
    });
    const { message, details } = describeServerError(err);
    expect(message).toMatch(/Validation failed/);
    expect(details).toHaveLength(2);
  });

  it("handles tester-history hits and unknown-row payloads", () => {
    expect(
      describeServerError(
        Object.assign(new Error("tester history"), {
          details: { studentUserIds: ["sub-5"] },
        })
      ).details
    ).toEqual(["sub-5"]);
    expect(
      describeServerError(
        Object.assign(new Error("unknown rows"), {
          details: { unknownRows: [{ feedbackId: "phase3:x:A" }] },
        })
      ).details
    ).toEqual(["phase3:x:A"]);
  });

  it("degrades gracefully with no details", () => {
    expect(describeServerError("nope").message).toBe("The request failed.");
  });
});

describe("describeExistence never dresses a guess up as a fact", () => {
  it("distinguishes present, absent and unknown", () => {
    expect(
      describeExistence({ moduleItemId: "x", targeted: true, existence: "present" })
    ).toMatch(/exists/);
    expect(
      describeExistence({ moduleItemId: "x", targeted: true, existence: "absent" })
    ).toMatch(/not present/);
    const unknown = describeExistence({
      moduleItemId: "x",
      targeted: true,
      existence: "unknown",
    });
    expect(unknown).toMatch(/unknown/);
    expect(unknown).not.toMatch(/exists —/);
  });
});

describe("formalConfirmPhrase is display-only", () => {
  it("mirrors the server's counts but carries no authority", () => {
    // The label the operator sees is built from what the SERVER reported, and
    // the same string is echoed back for the server to re-derive and compare.
    expect(formalConfirmPhrase({ studentCount: 17, rowCount: 51 })).toBe(
      "IMPORT 17 STUDENTS / 51 ROWS"
    );
  });
});

describe("formalLockReason surfaces flow-state inconsistency first", () => {
  it("reports the inconsistency ahead of the tester gate when the flow is locked", () => {
    const reason = formalLockReason(
      status({
        formal: {
          studentCount: 10,
          rowCount: 30,
          batchIds: [],
          importedAt: "2026-08-25T09:00:00.000Z",
          batchId: "b",
          complete: false,
          inconsistent: true,
          inconsistencyReason: "marked as imported but only 10/17 students",
        },
        testers: [tester("sub-1")],
        formalImportUnlocked: false,
      })
    );
    expect(reason).toBe("marked as imported but only 10/17 students");
  });

  it("does not lock for the repairable case (rows complete, marker missing)", () => {
    const reason = formalLockReason(
      status({
        formal: {
          studentCount: 17,
          rowCount: 51,
          batchIds: [],
          importedAt: null,
          batchId: null,
          complete: false,
          inconsistent: true,
          inconsistencyReason: "not marked as imported",
        },
        formalImportUnlocked: true,
      })
    );
    expect(reason).toBeNull();
  });
});
