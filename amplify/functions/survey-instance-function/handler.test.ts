/* eslint-disable @typescript-eslint/no-explicit-any -- the handler harness models schemaless DynamoDB documents */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { hashCanonicalCardContent } from "./phase3-cards";

/**
 * Handler-level verification of the Phase 3 wiring:
 *   - the eligibility gate actually runs on GET / PUT / submit
 *   - an ineligible student never gets a SurveyInstance row created
 *   - the blind payload carries no source information
 *   - reveal is all-or-nothing
 *   - ordinary (Phase 1 / Phase 2) surveys are untouched
 *
 * phase3-cards.test.ts covers the projection logic in isolation; this file
 * proves the handler is calling it in the right places.
 */

const STUDENT = "student-sub-1";
const OTHER_STUDENT = "student-sub-2";
const P3_ITEM = "item-p3ac";
const P3_D_ITEM = "item-p3d";
const PLAIN_ITEM = "item-plain-survey";
const LEGACY_REVEAL_ITEM = "item-legacy-reveal";

const mocks = vi.hoisted(() => {
  process.env.MODULE_ITEM_TABLE_NAME = "ModuleItemTable";
  process.env.SURVEY_INSTANCE_TABLE_NAME = "SurveyInstanceTable";
  process.env.SURVEY_TEMPLATE_TABLE_NAME = "SurveyTemplateTable";
  process.env.REVIEWER_FEEDBACK_TABLE_NAME = "ReviewerFeedbackTable";
  process.env.STUDENT_ITEM_PROGRESS_TABLE_NAME = "ProgressTable";
  process.env.EVENT_LOG_TABLE_NAME = "EventLogTable";
  process.env.ASSIGNMENT_TABLE_NAME = "AssignmentTable";
  process.env.CONSENT_DECISION_TABLE_NAME = "";
  return {
    // tableName -> keyJson -> row
    store: {} as Record<string, Record<string, any>>,
    // tableName -> rows (for Scan)
    scanRows: {} as Record<string, any[]>,
    scanPages: {} as Record<string, any[][]>,
    failFeedbackPutAfter: null as number | null,
    feedbackPutCount: 0,
    // Literal, not STUDENT: vi.hoisted runs before module consts initialize.
    caller: { userId: "student-sub-1", role: "student" } as any,
  };
});

vi.mock("../shared/auth-middleware", () => ({
  extractCallerIdentity: vi.fn(async () => mocks.caller),
  requireRole: vi.fn(() => null),
}));

vi.mock("../shared", async () => {
  const http = await vi.importActual<Record<string, unknown>>("../shared/http");
  const keyOf = (key: Record<string, unknown>) =>
    JSON.stringify(
      Object.keys(key)
        .sort()
        .map((k) => [k, key[k]])
    );
  return {
    ...http,
    createDynamoDbClient: () => ({
      // Only ReviewerFeedback is read via ScanCommand in the paths under test.
      send: async (command: any) => {
        const input = command?.input ?? {};
        const pages = mocks.scanPages[input.TableName];
        const pageIndex = input.ExclusiveStartKey?.page ?? 0;
        const rows =
          pages?.[pageIndex] ?? mocks.scanRows[input.TableName] ?? [];
        const v = input.ExpressionAttributeValues ?? {};
        return {
          Items: rows.filter(
            (r) =>
              (v[":i"] === undefined || r.moduleItemId === v[":i"]) &&
              (v[":s"] === undefined || r.studentUserId === v[":s"])
          ),
          ...(pages && pageIndex < pages.length - 1
            ? { LastEvaluatedKey: { page: pageIndex + 1 } }
            : {}),
        };
      },
    }),
    getItem: vi.fn(async (table: string, key: Record<string, unknown>) => {
      return mocks.store[table]?.[keyOf(key)] ?? null;
    }),
    putItem: vi.fn(async (table: string, item: Record<string, unknown>) => {
      if (table === "ReviewerFeedbackTable") {
        mocks.feedbackPutCount++;
        if (
          mocks.failFeedbackPutAfter !== null &&
          mocks.feedbackPutCount > mocks.failFeedbackPutAfter
        ) {
          throw new Error("simulated reveal write failure");
        }
      }
      mocks.store[table] = mocks.store[table] || {};
      // Mirror each table's real primary key so reads round-trip.
      const keyFields: Record<string, string[]> = {
        SurveyInstanceTable: ["moduleItemId", "studentUserId"],
        ProgressTable: ["moduleItemId", "studentUserId"],
        EventLogTable: ["eventId"],
        ReviewerFeedbackTable: ["feedbackId"],
      };
      const fields = keyFields[table] ?? ["id"];
      const key: Record<string, unknown> = {};
      for (const f of fields) key[f] = item[f];
      mocks.store[table][keyOf(key)] = item;
    }),
    generateId: () => "generated-id",
    generateTimestamp: () => "2026-08-17T00:00:00.000Z",
    requireCourseEnrollment: vi.fn(async () => null),
    requireCourseInstructor: vi.fn(async () => null),
  };
});

const { handler } = await import("./handler");

// ───────────────────────── fixtures ─────────────────────────

function card(
  displayKey: string,
  source: string,
  label: string,
  revealed = false
) {
  const body = `Narrative ${displayKey}`;
  return {
    feedbackId: `phase3:${STUDENT}:${displayKey}`,
    moduleItemId: P3_ITEM,
    studentUserId: STUDENT,
    source,
    displayLabel: label,
    reviewerUserId: null,
    body,
    dimensionScores: { d1: "3", d2: "N/A", d3: "4" },
    displayKey,
    contentHash: hashCanonicalCardContent("3", "N/A", "4", body),
    revealed,
    locked: true,
  };
}

function fullSet(revealed = false) {
  return [
    card("A", "reviewer", "Faculty 1", revealed),
    card("B", "ai", "AI", revealed),
    card("C", "reviewer", "Faculty 2", revealed),
  ];
}

function seedModuleItems() {
  mocks.store.ModuleItemTable = {};
  const put = (item: any) => {
    mocks.store.ModuleItemTable[
      JSON.stringify([["moduleItemId", item.moduleItemId]])
    ] = item;
  };
  put({
    moduleItemId: P3_ITEM,
    itemType: "survey",
    courseId: "course-1",
    moduleId: "module-1",
    payload: {
      surveyTemplateId: "tpl-p3",
      feedbackCardsFromItemId: P3_ITEM,
      revealOnSubmit: { unblindAssignmentItemId: P3_ITEM },
    },
  });
  put({
    moduleItemId: P3_D_ITEM,
    itemType: "survey",
    courseId: "course-1",
    moduleId: "module-1",
    payload: {
      surveyTemplateId: "tpl-p3d",
      feedbackCardsFromItemId: P3_ITEM,
    },
  });
  put({
    moduleItemId: PLAIN_ITEM,
    itemType: "survey",
    courseId: "course-1",
    moduleId: "module-1",
    payload: { surveyTemplateId: "tpl-plain" },
  });
  put({
    moduleItemId: LEGACY_REVEAL_ITEM,
    itemType: "survey",
    courseId: "course-1",
    moduleId: "module-1",
    // Legacy Phase 1/2 shape: reveal configured, but NOT a Phase 3 item.
    payload: {
      surveyTemplateId: "tpl-plain",
      revealOnSubmit: { unblindAssignmentItemId: LEGACY_REVEAL_ITEM },
    },
  });
  mocks.store.SurveyTemplateTable = {
    [JSON.stringify([["surveyTemplateId", "tpl-p3"]])]: {
      surveyTemplateId: "tpl-p3",
      name: "Phase 3 Parts A-C",
      description: "Intro",
      questions: [
        {
          id: "q1",
          type: "likert",
          prompt: "Q1",
          required: true,
          config: { scale: 7 },
        },
      ],
    },
    [JSON.stringify([["surveyTemplateId", "tpl-plain"]])]: {
      surveyTemplateId: "tpl-plain",
      name: "Phase 1 Survey",
      description: null,
      questions: [
        { id: "q1", type: "likert", prompt: "Q1", required: true, config: {} },
      ],
    },
    [JSON.stringify([["surveyTemplateId", "tpl-p3d"]])]: {
      surveyTemplateId: "tpl-p3d",
      name: "Phase 3 Part D",
      description: null,
      questions: [
        {
          id: "q26",
          type: "likert",
          prompt: "Q26",
          required: true,
          config: { scale: 7 },
        },
      ],
    },
  };
}

function evt(
  method: string,
  itemId: string,
  opts: { resource?: string; body?: string } = {}
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    pathParameters: { itemId },
    resource: opts.resource ?? "/module-items/{itemId}/survey-instance",
    queryStringParameters: null,
    body: opts.body ?? null,
  } as unknown as APIGatewayProxyEvent;
}

async function call(event: APIGatewayProxyEvent) {
  const res = (await handler(
    event,
    {} as Context,
    () => {}
  )) as APIGatewayProxyResult;
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

beforeEach(() => {
  mocks.store = {};
  mocks.scanRows = {};
  mocks.scanPages = {};
  mocks.failFeedbackPutAfter = null;
  mocks.feedbackPutCount = 0;
  mocks.caller = { userId: STUDENT, role: "student" };
  seedModuleItems();
});

// ───────────────────────── eligibility gate ─────────────────────────

describe("Phase 3 eligibility gate", () => {
  it("refuses GET for a student with no feedback cards", async () => {
    mocks.scanRows.ReviewerFeedbackTable = [];
    const { status, body } = await call(evt("GET", P3_ITEM));
    expect(status).toBe(403);
    expect(body.phase3Eligible).toBe(false);
    expect(body.reason).toBe("no_cards");
  });

  it("creates NO SurveyInstance row when the student is refused", async () => {
    mocks.scanRows.ReviewerFeedbackTable = [];
    await call(evt("GET", P3_ITEM));
    expect(mocks.store.SurveyInstanceTable).toBeUndefined();
  });

  it("refuses a student holding only a partial card set", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet().slice(0, 2);
    const { status, body } = await call(evt("GET", P3_ITEM));
    expect(status).toBe(403);
    expect(body.reason).toBe("incomplete_card_set");
  });

  it("refuses a student whose cards belong to someone else", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet();
    mocks.caller = { userId: OTHER_STUDENT, role: "student" };
    const { status } = await call(evt("GET", P3_ITEM));
    expect(status).toBe(403);
  });

  it("refuses autosave (PUT) for an ineligible student", async () => {
    mocks.scanRows.ReviewerFeedbackTable = [];
    const { status } = await call(
      evt("PUT", P3_ITEM, { body: JSON.stringify({ answers: { q1: 5 } }) })
    );
    expect(status).toBe(403);
  });

  it("refuses submit for an ineligible student", async () => {
    mocks.scanRows.ReviewerFeedbackTable = [];
    const { status } = await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(status).toBe(403);
  });

  it("admits a student with a complete A/B/C set", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet();
    const { status, body } = await call(evt("GET", P3_ITEM));
    expect(status).toBe(200);
    expect(body.instance.phase3Cards).toHaveLength(3);
  });

  it("collects all Scan pages before assessing the A/B/C set", async () => {
    const rows = fullSet();
    mocks.scanPages.ReviewerFeedbackTable = [[rows[0]], [rows[1]], [rows[2]]];
    const { status, body } = await call(evt("GET", P3_ITEM));
    expect(status).toBe(200);
    expect(body.instance.phase3Cards).toHaveLength(3);
  });
});

// ───────────────────────── blind payload ─────────────────────────

describe("blind payload", () => {
  beforeEach(() => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet(false);
  });

  it("returns cards ordered A, B, C with no source labels", async () => {
    const { body } = await call(evt("GET", P3_ITEM));
    expect(body.instance.phase3Cards.map((c: any) => c.displayKey)).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(
      body.instance.phase3Cards.every((c: any) => c.sourceType === null)
    ).toBe(true);
  });

  it("leaks no source information anywhere in the serialized response", async () => {
    const res = (await handler(
      evt("GET", P3_ITEM),
      {} as Context,
      () => {}
    )) as APIGatewayProxyResult;
    for (const forbidden of [
      "Faculty 1",
      "Faculty 2",
      "reviewerUserId",
      "displayLabel",
      "hash-A",
    ]) {
      expect(res.body).not.toContain(forbidden);
    }
  });

  it("carries the frozen scores and narrative", async () => {
    const { body } = await call(evt("GET", P3_ITEM));
    expect(body.instance.phase3Cards[0]).toEqual({
      displayKey: "A",
      d1: "3",
      d2: "N/A",
      d3: "4",
      narrative: "Narrative A",
      sourceType: null,
    });
  });
});

// ───────────────────────── reveal ─────────────────────────

describe("reveal", () => {
  it("discloses AI vs Faculty once every card is revealed", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet(true);
    const { body } = await call(evt("GET", P3_ITEM));
    expect(body.instance.phase3Cards.map((c: any) => c.sourceType)).toEqual([
      "Faculty-generated",
      "AI-generated",
      "Faculty-generated",
    ]);
  });

  it("still never names Faculty 1 or Faculty 2 after reveal", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet(true);
    const res = (await handler(
      evt("GET", P3_ITEM),
      {} as Context,
      () => {}
    )) as APIGatewayProxyResult;
    expect(res.body).not.toContain("Faculty 1");
    expect(res.body).not.toContain("Faculty 2");
    expect(res.body).toContain("Faculty-generated");
  });

  it("keeps every card blind when reveal is only partial (fail closed)", async () => {
    const rows = fullSet(true);
    rows[2].revealed = false; // interrupted reveal loop
    mocks.scanRows.ReviewerFeedbackTable = rows;
    const { body } = await call(evt("GET", P3_ITEM));
    expect(
      body.instance.phase3Cards.every((c: any) => c.sourceType === null)
    ).toBe(true);
  });

  it("flips all three rows to revealed on submit of the blind part", async () => {
    const rows = fullSet(false);
    mocks.scanRows.ReviewerFeedbackTable = rows;
    await call(evt("GET", P3_ITEM)); // create the instance
    await call(
      evt("PUT", P3_ITEM, { body: JSON.stringify({ answers: { q1: 5 } }) })
    );
    const { status } = await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(status).toBe(200);
    const written = Object.values(mocks.store.ReviewerFeedbackTable ?? {});
    expect(written).toHaveLength(3);
    expect(written.every((r: any) => r.revealed === true)).toBe(true);
  });

  it("keeps Part D blocked and progress incomplete when reveal fails after blind commit", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet(false);
    await call(evt("GET", P3_ITEM));
    await call(
      evt("PUT", P3_ITEM, { body: JSON.stringify({ answers: { q1: 5 } }) })
    );
    mocks.failFeedbackPutAfter = 1;

    const submit = await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(submit.status).toBe(200);
    expect(submit.body.instance.status).toBe("submitted");
    expect(submit.body.revealComplete).toBe(false);

    const progressRows = Object.values(
      mocks.store.ProgressTable ?? {}
    ) as any[];
    expect(progressRows.find((r) => r.moduleItemId === P3_ITEM)?.state).toBe(
      "in_progress"
    );

    mocks.failFeedbackPutAfter = null;
    const partD = await call(evt("GET", P3_D_ITEM));
    expect(partD.status).toBe(409);
    expect(partD.body.reason).toBe("reveal_pending");
    expect(
      Object.values(mocks.store.SurveyInstanceTable ?? {}).some(
        (r: any) => r.moduleItemId === P3_D_ITEM
      )
    ).toBe(false);
  });

  it("retries reveal idempotently for an already-submitted blind survey", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet(false);
    await call(evt("GET", P3_ITEM));
    await call(
      evt("PUT", P3_ITEM, { body: JSON.stringify({ answers: { q1: 5 } }) })
    );
    mocks.failFeedbackPutAfter = 0;
    await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );

    mocks.failFeedbackPutAfter = null;
    mocks.feedbackPutCount = 0;
    const retry = await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(retry.status).toBe(200);
    expect(retry.body.alreadySubmitted).toBe(true);
    expect(retry.body.revealComplete).toBe(true);
    const progressRows = Object.values(
      mocks.store.ProgressTable ?? {}
    ) as any[];
    expect(progressRows.find((r) => r.moduleItemId === P3_ITEM)?.state).toBe(
      "completed"
    );
  });

  it("rejects a Phase 3 submit with missing required answers", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet(false);
    await call(evt("GET", P3_ITEM));
    const submit = await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(submit.status).toBe(400);
    expect(submit.body.missingQuestionIds).toEqual(["q1"]);
  });

  it("requires Q23 Other text server-side when __other__ is selected", async () => {
    const templateKey = JSON.stringify([["surveyTemplateId", "tpl-p3"]]);
    mocks.store.SurveyTemplateTable[templateKey].questions = [
      {
        id: "q23",
        type: "choice_multi",
        prompt: "Q23",
        required: true,
        config: {
          options: [{ value: "tone", label: "Tone" }],
          allowOther: true,
          otherLabel: "Other feature not listed (specify)",
        },
      },
    ];
    mocks.scanRows.ReviewerFeedbackTable = fullSet(false);
    await call(evt("GET", P3_ITEM));
    await call(
      evt("PUT", P3_ITEM, {
        body: JSON.stringify({ answers: { q23: ["__other__"] } }),
      })
    );
    const denied = await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(denied.status).toBe(400);
    expect(denied.body.missingQuestionIds).toEqual(["q23"]);

    await call(
      evt("PUT", P3_ITEM, {
        body: JSON.stringify({
          answers: { q23__other_text: "Sentence structure" },
        }),
      })
    );
    const accepted = await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(accepted.status).toBe(200);
  });
});

// ───────────────────────── lock ─────────────────────────

describe("submitted answers are locked", () => {
  it("rejects autosave after submit with 409", async () => {
    mocks.scanRows.ReviewerFeedbackTable = fullSet();
    await call(evt("GET", P3_ITEM));
    await call(
      evt("PUT", P3_ITEM, { body: JSON.stringify({ answers: { q1: 5 } }) })
    );
    await call(
      evt("POST", P3_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    const { status } = await call(
      evt("PUT", P3_ITEM, { body: JSON.stringify({ answers: { q1: 7 } }) })
    );
    expect(status).toBe(409);
  });
});

// ───────────────────── Phase 1 / Phase 2 regression ─────────────────────

describe("ordinary surveys are unaffected", () => {
  it("loads a non-Phase-3 survey with no cards and no gate, even with zero feedback rows", async () => {
    mocks.scanRows.ReviewerFeedbackTable = [];
    const { status, body } = await call(evt("GET", PLAIN_ITEM));
    expect(status).toBe(200);
    expect(body.instance.phase3Cards).toBeUndefined();
    expect(body.instance.schemaSnapshot.name).toBe("Phase 1 Survey");
  });

  it("allows autosave and submit on a non-Phase-3 survey", async () => {
    mocks.scanRows.ReviewerFeedbackTable = [];
    await call(evt("GET", PLAIN_ITEM));
    const save = await call(
      evt("PUT", PLAIN_ITEM, { body: JSON.stringify({ answers: { q1: 4 } }) })
    );
    expect(save.status).toBe(200);
    expect(save.body.instance.answers).toEqual({ q1: 4 });
    const submit = await call(
      evt("POST", PLAIN_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(submit.status).toBe(200);
    expect(submit.body.instance.status).toBe("submitted");
  });

  it("resumes a non-Phase-3 survey with previously saved answers", async () => {
    mocks.scanRows.ReviewerFeedbackTable = [];
    await call(evt("GET", PLAIN_ITEM));
    await call(
      evt("PUT", PLAIN_ITEM, { body: JSON.stringify({ answers: { q1: 6 } }) })
    );
    const { body } = await call(evt("GET", PLAIN_ITEM));
    expect(body.instance.answers).toEqual({ q1: 6 });
  });

  it("still performs the legacy Phase 1/2 reveal for rows without Phase 3 columns", async () => {
    // Legacy rows carry no displayKey/dimensionScores/contentHash. The Phase 3
    // card-set precondition must not be applied to them, or every legacy
    // revealOnSubmit would silently no-op.
    mocks.scanRows.ReviewerFeedbackTable = [
      {
        feedbackId: "legacy-1",
        moduleItemId: LEGACY_REVEAL_ITEM,
        studentUserId: STUDENT,
        source: "ai",
        displayLabel: "AI",
        body: "Legacy AI feedback",
        score: 5,
        revealed: false,
        locked: false,
      },
      {
        feedbackId: "legacy-2",
        moduleItemId: LEGACY_REVEAL_ITEM,
        studentUserId: STUDENT,
        source: "reviewer",
        displayLabel: "Reviewer",
        body: "Legacy reviewer feedback",
        score: 6,
        revealed: false,
        locked: false,
      },
    ];
    await call(evt("GET", LEGACY_REVEAL_ITEM));
    const submit = await call(
      evt("POST", LEGACY_REVEAL_ITEM, {
        resource: "/module-items/{itemId}/survey-instance/submit",
      })
    );
    expect(submit.status).toBe(200);
    const written = Object.values(mocks.store.ReviewerFeedbackTable ?? {});
    expect(written).toHaveLength(2);
    expect(written.every((r: any) => r.revealed === true)).toBe(true);
    // Legacy items complete normally regardless of Phase 3 reveal semantics.
    const progress = Object.values(mocks.store.ProgressTable ?? {}).find(
      (p: any) => p.moduleItemId === LEGACY_REVEAL_ITEM
    ) as any;
    expect(progress?.state).toBe("completed");
  });
});
