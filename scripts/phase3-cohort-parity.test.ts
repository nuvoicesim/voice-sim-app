/* eslint-disable @typescript-eslint/no-explicit-any -- seed-phase3.mjs is untyped JavaScript; its transact items are inspected structurally */
/**
 * Drift guard for the two Phase 3 writers.
 *
 * The website (amplify/functions/shared/phase3-cohort.ts) and the operator CLI
 * (scripts/seed-phase3.mjs) both write ReviewerFeedback rows and the tester
 * history marker. The CLI is a `.mjs` file and cannot import the `.ts` contract
 * at runtime, so it keeps literal copies. This test is what actually keeps them
 * equal: if someone updates the cohort in one place only, this fails.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import * as cli from "./seed-phase3.mjs";
import {
  PHASE3_EXPECTED_SOURCE_ORDERS,
  PHASE3_FORMAL_ASSIGNMENT_VERSION,
  PHASE3_FORMAL_RANDOM_SEED,
  PHASE3_FORMAL_ROW_COUNT,
  PHASE3_FORMAL_STUDENT_COUNT,
  PHASE3_IMPORT_KIND_FORMAL,
  PHASE3_IMPORT_KIND_TESTER,
  PHASE3_SOURCE_MAP,
  PHASE3_TEMPLATE_COLUMNS,
  PHASE3_TESTER_HISTORY_EVENT_TYPE,
  phase3TesterHistoryEventId,
} from "../amplify/functions/shared/phase3-cohort";

describe("Phase 3 cohort contract parity (CLI vs website)", () => {
  it("agrees on the formal cohort size", () => {
    expect(cli.FORMAL_STUDENT_COUNT).toBe(PHASE3_FORMAL_STUDENT_COUNT);
    expect(cli.FORMAL_ROW_COUNT).toBe(PHASE3_FORMAL_ROW_COUNT);
    expect(PHASE3_FORMAL_STUDENT_COUNT).toBe(17);
    expect(PHASE3_FORMAL_ROW_COUNT).toBe(51);
  });

  it("agrees on the frozen six-way source-order allocation", () => {
    expect(cli.EXPECTED_SOURCE_ORDERS).toEqual(PHASE3_EXPECTED_SOURCE_ORDERS);
    expect(PHASE3_EXPECTED_SOURCE_ORDERS).toEqual({
      "AI→F1→F2": 3,
      "AI→F2→F1": 3,
      "F1→AI→F2": 3,
      "F1→F2→AI": 3,
      "F2→AI→F1": 2,
      "F2→F1→AI": 3,
    });
  });

  it("the allocation sums to the cohort size", () => {
    const total = Object.values(PHASE3_EXPECTED_SOURCE_ORDERS).reduce(
      (a, b) => a + b,
      0
    );
    expect(total).toBe(PHASE3_FORMAL_STUDENT_COUNT);
    expect(total * 3).toBe(PHASE3_FORMAL_ROW_COUNT);
  });

  it("agrees on the frozen provenance constants", () => {
    expect(cli.FORMAL_ASSIGNMENT_VERSION).toBe(PHASE3_FORMAL_ASSIGNMENT_VERSION);
    expect(cli.FORMAL_RANDOM_SEED).toBe(PHASE3_FORMAL_RANDOM_SEED);
    expect(PHASE3_FORMAL_ASSIGNMENT_VERSION).toBe("v1");
    expect(PHASE3_FORMAL_RANDOM_SEED).toBe("20260825");
  });

  it("agrees on the template header and source mapping", () => {
    expect(cli.TEMPLATE_COLUMNS).toEqual([...PHASE3_TEMPLATE_COLUMNS]);
    expect(cli.SOURCE_MAP).toEqual(PHASE3_SOURCE_MAP);
  });

  it("agrees on the import-kind markers", () => {
    expect(cli.IMPORT_KIND_FORMAL).toBe(PHASE3_IMPORT_KIND_FORMAL);
    expect(cli.IMPORT_KIND_TESTER).toBe(PHASE3_IMPORT_KIND_TESTER);
    expect(cli.TESTER_HISTORY_EVENT_TYPE).toBe(
      PHASE3_TESTER_HISTORY_EVENT_TYPE
    );
  });

  it("produces byte-identical tester-history event ids", () => {
    const cases: Array<[string, string]> = [
      ["p3ac-mod-1", "sub-abc"],
      ["p3ac-mod-1", "11111111-2222-3333-4444-555555555555"],
      ["some-legacy-item-id", "sub-with-dashes-and-1234"],
    ];
    for (const [itemId, sub] of cases) {
      expect(cli.testerHistoryEventId(itemId, sub)).toBe(
        phase3TesterHistoryEventId(itemId, sub)
      );
      expect(cli.testerHistoryEventId(itemId, sub)).toBe(
        `phase3:tester-history:${itemId}:${sub}`
      );
    }
  });

  it("CLI tester rows carry the tester import kind and never formal provenance", () => {
    const stamped = cli.withAuditAttrs(
      { feedbackId: "phase3:sub-1:A" },
      {
        now: "2026-08-25T00:00:00.000Z",
        importKind: cli.IMPORT_KIND_TESTER,
        importBatchId: "batch-1",
        importedByUserId: "cli:1234",
        sourceCsvSha256: "deadbeef",
      }
    );
    expect(stamped._importKind).toBe(PHASE3_IMPORT_KIND_TESTER);
    expect(stamped._assignmentVersion).toBeUndefined();
    expect(stamped._randomSeed).toBeUndefined();
  });

  it("CLI formal rows carry the frozen provenance", () => {
    const stamped = cli.withAuditAttrs(
      { feedbackId: "phase3:sub-1:A" },
      {
        now: "2026-08-25T00:00:00.000Z",
        importKind: cli.IMPORT_KIND_FORMAL,
        importBatchId: "batch-1",
        importedByUserId: "cli:1234",
        sourceCsvSha256: "deadbeef",
        assignmentVersion: cli.FORMAL_ASSIGNMENT_VERSION,
        randomSeed: cli.FORMAL_RANDOM_SEED,
      }
    );
    expect(stamped._importKind).toBe(PHASE3_IMPORT_KIND_FORMAL);
    expect(stamped._assignmentVersion).toBe("v1");
    expect(stamped._randomSeed).toBe("20260825");
  });

  it("CLI tester-history marker is shaped for the website's gate and exclusion query", () => {
    const marker = cli.buildTesterHistoryMarker(
      "p3ac-mod-1",
      "sub-abc",
      "2026-08-25T12:34:56.000Z",
      { writtenBy: "cli" }
    );
    // Exact primary key => the website's BatchGet finds it.
    expect(marker.eventId).toBe(
      phase3TesterHistoryEventId("p3ac-mod-1", "sub-abc")
    );
    // eventType + moduleItemId => the analysis exclusion query finds it.
    expect(marker.eventType).toBe(PHASE3_TESTER_HISTORY_EVENT_TYPE);
    expect(marker.moduleItemId).toBe("p3ac-mod-1");
    expect(marker.studentUserId).toBe("sub-abc");
    // EventLog required attributes must all be present and defined.
    for (const field of [
      "eventId",
      "studentUserId",
      "studentDateKey",
      "eventType",
      "createdAt",
    ]) {
      expect(marker[field], `marker.${field}`).toBeTypeOf("string");
    }
    // DynamoDB's document client rejects undefined attribute values.
    for (const [k, v] of Object.entries(marker)) {
      expect(v, `marker.${k} must not be undefined`).not.toBeUndefined();
    }
  });
});

describe("CLI tester write is inseparable from the tester-history marker", () => {
  const rows = [
    { feedbackId: "phase3:sub-abc:A", displayKey: "A" },
    { feedbackId: "phase3:sub-abc:B", displayKey: "B" },
    { feedbackId: "phase3:sub-abc:C", displayKey: "C" },
  ];
  const build = () =>
    cli.buildTesterTransactItems({
      feedbackTable: "FeedbackTable",
      eventLogTable: "EventLogTable",
      itemId: "p3ac-mod-1",
      testerSub: "sub-abc",
      testerRows: rows,
      now: "2026-08-25T12:00:00.000Z",
      operatorUserId: "cli:1234",
      batchId: "p3ac-mod-1:cli:2026-08-25T12:00:00.000Z",
      sourceCsvSha256: "deadbeef",
    });

  it("puts the cards and the marker in ONE transaction", () => {
    const items = build();
    expect(items).toHaveLength(5);
    const cards = items.filter(
      (i: any) => i.Put.TableName === "FeedbackTable"
    );
    expect(cards).toHaveLength(3);
    for (const c of cards) {
      expect(c.Put.ConditionExpression).toBe("attribute_not_exists(feedbackId)");
    }
    const events = items
      .filter((i: any) => i.Put.TableName === "EventLogTable")
      .map((i: any) => i.Put.Item);
    expect(events).toHaveLength(2);
    const marker = events.find(
      (e: any) => e.eventType === PHASE3_TESTER_HISTORY_EVENT_TYPE
    );
    expect(marker).toBeDefined();
    expect(marker.eventId).toBe(
      phase3TesterHistoryEventId("p3ac-mod-1", "sub-abc")
    );
  });

  it("refuses to build a tester write with no EventLog table", () => {
    expect(() =>
      cli.buildTesterTransactItems({
        feedbackTable: "FeedbackTable",
        eventLogTable: "",
        itemId: "p3ac-mod-1",
        testerSub: "sub-abc",
        testerRows: rows,
        now: "2026-08-25T12:00:00.000Z",
        operatorUserId: "cli:1234",
        batchId: "b",
        sourceCsvSha256: "deadbeef",
      })
    ).toThrow(/without an EventLog table/i);
  });

  it("the marker id the CLI writes is the id the website's gate looks up", () => {
    const items = build();
    const marker = items
      .filter((i: any) => i.Put.TableName === "EventLogTable")
      .map((i: any) => i.Put.Item)
      .find((e: any) => e.eventType === PHASE3_TESTER_HISTORY_EVENT_TYPE);
    // The website builds exactly this key for its BatchGet gate.
    expect(marker.eventId).toBe(
      phase3TesterHistoryEventId("p3ac-mod-1", "sub-abc")
    );
  });
});

describe("CLI exact-match agrees with the website (finding 3)", () => {
  const base = {
    feedbackId: "phase3:sub-1:A",
    moduleItemId: "p3ac-mod-1",
    studentUserId: "sub-1",
    source: "ai",
    reviewerUserId: null,
    displayLabel: "AI",
    body: "narrative",
    displayKey: "A",
    dimensionScores: { d1: "3", d2: "2", d3: "N/A" },
    locked: true,
  };
  const withHash = {
    ...base,
    contentHash: cli.contentHash("3", "2", "N/A", "narrative"),
  };

  it("requires the import kind to match", () => {
    const expected = { ...withHash, _importKind: PHASE3_IMPORT_KIND_FORMAL };
    expect(cli.rowMatchesExpected({ ...expected }, expected)).toBe(true);
    expect(
      cli.rowMatchesExpected(
        { ...expected, _importKind: PHASE3_IMPORT_KIND_TESTER },
        expected
      )
    ).toBe(false);
    expect(cli.rowMatchesExpected({ ...withHash }, expected)).toBe(false);
  });

  it("requires the frozen provenance to match", () => {
    const expected = {
      ...withHash,
      _importKind: PHASE3_IMPORT_KIND_FORMAL,
      _assignmentVersion: "v1",
      _randomSeed: "20260825",
    };
    expect(cli.rowMatchesExpected({ ...expected }, expected)).toBe(true);
    for (const patch of [
      { _assignmentVersion: "v2" },
      { _randomSeed: "20260101" },
      { _assignmentVersion: undefined },
      { _randomSeed: undefined },
    ]) {
      const actual: any = { ...expected, ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete actual[k];
      expect(cli.rowMatchesExpected(actual, expected)).toBe(false);
    }
  });

  it("still ignores unrelated attributes so CLI and website verify each other", () => {
    const expected = { ...withHash, _importKind: PHASE3_IMPORT_KIND_TESTER };
    expect(
      cli.rowMatchesExpected(
        {
          ...expected,
          _importBatchId: "written-by-the-website",
          _importedAt: "2020-01-01T00:00:00.000Z",
          _somethingNew: true,
        },
        expected
      )
    ).toBe(true);
  });
});

describe("CLI tester purge is guarded and transactional (blocker 2)", () => {
  const AC = "p3ac-mod-1";
  const D = "p3d-mod-1";
  const SUB = "sub-t0";
  const NOW = "2026-08-25T12:00:00.000Z";

  const testerRow = (displayKey: string, patch: Record<string, unknown> = {}) => ({
    feedbackId: `phase3:${SUB}:${displayKey}`,
    moduleItemId: AC,
    studentUserId: SUB,
    displayKey,
    _importKind: PHASE3_IMPORT_KIND_TESTER,
    ...patch,
  });

  const build = (displayKeys: string[], observedGeneration: number | null = 2) =>
    cli.buildPurgeTransactItems({
      feedbackTable: "FeedbackTable",
      instanceTable: "SurveyInstanceTable",
      progressTable: "ProgressTable",
      eventLogTable: "EventLogTable",
      moduleItemTable: "ModuleItemTable",
      itemId: AC,
      partDItemId: D,
      sub: SUB,
      displayKeys,
      observedGeneration,
      now: NOW,
      operatorUserId: "cli:1234",
    });

  it("refuses a formal row — it can never be purged as a tester", () => {
    const { offenders, testerRows } = cli.classifyPurgeRows(
      [
        testerRow("A"),
        testerRow("B", { _importKind: PHASE3_IMPORT_KIND_FORMAL }),
      ],
      AC,
      SUB
    );
    expect(offenders.join("\n")).toMatch(/belongs to the formal cohort/);
    expect(testerRows).toHaveLength(1);
  });

  it("refuses an unknown row — type cannot be confirmed", () => {
    const row: Record<string, unknown> = testerRow("A");
    delete row._importKind;
    const { offenders } = cli.classifyPurgeRows([row], AC, SUB);
    expect(offenders.join("\n")).toMatch(/type cannot be confirmed/);
  });

  it("refuses rows scoped to another item, another student, or a hand-written id", () => {
    for (const [row, pattern] of [
      [testerRow("A", { moduleItemId: "other-item" }), /moduleItemId is not/],
      [testerRow("A", { studentUserId: "sub-other" }), /studentUserId is not/],
      [testerRow("A", { feedbackId: "hand-written" }), /not a deterministic/],
      [testerRow("Z"), /is not A\/B\/C/],
    ] as Array<[Record<string, unknown>, RegExp]>) {
      const { offenders } = cli.classifyPurgeRows([row], AC, SUB);
      expect(offenders.join("\n")).toMatch(pattern);
    }
  });

  it("builds one transaction: guard + conditional deletes + audit", () => {
    const items = build(["A", "B", "C"]) as any[];
    expect(items).toHaveLength(9);

    const guard = items.find((i) => i.Update);
    expect(guard.Update.TableName).toBe("ModuleItemTable");
    expect(guard.Update.Key).toEqual({ moduleItemId: AC });
    expect(guard.Update.ConditionExpression).toBe("#gen = :expectedGen");
    expect(guard.Update.ExpressionAttributeValues[":next"]).toBe(3);

    const cardDeletes = items.filter(
      (i) => i.Delete?.TableName === "FeedbackTable"
    );
    expect(cardDeletes).toHaveLength(3);
    for (const d of cardDeletes) {
      expect(d.Delete.ConditionExpression).toBe(
        "#kind = :tester AND #mi = :ac AND #su = :sub AND #dk = :key"
      );
      expect(d.Delete.ExpressionAttributeNames).toEqual({
        "#kind": "_importKind",
        "#mi": "moduleItemId",
        "#su": "studentUserId",
        "#dk": "displayKey",
      });
      expect(d.Delete.ExpressionAttributeValues[":tester"]).toBe("phase3_tester");
      expect(d.Delete.ExpressionAttributeValues[":ac"]).toBe(AC);
      expect(d.Delete.ExpressionAttributeValues[":sub"]).toBe(SUB);
    }

    expect(
      items.filter((i) => i.Delete?.TableName === "SurveyInstanceTable")
    ).toHaveLength(2);
    expect(
      items.filter((i) => i.Delete?.TableName === "ProgressTable")
    ).toHaveLength(2);

    const audit = items.find((i) => i.Put)?.Put.Item;
    expect(audit.eventType).toBe("phase3_tester_purged");
    expect(audit.payload.testerHistoryMarkerRetained).toBe(true);
    expect(audit.payload.eventLogRetained).toBe(true);
  });

  it("never touches the permanent tester-history marker", () => {
    const items = build(["A", "B", "C"]);
    expect(JSON.stringify(items)).not.toContain("tester-history");
    const markerId = phase3TesterHistoryEventId(AC, SUB);
    expect(JSON.stringify(items)).not.toContain(markerId);
  });

  it("advances the generation exactly once, with an absolute value (no ADD)", () => {
    const guard = (build(["A", "B", "C"], 7) as any[]).find((i) => i.Update);
    expect(guard.Update.UpdateExpression).toBe("SET #gen = :next");
    expect(guard.Update.UpdateExpression).not.toMatch(/ADD/);
    expect(guard.Update.ExpressionAttributeValues[":next"]).toBe(8);
    // A retry recomputes the same absolute value from the same observation, and
    // its condition no longer holds once the first attempt landed.
    const again = (build(["A", "B", "C"], 7) as any[]).find((i) => i.Update);
    expect(again.Update.ExpressionAttributeValues).toEqual(
      guard.Update.ExpressionAttributeValues
    );
  });

  it("distinguishes an unset generation from zero", () => {
    const unset = (build(["A"], null) as any[]).find((i) => i.Update);
    expect(unset.Update.ConditionExpression).toBe("attribute_not_exists(#gen)");
    expect(unset.Update.ExpressionAttributeValues[":next"]).toBe(1);
    const zero = (build(["A"], 0) as any[]).find((i) => i.Update);
    expect(zero.Update.ConditionExpression).toBe("#gen = :expectedGen");
    expect(zero.Update.ExpressionAttributeValues[":expectedGen"]).toBe(0);
  });

  it("refuses to build a purge with no conditional delete to authorize it", () => {
    expect(() => build([])).toThrow(/no conditional delete/i);
  });

  it("refuses to build a purge without the EventLog or ModuleItem table", () => {
    expect(() =>
      cli.buildPurgeTransactItems({
        feedbackTable: "F",
        instanceTable: "S",
        progressTable: "P",
        eventLogTable: "",
        moduleItemTable: "M",
        itemId: AC,
        partDItemId: D,
        sub: SUB,
        displayKeys: ["A"],
        observedGeneration: 0,
        now: NOW,
        operatorUserId: "cli:1",
      })
    ).toThrow(/EventLog and ModuleItem tables/i);
  });

  it("stays inside the DynamoDB transaction item limit", () => {
    expect((build(["A", "B", "C"]) as any[]).length).toBeLessThanOrEqual(100);
  });
});

function cliSource(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(resolve(here, "seed-phase3.mjs"), "utf8");
}

describe("CLI source no longer has an unconditional per-row delete path", () => {
  it("does not import or use DeleteCommand at all", () => {
    expect(cliSource()).not.toContain("DeleteCommand");
  });

  it("every Phase 3 safety read sets ConsistentRead", () => {
    // ModuleItem flow-state Get, scanStudentRows, formal scope Scan, the
    // enrollment Scan and the purge's flow-state Get.
    const src = cliSource();
    expect((src.match(/ConsistentRead: true/g) || []).length).toBeGreaterThanOrEqual(4);
  });
});

describe("CLI verifies target-course active enrollment (blocker 4)", () => {
  const COURSE = "course-1";

  /** Minimal paginating Scan stub that echoes ConsistentRead back for assertion. */
  function ddbWith(rows: Array<Record<string, unknown>>) {
    const commands: any[] = [];
    return {
      commands,
      send: async (command: any) => {
        commands.push(command);
        return { Items: rows };
      },
    };
  }

  const run = (rows: Array<Record<string, unknown>>, resolution: Map<string, string>) => {
    const ddb = ddbWith(rows);
    return cli
      .verifyActiveEnrollments(ddb, "CourseEnrollmentTable", COURSE, resolution)
      .then((errors: string[]) => ({ errors, ddb }));
  };

  it("accepts exactly one active enrollment whose sub matches Cognito", async () => {
    const { errors } = await run(
      [{ courseId: COURSE, studentUserId: "sub-1", studentEmail: "a@x.edu", status: "active" }],
      new Map([["a@x.edu", "sub-1"]])
    );
    expect(errors).toEqual([]);
  });

  it("reads the roster with ConsistentRead", async () => {
    const { ddb } = await run(
      [{ courseId: COURSE, studentUserId: "sub-1", studentEmail: "a@x.edu", status: "active" }],
      new Map([["a@x.edu", "sub-1"]])
    );
    expect(ddb.commands).toHaveLength(1);
    expect(ddb.commands[0].input.ConsistentRead).toBe(true);
    expect(ddb.commands[0].input.TableName).toBe("CourseEnrollmentTable");
    expect(ddb.commands[0].input.ExpressionAttributeValues).toEqual({ ":c": COURSE });
  });

  it("rejects an account with no active enrollment in the target course", async () => {
    const { errors } = await run([], new Map([["ghost@x.edu", "sub-9"]]));
    expect(errors.join("\n")).toMatch(/no active CourseEnrollment in course course-1/);
  });

  it("rejects two active rows for one email even when they name the same sub", async () => {
    const { errors } = await run(
      [
        { courseId: COURSE, studentUserId: "sub-1", studentEmail: "a@x.edu", status: "active" },
        { courseId: COURSE, studentUserId: "sub-1", studentEmail: "a@x.edu", status: "active" },
      ],
      new Map([["a@x.edu", "sub-1"]])
    );
    expect(errors.join("\n")).toMatch(/2 active enrollment rows/);
    expect(errors.join("\n")).toMatch(/roster is duplicated/);
  });

  it("rejects two active rows naming different accounts", async () => {
    const { errors } = await run(
      [
        { courseId: COURSE, studentUserId: "sub-1", studentEmail: "a@x.edu", status: "active" },
        { courseId: COURSE, studentUserId: "sub-2", studentEmail: "a@x.edu", status: "active" },
      ],
      new Map([["a@x.edu", "sub-1"]])
    );
    expect(errors.join("\n")).toMatch(/2 different accounts/);
  });

  it("rejects when Cognito and the roster disagree about the account", async () => {
    const { errors } = await run(
      [{ courseId: COURSE, studentUserId: "sub-roster", studentEmail: "a@x.edu", status: "active" }],
      new Map([["a@x.edu", "sub-cognito"]])
    );
    expect(errors.join("\n")).toMatch(
      /Cognito resolved sub-cognito but the course roster has sub-roster/
    );
  });

  it("rejects two different emails resolving to the same account", async () => {
    const { errors } = await run(
      [
        { courseId: COURSE, studentUserId: "sub-same", studentEmail: "a@x.edu", status: "active" },
        { courseId: COURSE, studentUserId: "sub-same", studentEmail: "b@x.edu", status: "active" },
      ],
      new Map([
        ["a@x.edu", "sub-same"],
        ["b@x.edu", "sub-same"],
      ])
    );
    expect(errors.join("\n")).toMatch(/same VOICE account/);
  });

  it("ignores removed enrollments", async () => {
    const { errors } = await run(
      [
        { courseId: COURSE, studentUserId: "sub-old", studentEmail: "a@x.edu", status: "removed" },
        { courseId: COURSE, studentUserId: "sub-new", studentEmail: "a@x.edu", status: "active" },
      ],
      new Map([["a@x.edu", "sub-new"]])
    );
    expect(errors).toEqual([]);
  });

  it("normalizes email case and whitespace before counting rows", async () => {
    const { errors } = await run(
      [{ courseId: COURSE, studentUserId: "sub-1", studentEmail: " A@X.EDU ", status: "active" }],
      new Map([["a@x.edu", "sub-1"]])
    );
    expect(errors).toEqual([]);
  });

  it("requires COURSE_ENROLLMENT_TABLE_NAME in the runbook", () => {
    expect(cliSource()).toContain("COURSE_ENROLLMENT_TABLE_NAME");
    expect(cliSource()).toMatch(/A Cognito hit alone does not/);
  });
});
