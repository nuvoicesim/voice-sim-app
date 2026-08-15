import { describe, it, expect } from "vitest";
import {
  buildCueEventsCsv,
  classifyInteractionEvents,
  csvField,
  CUE_EVENTS_CSV_HEADER,
  type CueEventsCsvInput,
} from "./cue-events-csv";
import { buildReviewPackage, type BuildInput } from "./review-package";

// ───────────── Fixtures (mirror the real stored shapes) ─────────────
// SessionEvidence.rawEvidencePayload is the verbatim Unity envelope written by
// llm-scoring-function (phase1-rubric.ts / phase2-evidence.ts): a native
// object with context/taskContext/studyTaskContext. The Unity contract
// records several interaction event types (item_tracking_started,
// student_utterance_recorded, patient_utterance_recorded, cue_pressed) using
// fields eventType / itemId / cueLevel / occurredAt.

const STUDENT = "student-sub-1";
const EMAIL = "student1@example.edu";
const COURSE = "course-1";
const ASSIGNMENT = "assign-1";

const INTERACTION_EVENTS = [
  // index 0-1: non-cue telemetry — must NEVER become cue_event rows.
  {
    eventType: "item_tracking_started",
    itemId: "B-01",
    occurredAt: "2026-08-01T10:04:00.000Z",
  },
  {
    eventType: "student_utterance_recorded",
    itemId: "B-01",
    occurredAt: "2026-08-01T10:04:30.000Z",
    utteranceText: "TRANSCRIPT_UTTERANCE_TEXT",
  },
  // index 2-3: repeated identical cue press — must stay separate rows.
  {
    eventType: "cue_pressed",
    cueLevel: "Semantic",
    itemId: "B-01",
    occurredAt: "2026-08-01T10:05:00.000Z",
    cueMessageText: "SECRET_CUE_MESSAGE_TEXT",
  },
  {
    eventType: "cue_pressed",
    cueLevel: "Semantic",
    itemId: "B-01",
    occurredAt: "2026-08-01T10:05:03.000Z",
  },
  // index 4: non-cue telemetry between presses.
  {
    eventType: "patient_utterance_recorded",
    itemId: "B-01",
    occurredAt: "2026-08-01T10:05:10.000Z",
    utteranceText: "PATIENT_UTTERANCE_TEXT",
  },
  // index 5: cue press with a raw (lowercase) level value.
  {
    eventType: "cue_pressed",
    cueLevel: "phonemic",
    itemId: "B-02",
    occurredAt: "2026-08-01T10:06:00.000Z",
  },
];

// Item summaries with sensitive content that must NEVER reach the CSV.
const ITEMS = [
  {
    itemId: "B-01",
    targetAnswer: "zebra",
    alternateTarget: "stallion",
    patientFinalResponse: "PATIENT_RESPONSE_TEXT it is a zebra",
    studentSelectedScore: 2,
    cueUsed: true,
    cueLevel: "Semantic",
  },
];

function makePayload(studyTaskContext: unknown): Record<string, unknown> {
  return {
    userID: STUDENT,
    context: { assignmentId: ASSIGNMENT, sessionId: "sess-1" },
    taskContext: { phaseId: "phase2", taskId: "phase2-ben-object-naming" },
    conversationTurns: [
      { userText: "TRANSCRIPT_STUDENT_TEXT", modelText: "TRANSCRIPT_PATIENT_TEXT" },
    ],
    metadata: { voiceSettings: { voice: "VOICE_SETTING_VALUE" }, apiToken: "SECRET_TOKEN" },
    studyTaskContext,
  };
}

function makeSession(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId: "sess-1",
    assignmentId: ASSIGNMENT,
    studentUserId: STUDENT,
    attemptNo: 1,
    mode: "assignment",
    status: "completed",
    startedAt: "2026-08-01T10:00:00.000Z",
    endedAt: "2026-08-01T10:30:00.000Z",
    createdAt: "2026-08-01T10:00:00.000Z",
    ...over,
  };
}

function makeEvidence(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    evidenceId: "ev-1",
    sessionId: "sess-1",
    assignmentId: ASSIGNMENT,
    studentUserId: STUDENT,
    phaseId: "phase2",
    taskType: "object_naming",
    taskId: "phase2-ben-object-naming",
    feedbackUse: "phase2_training_evidence",
    submittedAt: "2026-08-01T10:20:00.000Z",
    createdAt: "2026-08-01T10:20:00.000Z",
    rawEvidencePayload: makePayload({ items: ITEMS, interactionEvents: INTERACTION_EVENTS }),
    ...over,
  };
}

function makeInput(over: Partial<CueEventsCsvInput> = {}): CueEventsCsvInput {
  return {
    studentEmail: EMAIL,
    studentUserId: STUDENT,
    courseId: COURSE,
    courseAssignmentIds: new Set([ASSIGNMENT]),
    sessions: [makeSession()],
    evidenceRows: [makeEvidence()],
    ...over,
  };
}

const COL: Record<string, number> = {};
CUE_EVENTS_CSV_HEADER.forEach((name, i) => {
  COL[name] = i;
});

/** Split CSV output into rows of cells. Only safe for fixture rows without
 * embedded commas/quotes — escaping behavior is asserted on the raw string. */
function parseRows(csv: string): string[][] {
  return csv
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => line.split(","));
}

function dataRows(csv: string): string[][] {
  return parseRows(csv).slice(1);
}

// ───────────── Tests ─────────────

describe("classifyInteractionEvents", () => {
  it("classifies a real payload with events as present", () => {
    const { status, events } = classifyInteractionEvents(
      makePayload({ items: ITEMS, interactionEvents: INTERACTION_EVENTS })
    );
    expect(status).toBe("present");
    expect(events).toHaveLength(6);
  });

  it("classifies an empty array as empty", () => {
    expect(classifyInteractionEvents(makePayload({ interactionEvents: [] })).status).toBe(
      "empty"
    );
  });

  it("classifies absent interactionEvents / studyTaskContext / payload as missing", () => {
    expect(classifyInteractionEvents(makePayload({ items: ITEMS })).status).toBe("missing");
    const noCtx = makePayload(undefined);
    delete noCtx.studyTaskContext;
    expect(classifyInteractionEvents(noCtx).status).toBe("missing");
    expect(classifyInteractionEvents(null).status).toBe("missing");
  });

  it("classifies unparseable payloads and non-array events as invalid", () => {
    expect(classifyInteractionEvents(42).status).toBe("invalid");
    expect(classifyInteractionEvents("not json {").status).toBe("invalid");
    expect(classifyInteractionEvents(makePayload("garbage string")).status).toBe("invalid");
    expect(
      classifyInteractionEvents(makePayload({ interactionEvents: "nope" })).status
    ).toBe("invalid");
  });

  it("parses rawEvidencePayload stored as a JSON string (DynamoDB round-trip)", () => {
    const asString = JSON.stringify(makePayload({ interactionEvents: INTERACTION_EVENTS }));
    const { status, events } = classifyInteractionEvents(asString);
    expect(status).toBe("present");
    expect(events).toHaveLength(6);
  });
});

describe("buildCueEventsCsv — cue_pressed selection", () => {
  it("emits the exact header row", () => {
    const csv = buildCueEventsCsv(makeInput());
    expect(parseRows(csv)[0]).toEqual([...CUE_EVENTS_CSV_HEADER]);
  });

  it("emits ONLY cue_pressed entries as cue_event rows, keeping raw indices and repeats", () => {
    const csv = buildCueEventsCsv(makeInput());
    const rows = dataRows(csv);
    const coverage = rows.filter((r) => r[COL.row_type] === "coverage");
    const events = rows.filter((r) => r[COL.row_type] === "cue_event");

    expect(coverage).toHaveLength(1);
    expect(coverage[0][COL.interaction_events_status]).toBe("present");
    // Counts are unambiguous: all raw entries vs actual cue clicks.
    expect(coverage[0][COL.interaction_event_count]).toBe("6");
    expect(coverage[0][COL.cue_press_count]).toBe("3");
    expect(coverage[0][COL.evidence_submitted_at]).toBe("2026-08-01T10:20:00.000Z");
    expect(coverage[0][COL.session_status]).toBe("completed");
    expect(coverage[0][COL.phase_id]).toBe("phase2");
    expect(coverage[0][COL.task_id]).toBe("phase2-ben-object-naming");

    expect(events).toHaveLength(3);
    // event_index is the ORIGINAL position in interactionEvents, not compacted.
    expect(events.map((r) => r[COL.event_index])).toEqual(["2", "3", "5"]);
    expect(events.every((r) => r[COL.event_type] === "cue_pressed")).toBe(true);
    // Repeated identical clicks remain distinct rows.
    expect(events[0][COL.event_item_id]).toBe("B-01");
    expect(events[1][COL.event_item_id]).toBe("B-01");
    expect(events[0][COL.event_timestamp]).toBe("2026-08-01T10:05:00.000Z");
    expect(events[1][COL.event_timestamp]).toBe("2026-08-01T10:05:03.000Z");
    // Raw vs normalized cue level.
    expect(events[0][COL.cue_level_normalized]).toBe("Semantic");
    expect(events[2][COL.cue_level_raw]).toBe("phonemic");
    expect(events[2][COL.cue_level_normalized]).toBe("Phonemic");
  });

  it("excludes tracking and utterance events from cue_event rows", () => {
    const csv = buildCueEventsCsv(makeInput());
    expect(csv).not.toContain("item_tracking_started");
    expect(csv).not.toContain("student_utterance_recorded");
    expect(csv).not.toContain("patient_utterance_recorded");
  });

  it("normalizes eventType defensively but never matches unrelated types", () => {
    const variants = [
      { eventType: "CuePressed", cueLevel: "Model" },
      { eventType: "CUE_PRESSED", cueLevel: "Semantic" },
      { eventType: " cue-pressed ", cueLevel: "Phonemic" },
      // Legacy field name fallback.
      { type: "cue_pressed", cueLevel: "Semantic" },
      // Near-misses that must NOT be classified as cue clicks.
      { eventType: "cue_shown", cueLevel: "Semantic" },
      { eventType: "cue" },
      { eventType: "cue_pressed_undo" },
    ];
    const rows = dataRows(
      buildCueEventsCsv(
        makeInput({
          evidenceRows: [
            makeEvidence({
              rawEvidencePayload: makePayload({ interactionEvents: variants }),
            }),
          ],
        })
      )
    );
    const events = rows.filter((r) => r[COL.row_type] === "cue_event");
    expect(events.map((r) => r[COL.event_index])).toEqual(["0", "1", "2", "3"]);
    const coverage = rows.find((r) => r[COL.row_type] === "coverage");
    expect(coverage?.[COL.interaction_event_count]).toBe("7");
    expect(coverage?.[COL.cue_press_count]).toBe("4");
    expect(rows.some((r) => r[COL.event_type] === "cue_shown")).toBe(false);
    expect(rows.some((r) => r[COL.event_type] === "cue_pressed_undo")).toBe(false);
  });

  it("emits present coverage with zero cue rows when no cue_pressed entries exist", () => {
    const rows = dataRows(
      buildCueEventsCsv(
        makeInput({
          evidenceRows: [
            makeEvidence({
              rawEvidencePayload: makePayload({
                interactionEvents: [
                  { eventType: "item_tracking_started", itemId: "B-01" },
                  { eventType: "student_utterance_recorded", itemId: "B-01" },
                ],
              }),
            }),
          ],
        })
      )
    );
    const coverage = rows.filter((r) => r[COL.row_type] === "coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0][COL.interaction_events_status]).toBe("present");
    expect(coverage[0][COL.interaction_event_count]).toBe("2");
    expect(coverage[0][COL.cue_press_count]).toBe("0");
    expect(rows.filter((r) => r[COL.row_type] === "cue_event")).toHaveLength(0);
  });

  it("keeps missing / empty / invalid / present-no-cue / no_evidence distinguishable", () => {
    const input = makeInput({
      sessions: [
        makeSession({ sessionId: "s-missing", startedAt: "2026-08-01T01:00:00.000Z" }),
        makeSession({ sessionId: "s-empty", startedAt: "2026-08-01T02:00:00.000Z" }),
        makeSession({ sessionId: "s-invalid", startedAt: "2026-08-01T03:00:00.000Z" }),
        makeSession({ sessionId: "s-nocue", startedAt: "2026-08-01T04:00:00.000Z" }),
        makeSession({ sessionId: "s-noevidence", startedAt: "2026-08-01T05:00:00.000Z" }),
      ],
      evidenceRows: [
        makeEvidence({
          evidenceId: "ev-missing",
          sessionId: "s-missing",
          rawEvidencePayload: makePayload({ items: ITEMS }),
        }),
        makeEvidence({
          evidenceId: "ev-empty",
          sessionId: "s-empty",
          rawEvidencePayload: makePayload({ interactionEvents: [] }),
        }),
        makeEvidence({
          evidenceId: "ev-invalid",
          sessionId: "s-invalid",
          rawEvidencePayload: "not parseable {",
        }),
        makeEvidence({
          evidenceId: "ev-nocue",
          sessionId: "s-nocue",
          rawEvidencePayload: makePayload({
            interactionEvents: [{ eventType: "item_tracking_started", itemId: "B-01" }],
          }),
        }),
      ],
    });
    const rows = dataRows(buildCueEventsCsv(input));
    const statusByEvidence = new Map(
      rows
        .filter((r) => r[COL.row_type] === "coverage")
        .map((r) => [r[COL.evidence_id] || r[COL.session_id], r[COL.interaction_events_status]])
    );
    expect(statusByEvidence.get("ev-missing")).toBe("missing");
    expect(statusByEvidence.get("ev-empty")).toBe("empty");
    expect(statusByEvidence.get("ev-invalid")).toBe("invalid");
    expect(statusByEvidence.get("ev-nocue")).toBe("present");
    expect(statusByEvidence.get("s-noevidence")).toBe("no_evidence");
    // present-with-no-cue-presses yields NO cue_event rows.
    expect(rows.filter((r) => r[COL.row_type] === "cue_event")).toHaveLength(0);
  });

  it("counts unparseable entries but never emits them, preserving raw indices", () => {
    const input = makeInput({
      evidenceRows: [
        makeEvidence({
          rawEvidencePayload: makePayload({
            interactionEvents: [INTERACTION_EVENTS[2], "corrupt-entry", INTERACTION_EVENTS[5]],
          }),
        }),
      ],
    });
    const rows = dataRows(buildCueEventsCsv(input));
    const events = rows.filter((r) => r[COL.row_type] === "cue_event");
    expect(events).toHaveLength(2);
    expect(events.map((r) => r[COL.event_index])).toEqual(["0", "2"]);
    const coverage = rows.find((r) => r[COL.row_type] === "coverage");
    expect(coverage?.[COL.interaction_event_count]).toBe("3");
    expect(coverage?.[COL.cue_press_count]).toBe("2");
  });

  it("includes incomplete-session evidence and separate submissions per session", () => {
    const input = makeInput({
      sessions: [makeSession({ sessionId: "sess-1", status: "abandoned" })],
      evidenceRows: [
        makeEvidence({ evidenceId: "ev-b", submittedAt: "2026-08-01T10:25:00.000Z" }),
        makeEvidence({ evidenceId: "ev-a", submittedAt: "2026-08-01T10:20:00.000Z" }),
      ],
    });
    const coverage = dataRows(buildCueEventsCsv(input)).filter(
      (r) => r[COL.row_type] === "coverage"
    );
    expect(coverage).toHaveLength(2);
    // Separate SessionEvidence submissions stay separate, ordered by submittedAt.
    expect(coverage.map((r) => r[COL.evidence_id])).toEqual(["ev-a", "ev-b"]);
    expect(coverage.every((r) => r[COL.session_status] === "abandoned")).toBe(true);
  });

  it("includes orphan evidence for this course with an explicit session marker", () => {
    const input = makeInput({
      sessions: [],
      evidenceRows: [makeEvidence({ sessionId: "sess-unknown" })],
    });
    const rows = dataRows(buildCueEventsCsv(input));
    const coverage = rows.filter((r) => r[COL.row_type] === "coverage");
    expect(coverage).toHaveLength(1);
    expect(coverage[0][COL.session_status]).toBe("session_not_found");
    expect(rows.filter((r) => r[COL.row_type] === "cue_event")).toHaveLength(3);
  });

  it("puts student_email and source_student_id on every event and coverage row", () => {
    const input = makeInput({
      sessions: [makeSession(), makeSession({ sessionId: "s-noevidence" })],
    });
    const rows = dataRows(buildCueEventsCsv(input));
    expect(rows.length).toBeGreaterThan(2);
    for (const row of rows) {
      expect(row[COL.student_email]).toBe(EMAIL);
      expect(row[COL.source_student_id]).toBe(STUDENT);
      expect(row[COL.course_id]).toBe(COURSE);
    }
  });
});

describe("buildCueEventsCsv — student_email integrity", () => {
  it("marks a missing email explicitly instead of borrowing the student id", () => {
    for (const missing of ["", "   "]) {
      const rows = dataRows(buildCueEventsCsv(makeInput({ studentEmail: missing })));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row[COL.student_email]).toBe("email_unavailable");
        expect(row[COL.source_student_id]).toBe(STUDENT);
      }
    }
  });

  it("never emits the studentUserId in the student_email column", () => {
    // A caller that (incorrectly) passed the sub as the email is corrected.
    const rows = dataRows(buildCueEventsCsv(makeInput({ studentEmail: STUDENT })));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row[COL.student_email]).toBe("email_unavailable");
    }
    // The marker never looks like a valid email.
    expect("email_unavailable").not.toContain("@");
  });
});

describe("buildCueEventsCsv — scope guards", () => {
  it("excludes another student's sessions and evidence entirely", () => {
    const input = makeInput({
      sessions: [makeSession(), makeSession({ sessionId: "intruder-sess", studentUserId: "intruder-sub" })],
      evidenceRows: [
        makeEvidence(),
        makeEvidence({
          evidenceId: "intruder-ev",
          sessionId: "intruder-sess",
          studentUserId: "intruder-sub",
        }),
      ],
    });
    const csv = buildCueEventsCsv(input);
    expect(csv).not.toContain("intruder-ev");
    expect(csv).not.toContain("intruder-sess");
    expect(csv).not.toContain("intruder-sub");
  });

  it("excludes this student's evidence from other courses", () => {
    const input = makeInput({
      evidenceRows: [
        makeEvidence(),
        makeEvidence({
          evidenceId: "other-course-ev",
          sessionId: "other-course-sess",
          assignmentId: "other-course-assign",
        }),
      ],
    });
    expect(buildCueEventsCsv(input)).not.toContain("other-course-ev");
  });
});

describe("buildCueEventsCsv — escaping and privacy", () => {
  it("csvField applies RFC 4180 quoting and formula-injection neutralization", () => {
    expect(csvField("plain")).toBe("plain");
    expect(csvField('with "quote"')).toBe('"with ""quote"""');
    expect(csvField("a,b")).toBe('"a,b"');
    expect(csvField("line\nbreak")).toBe('"line\nbreak"');
    expect(csvField("=1+2")).toBe("'=1+2");
    expect(csvField("+SUM(A1)")).toBe("'+SUM(A1)");
    expect(csvField("-2+3")).toBe("'-2+3");
    expect(csvField("@cmd")).toBe("'@cmd");
    expect(csvField("  =cmd")).toBe("'  =cmd");
    expect(csvField("\tstart")).toBe("'\tstart");
    expect(csvField('=HYPERLINK("x"),y')).toBe('"\'=HYPERLINK(""x""),y"');
  });

  it("protects the identity fields too", () => {
    const csv = buildCueEventsCsv(
      makeInput({
        studentEmail: '=HYPERLINK("http://evil")@x.com',
        studentUserId: "+alarming-id",
        sessions: [makeSession({ studentUserId: "+alarming-id" })],
        evidenceRows: [makeEvidence({ studentUserId: "+alarming-id" })],
      })
    );
    expect(csv).toContain("'+alarming-id");
    expect(csv).toContain('"\'=HYPERLINK(""http://evil"")@x.com"');
  });

  it("never emits transcripts, utterances, cue text, targets, voice settings, or tokens", () => {
    const csv = buildCueEventsCsv(makeInput());
    for (const secret of [
      "zebra",
      "stallion",
      "PATIENT_RESPONSE_TEXT",
      "SECRET_CUE_MESSAGE_TEXT",
      "TRANSCRIPT_UTTERANCE_TEXT",
      "PATIENT_UTTERANCE_TEXT",
      "TRANSCRIPT_STUDENT_TEXT",
      "TRANSCRIPT_PATIENT_TEXT",
      "VOICE_SETTING_VALUE",
      "SECRET_TOKEN",
    ]) {
      expect(csv).not.toContain(secret);
    }
  });
});

describe("review package compatibility", () => {
  it("buildReviewPackage still prefers item summaries with events also present", () => {
    const evidence = makeEvidence();
    const session = makeSession();
    const input: BuildInput = {
      studentEmail: EMAIL,
      modules: [{ moduleId: "m-1", title: "Module 1", position: 1 }],
      moduleItems: [
        {
          moduleId: "m-1",
          courseId: COURSE,
          itemType: "assignment",
          position: 1,
          title: "Assignment 1",
          payload: { assignmentId: ASSIGNMENT },
        },
      ],
      assignmentsById: new Map([[ASSIGNMENT, { assignmentId: ASSIGNMENT, title: "Assignment 1" }]]),
      completedSessionsByAssignment: new Map([[ASSIGNMENT, [session]]]),
      turnsBySession: new Map(),
      evidenceBySession: new Map([["sess-1", [evidence]]]),
    };
    const pkg = buildReviewPackage(input);
    const attempt = pkg.modules[0].assignments[0].attempts[0];
    // Unchanged behavior: item-level summary wins; events are NOT double-counted.
    expect(attempt.cue.text).toBe(
      "Recorded cue use by item: Semantic 1, Phonemic 0, Model 0."
    );
    expect(attempt.cue.semantic).toBe(1);
    expect(attempt.cue.hasItems).toBe(true);
  });
});
