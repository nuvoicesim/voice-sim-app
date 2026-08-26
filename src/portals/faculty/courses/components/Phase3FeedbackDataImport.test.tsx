import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MantineProvider } from "@mantine/core";
import { Phase3FeedbackDataImport } from "./Phase3FeedbackDataImport";
import { moduleItemApi } from "../../../../api/moduleItemApi";

vi.mock("../../../../api/moduleItemApi", () => ({
  moduleItemApi: {
    phase3Status: vi.fn(),
    phase3ImportPreview: vi.fn(),
    phase3ImportCommit: vi.fn(),
    phase3PurgeTester: vi.fn(),
  },
}));

vi.mock("../../../../utils/notify", () => ({
  notify: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const api = moduleItemApi as unknown as {
  phase3Status: ReturnType<typeof vi.fn>;
  phase3ImportPreview: ReturnType<typeof vi.fn>;
  phase3ImportCommit: ReturnType<typeof vi.fn>;
  phase3PurgeTester: ReturnType<typeof vi.fn>;
};

function statusBody(overrides: Record<string, unknown> = {}) {
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
      sourceOrders: {},
    },
    ...overrides,
  };
}

function purgePreviewBody(testerIndexes: number[], scope: "one" | "all") {
  return {
    scope,
    partsACItemId: "p3ac-mod-1",
    partDItemId: "p3d-mod-1",
    testerCount: testerIndexes.length,
    plans: testerIndexes.map((i) => ({
      studentUserId: `sub-t${i}`,
      studentEmail: `tester${i}@x.edu`,
      feedbackIds: [`phase3:sub-t${i}:A`, `phase3:sub-t${i}:B`, `phase3:sub-t${i}:C`],
      displayKeys: ["A", "B", "C"],
      surveyInstances: [
        { moduleItemId: "p3ac-mod-1", targeted: true, existence: "present" },
        { moduleItemId: "p3d-mod-1", targeted: true, existence: "absent" },
      ],
      itemProgress: [
        { moduleItemId: "p3ac-mod-1", targeted: true, existence: "unknown" },
        { moduleItemId: "p3d-mod-1", targeted: true, existence: "absent" },
      ],
    })),
    retained: {
      eventLogBehaviourEvents: true,
      testerHistoryMarker: true,
      courseEnrollment: true,
    },
    confirmPhrase: scope === "all" ? `PURGE ALL ${testerIndexes.length} TESTERS` : null,
  };
}

function tester(i: number) {
  return {
    studentUserId: `sub-t${i}`,
    studentEmail: `tester${i}@x.edu`,
    displayKeys: ["A", "B", "C"],
    rowCount: 3,
    importedAt: "2026-08-25T10:00:00.000Z",
    batchId: "b",
    revealed: false,
  };
}

function renderPanel() {
  return render(
    <MantineProvider>
      <Phase3FeedbackDataImport moduleId="mod-1" />
    </MantineProvider>
  );
}

async function pickFile(label: RegExp, contents = "review_id,...\n") {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  const file = new File([contents], "frozen.csv", { type: "text/csv" });
  // jsdom's File.text() is not always present in this environment.
  Object.defineProperty(file, "text", {
    value: async () => contents,
  });
  await userEvent.upload(input, file);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("status loading", () => {
  it("loads once on mount and never polls", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    renderPanel();
    // Let the mount fetch and its loading transition settle first, so the clock
    // move below is the only thing that could trigger another call.
    expect(await screen.findByText(/p3ac-mod-1/)).toBeInTheDocument();
    expect(api.phase3Status).toHaveBeenCalledTimes(1);

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(api.phase3Status).toHaveBeenCalledTimes(1);
  });

  it("refreshes on the manual button", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    renderPanel();
    await waitFor(() => expect(api.phase3Status).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => expect(api.phase3Status).toHaveBeenCalledTimes(2));
  });

  it("shows the server-derived binding and read-only provenance", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    renderPanel();
    expect(await screen.findByText(/p3ac-mod-1/)).toBeInTheDocument();
    expect(screen.getByText(/p3d-mod-1/)).toBeInTheDocument();
    expect(screen.getByText(/assignment version/i)).toBeInTheDocument();
    // Provenance is displayed, never entered.
    expect(
      screen.queryByRole("textbox", { name: /assignment version/i })
    ).not.toBeInTheDocument();
  });
});

describe("dynamic tester list", () => {
  it.each([0, 1, 3, 7, 20])("renders exactly %i tester rows", async (n) => {
    api.phase3Status.mockResolvedValue(
      statusBody({ testers: Array.from({ length: n }, (_, i) => tester(i)) })
    );
    renderPanel();
    expect(await screen.findByText(`Current testers (${n})`)).toBeInTheDocument();
    const purgeButtons = screen.queryAllByRole("button", { name: /^purge$/i });
    expect(purgeButtons).toHaveLength(n);
    if (n === 0) {
      expect(screen.getByText(/No tester data in this flow/)).toBeInTheDocument();
    }
  });

  it("states plainly that the tester count is unlimited", async () => {
    api.phase3Status.mockResolvedValue(statusBody({ testers: [tester(0)] }));
    renderPanel();
    expect(
      await screen.findByText(/no limit on how many testers/i)
    ).toBeInTheDocument();
  });
});

describe("formal import lock", () => {
  it("is locked while any tester holds data and offers no upload", async () => {
    api.phase3Status.mockResolvedValue(
      statusBody({
        testers: [tester(0), tester(1)],
        formalImportUnlocked: false,
      })
    );
    renderPanel();
    expect(await screen.findByText(/Formal import is locked/)).toBeInTheDocument();
    expect(screen.getByText(/2 testers still hold Phase 3 data/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Formal cohort CSV/i)
    ).not.toBeInTheDocument();
  });

  it("is locked while any row cannot be classified", async () => {
    api.phase3Status.mockResolvedValue(
      statusBody({
        unknownRows: [{ feedbackId: "phase3:x:A", studentUserId: "x" }],
        formalImportUnlocked: false,
      })
    );
    renderPanel();
    expect(
      await screen.findByText(/cannot be classified as tester or formal data/i)
    ).toBeInTheDocument();
  });

  it("unlocks only when there are no testers and no unknown rows", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    renderPanel();
    expect(await screen.findByLabelText(/Formal cohort CSV/i)).toBeInTheDocument();
    expect(screen.queryByText(/Formal import is locked/)).not.toBeInTheDocument();
  });
});

describe("formal import confirmation", () => {
  const preview = {
    mode: "formal",
    partsACItemId: "p3ac-mod-1",
    partDItemId: "p3d-mod-1",
    planHash: "hash-abc",
    batchId: "b",
    sourceCsvSha256: "sha",
    studentCount: 17,
    rowCount: 51,
    provenance: { assignmentVersion: "v1", randomSeed: "20260825" },
    orderDistribution: [{ order: "AI→F1→F2", actual: 3, expected: 3 }],
    counts: { absent: 51, exact: 0, divergent: 0, unexpected: 0 },
    alreadyImported: false,
    confirmPhrase: "IMPORT 17 STUDENTS / 51 ROWS",
    flowState: { testerGeneration: null, formalImportedAt: null },
    plan: [
      {
        reviewId: "REVIEW-001",
        studyId: "STUDY-001",
        studentEmail: "student001@x.edu",
        studentUserId: "sub-001",
        sourceOrder: "AI→F1→F2",
        cards: [
          {
            displayKey: "A",
            sourceLabel: "AI",
            d1: "3",
            d2: "2",
            d3: "N/A",
            contentHash: "abc",
            narrativePreview: "…",
          },
        ],
      },
    ],
  };

  it("requires both the provenance acknowledgement and the exact phrase", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    api.phase3ImportPreview.mockResolvedValue(preview);
    api.phase3ImportCommit.mockResolvedValue({ ...preview, written: 51 });
    renderPanel();

    await screen.findByLabelText(/Formal cohort CSV/i);
    await pickFile(/Formal cohort CSV/i);
    await userEvent.click(screen.getAllByRole("button", { name: /^preview$/i })[1]);

    const importBtn = await screen.findByRole("button", {
      name: /import formal cohort/i,
    });
    expect(importBtn).toBeDisabled();

    // Phrase alone is not enough.
    await userEvent.type(
      screen.getByLabelText(/Type "IMPORT 17 STUDENTS \/ 51 ROWS" to confirm/i),
      "IMPORT 17 STUDENTS / 51 ROWS"
    );
    expect(importBtn).toBeDisabled();

    // Acknowledgement + phrase.
    await userEvent.click(screen.getByRole("checkbox"));
    expect(importBtn).toBeEnabled();

    await userEvent.click(importBtn);
    await waitFor(() => expect(api.phase3ImportCommit).toHaveBeenCalledTimes(1));
    const body = api.phase3ImportCommit.mock.calls[0][1];
    expect(body.expectedPlanHash).toBe("hash-abc");
    expect(body.confirmProvenance).toEqual({
      assignmentVersion: "v1",
      randomSeed: "20260825",
    });
    // The typed phrase must actually reach the server, which re-derives and
    // compares it. Without this the UI check would be decorative.
    expect(body.confirmFormalPhrase).toBe("IMPORT 17 STUDENTS / 51 ROWS");
    // The browser never invents the item ids.
    expect(body).not.toHaveProperty("partsACItemId");
    expect(body).not.toHaveProperty("partDItemId");
  });

  it("refreshes status after a successful commit", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    api.phase3ImportPreview.mockResolvedValue(preview);
    api.phase3ImportCommit.mockResolvedValue({ ...preview, written: 51 });
    renderPanel();
    await screen.findByLabelText(/Formal cohort CSV/i);
    await pickFile(/Formal cohort CSV/i);
    await userEvent.click(screen.getAllByRole("button", { name: /^preview$/i })[1]);
    await userEvent.type(
      await screen.findByLabelText(/Type "IMPORT 17 STUDENTS \/ 51 ROWS" to confirm/i),
      "IMPORT 17 STUDENTS / 51 ROWS"
    );
    await userEvent.click(screen.getByRole("checkbox"));
    await userEvent.click(screen.getByRole("button", { name: /import formal cohort/i }));
    await waitFor(() => expect(api.phase3Status).toHaveBeenCalledTimes(2));
  });

  it("shows the server's error detail list and writes nothing", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    api.phase3ImportPreview.mockRejectedValue(
      Object.assign(new Error("Validation failed with 2 problem(s)."), {
        details: { errors: ["line 2: narrative is empty", "line 3: d1 bad"] },
      })
    );
    renderPanel();
    await screen.findByLabelText(/Formal cohort CSV/i);
    await pickFile(/Formal cohort CSV/i);
    await userEvent.click(screen.getAllByRole("button", { name: /^preview$/i })[1]);

    expect(await screen.findByText(/Nothing was written\./)).toBeInTheDocument();
    expect(screen.getByText(/line 2: narrative is empty/)).toBeInTheDocument();
    expect(api.phase3ImportCommit).not.toHaveBeenCalled();
  });
});

describe("purge is a real two-phase server flow", () => {
  it("asks the server for the plan (commit:false) BEFORE showing any confirmation", async () => {
    api.phase3Status.mockResolvedValue(statusBody({ testers: [tester(0)] }));
    api.phase3PurgeTester.mockResolvedValue(purgePreviewBody([0], "one"));
    renderPanel();

    // Nothing is confirmable before the server has spoken.
    await userEvent.click(await screen.findByRole("button", { name: /^purge$/i }));

    await waitFor(() => expect(api.phase3PurgeTester).toHaveBeenCalledTimes(1));
    expect(api.phase3PurgeTester.mock.calls[0][1]).toEqual({
      scope: "one",
      studentUserId: "sub-t0",
      commit: false,
    });
  });

  it("renders the server's plan, including honest existence, then commits", async () => {
    api.phase3Status.mockResolvedValue(statusBody({ testers: [tester(0)] }));
    api.phase3PurgeTester
      .mockResolvedValueOnce(purgePreviewBody([0], "one"))
      .mockResolvedValueOnce({ purged: 1, failed: [] });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /^purge$/i }));

    // Server-supplied delete targets, verbatim.
    expect(await screen.findByText(/phase3:sub-t0:A/)).toBeInTheDocument();
    expect(
      screen.getByText(/SurveyInstance \(p3ac-mod-1\) — exists — will be deleted/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/SurveyInstance \(p3d-mod-1\) — not present — delete is a no-op/)
    ).toBeInTheDocument();
    // An unread row is shown as unknown, never as a fact.
    expect(
      screen.getByText(/StudentItemProgress \(p3ac-mod-1\) — existence unknown/)
    ).toBeInTheDocument();

    expect(screen.getByText(/Retained:/)).toBeInTheDocument();
    expect(screen.getByText(/not a deletion of every trace/i)).toBeInTheDocument();

    const confirmBtn = screen.getByRole("button", { name: /purge tester data/i });
    expect(confirmBtn).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Type the tester's email to confirm/i),
      "tester0@x.edu"
    );
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);

    await waitFor(() => expect(api.phase3PurgeTester).toHaveBeenCalledTimes(2));
    expect(api.phase3PurgeTester.mock.calls[0][1].commit).toBe(false);
    expect(api.phase3PurgeTester.mock.calls[1][1]).toEqual({
      scope: "one",
      studentUserId: "sub-t0",
      commit: true,
      confirmText: "tester0@x.edu",
    });
  });

  it("purge-all previews first and uses the phrase the SERVER returned", async () => {
    api.phase3Status.mockResolvedValue(
      statusBody({ testers: [tester(0), tester(1), tester(2)] })
    );
    api.phase3PurgeTester
      .mockResolvedValueOnce(purgePreviewBody([0, 1, 2], "all"))
      .mockResolvedValueOnce({ purged: 3, failed: [] });
    renderPanel();

    await userEvent.click(
      await screen.findByRole("button", { name: /purge all tester data/i })
    );
    await waitFor(() => expect(api.phase3PurgeTester).toHaveBeenCalledTimes(1));
    expect(api.phase3PurgeTester.mock.calls[0][1]).toEqual({
      scope: "all",
      commit: false,
    });

    const confirmBtn = await screen.findByRole("button", { name: /^purge all$/i });
    expect(confirmBtn).toBeDisabled();
    const input = screen.getByLabelText(/Type "PURGE ALL 3 TESTERS" to confirm/i);
    await userEvent.type(input, "PURGE ALL 2 TESTERS");
    expect(confirmBtn).toBeDisabled();
    await userEvent.clear(input);
    await userEvent.type(input, "PURGE ALL 3 TESTERS");
    expect(confirmBtn).toBeEnabled();
    await userEvent.click(confirmBtn);

    await waitFor(() => expect(api.phase3PurgeTester).toHaveBeenCalledTimes(2));
    expect(api.phase3PurgeTester.mock.calls[1][1]).toEqual({
      scope: "all",
      commit: true,
      confirmText: "PURGE ALL 3 TESTERS",
    });
  });

  it("shows the server's error and offers no confirmation when preview fails", async () => {
    api.phase3Status.mockResolvedValue(statusBody({ testers: [tester(0)] }));
    api.phase3PurgeTester.mockRejectedValue(
      new Error("2 Phase 3 row(s) under this flow have no import type.")
    );
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /^purge$/i }));

    expect(await screen.findByText(/have no import type/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /purge tester data/i })
    ).not.toBeInTheDocument();
    expect(api.phase3PurgeTester).toHaveBeenCalledTimes(1);
  });

  it("offers no commit when the server's plan is empty", async () => {
    api.phase3Status.mockResolvedValue(statusBody({ testers: [tester(0)] }));
    api.phase3PurgeTester.mockResolvedValue(purgePreviewBody([], "one"));
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: /^purge$/i }));

    expect(
      await screen.findByText(/found no tester data to delete/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /purge tester data/i })
    ).not.toBeInTheDocument();
  });

  it("purge-all is unavailable with no testers", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    renderPanel();
    expect(
      await screen.findByRole("button", { name: /purge all tester data/i })
    ).toBeDisabled();
    expect(api.phase3PurgeTester).not.toHaveBeenCalled();
  });
});

describe("tester import", () => {
  const preview = {
    mode: "tester",
    partsACItemId: "p3ac-mod-1",
    partDItemId: "p3d-mod-1",
    planHash: "tester-hash",
    batchId: "b",
    sourceCsvSha256: "sha",
    studentCount: 1,
    rowCount: 3,
    provenance: { assignmentVersion: "", randomSeed: "" },
    orderDistribution: [],
    counts: { absent: 3, exact: 0, divergent: 0, unexpected: 0 },
    alreadyImported: false,
    confirmPhrase: null,
    flowState: { testerGeneration: 0, formalImportedAt: null },
    plan: [
      {
        reviewId: "T-001",
        studyId: "T-001",
        studentEmail: "tester9@x.edu",
        studentUserId: "sub-t9",
        sourceOrder: "AI→F1→F2",
        cards: [],
      },
    ],
  };

  it("requires the tester email from the preview to match", async () => {
    api.phase3Status.mockResolvedValue(statusBody());
    api.phase3ImportPreview.mockResolvedValue(preview);
    api.phase3ImportCommit.mockResolvedValue({ ...preview, written: 3 });
    renderPanel();

    await screen.findByLabelText(/Tester CSV/i);
    await pickFile(/Tester CSV/i);
    await userEvent.click(screen.getAllByRole("button", { name: /^preview$/i })[0]);

    const importBtn = await screen.findByRole("button", { name: /import tester/i });
    expect(importBtn).toBeDisabled();
    await userEvent.type(
      screen.getByLabelText(/Type the tester's email to confirm/i),
      "wrong@x.edu"
    );
    expect(importBtn).toBeDisabled();

    await userEvent.clear(screen.getByLabelText(/Type the tester's email to confirm/i));
    await userEvent.type(
      screen.getByLabelText(/Type the tester's email to confirm/i),
      "tester9@x.edu"
    );
    expect(importBtn).toBeEnabled();
    await userEvent.click(importBtn);

    await waitFor(() => expect(api.phase3ImportCommit).toHaveBeenCalledTimes(1));
    const body = api.phase3ImportCommit.mock.calls[0][1];
    expect(body.mode).toBe("tester");
    expect(body.expectedPlanHash).toBe("tester-hash");
    expect(body.confirmTesterEmail).toBe("tester9@x.edu");
    // Tester imports never carry the formal cohort's provenance.
    expect(body.confirmProvenance).toBeUndefined();
  });
});

describe("flow-state inconsistency is surfaced, not hidden", () => {
  it("badges and explains rows-without-marker while keeping the importer usable", async () => {
    api.phase3Status.mockResolvedValue(
      statusBody({
        formal: {
          studentCount: 17,
          rowCount: 51,
          batchIds: ["b"],
          importedAt: null,
          batchId: null,
          complete: false,
          inconsistent: true,
          inconsistencyReason:
            "All 51 formal rows are stored, but this flow is not marked as imported, so it would still accept tester data.",
        },
        formalImportUnlocked: true,
      })
    );
    renderPanel();
    expect(await screen.findByText("Flow state inconsistent")).toBeInTheDocument();
    expect(
      screen.getByText(/Stored rows and the flow marker disagree/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/still accept tester data/)
    ).toBeInTheDocument();
    // Not shown as a finished import.
    expect(screen.queryByText("Formal cohort imported")).not.toBeInTheDocument();
    // Repairable: re-running the import only stamps the marker.
    expect(screen.getByLabelText(/Formal cohort CSV/i)).toBeInTheDocument();
  });

  it("blocks the importer when the marker exists but rows are incomplete", async () => {
    api.phase3Status.mockResolvedValue(
      statusBody({
        formal: {
          studentCount: 10,
          rowCount: 30,
          batchIds: ["b"],
          importedAt: "2026-08-25T09:00:00.000Z",
          batchId: "b",
          complete: false,
          inconsistent: true,
          inconsistencyReason:
            "This flow is marked as imported on 2026-08-25T09:00:00.000Z, but only 10/17 students and 30/51 rows are stored. Investigate off the website.",
        },
        formalImportUnlocked: false,
      })
    );
    renderPanel();
    expect(await screen.findByText("Flow state inconsistent")).toBeInTheDocument();
    expect(screen.getByText(/Formal import is locked/)).toBeInTheDocument();
    // Shown twice on purpose: once as the top-level inconsistency alert, once as
    // the reason the importer is locked.
    expect(screen.getAllByText(/Investigate off the website/)).toHaveLength(2);
    expect(screen.queryByLabelText(/Formal cohort CSV/i)).not.toBeInTheDocument();
  });

  it("shows the flow marker value alongside the row counts", async () => {
    api.phase3Status.mockResolvedValue(
      statusBody({
        formal: {
          studentCount: 17,
          rowCount: 51,
          batchIds: ["b"],
          importedAt: "2026-08-25T09:00:00.000Z",
          batchId: "b",
          complete: true,
          inconsistent: false,
          inconsistencyReason: null,
        },
      })
    );
    renderPanel();
    expect(await screen.findByText("Formal cohort imported")).toBeInTheDocument();
    expect(screen.getByText(/2026-08-25T09:00:00.000Z/)).toBeInTheDocument();
    expect(screen.queryByText("Flow state inconsistent")).not.toBeInTheDocument();
  });
});
