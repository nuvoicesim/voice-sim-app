import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canonicalCardContent,
  contentHash,
  parseCsv,
  readTemplate,
  validate,
} from "./seed-phase3.mjs";
import { hashCanonicalCardContent } from "../amplify/functions/survey-instance-function/phase3-cards";

const HEADER =
  "review_id,study_id,student_email,display_key,source_internal,d1,d2,d3,narrative,selected_source,session,student_turns";

describe("Phase 3 ingestion CSV", () => {
  it("parses RFC4180 commas, escaped quotes, Unicode, and embedded newlines", () => {
    const rows = parseCsv(
      `${HEADER}\r\nR1,S1,test@example.edu,A,ai,1,2,3,"First, ""quoted"" line\r\n第二行",Maria,Attempt 1,42\r\n`
    );
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveLength(12);
    expect(rows[1][8]).toBe('First, "quoted" line\r\n第二行');
  });

  it("rejects unterminated quoted fields", () => {
    expect(() => parseCsv(`${HEADER}\nR1,S1,x,A,ai,1,2,3,"broken`)).toThrow(
      /unterminated quoted field/i
    );
  });

  it("requires the exact frozen 12-column header and preserves narrative edges", () => {
    const dir = mkdtempSync(join(tmpdir(), "phase3-seed-test-"));
    const valid = join(dir, "valid.csv");
    writeFileSync(
      valid,
      `${HEADER}\nR1,S1,test@example.edu,A,ai,1,2,3,"  frozen narrative  ",Maria,Attempt 1,42\n`
    );
    expect(readTemplate(valid)[0].narrative).toBe("  frozen narrative  ");

    const invalid = join(dir, "invalid.csv");
    writeFileSync(
      invalid,
      `${HEADER},extra\nR1,S1,x,A,ai,1,2,3,n,Maria,a,1,x\n`
    );
    expect(() => readTemplate(invalid)).toThrow(
      /exactly the 12 frozen columns/i
    );
  });
});

describe("Phase 3 frozen data integrity", () => {
  it("uses NFC and NUL-delimited canonical hashing", () => {
    const composed = "caf\u00e9";
    const decomposed = "cafe\u0301";
    expect(canonicalCardContent("1", "2", "N/A", composed)).toBe(
      ["1", "2", "N/A", composed].join("\u0000")
    );
    expect(contentHash("1", "2", "N/A", composed)).toBe(
      contentHash("1", "2", "N/A", decomposed)
    );
    expect(contentHash("1", "2", "N/A", composed)).toBe(
      hashCanonicalCardContent("1", "2", "N/A", composed)
    );
  });

  it("rejects out-of-range scores rather than treating them as N/A", () => {
    const records = ["A", "B", "C"].map((display_key, index) => ({
      __line: index + 2,
      review_id: "R1",
      study_id: "S1",
      student_email: "test@example.edu",
      display_key,
      source_internal: ["ai", "faculty_1", "faculty_2"][index],
      d1: index === 0 ? "7" : "1",
      d2: "2",
      d3: "N/A",
      narrative: "Frozen narrative",
    }));
    expect(validate(records, { tester: true }).join("\n")).toContain(
      "d1 must be 1, 2, 3, 4 or N/A"
    );
  });
});
