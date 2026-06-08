/**
 * HTML renderer for the faculty Review Package.
 *
 * Produces a single self-contained, print-friendly HTML document. ALL dynamic
 * content is HTML-escaped. No raw JSON, no rawEvidencePayload, no AI qualitative
 * feedback, no rubric. Colour is always paired with text (never colour alone).
 */

import type {
  ReviewPackage,
  ModuleView,
  AssignmentView,
  AttemptView,
  CueSummary,
  TaskBlock,
  TurnLike,
} from "./review-package";
import { formatClockTime } from "./review-package";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chip(label: string, value: string): string {
  return `<span class="chip"><span class="chip-k">${esc(label)}</span><span class="chip-v">${esc(
    value
  )}</span></span>`;
}

function cueChips(cue: CueSummary): string {
  return [
    `<span class="chip cue"><span class="chip-k">Semantic</span><span class="chip-v">${cue.semantic}</span></span>`,
    `<span class="chip cue"><span class="chip-k">Phonemic</span><span class="chip-v">${cue.phonemic}</span></span>`,
    `<span class="chip cue"><span class="chip-k">Model</span><span class="chip-v">${cue.model}</span></span>`,
  ].join(" ");
}

function completionBlock(text: string): string {
  const caution = /not marked completed/i.test(text);
  const cls = caution ? "completion warn" : "completion ok";
  const prefix = caution ? "⚠ Completion Check" : "Completion Check";
  return `<div class="${cls}"><span class="completion-label">${esc(prefix)}:</span> ${esc(text)}</div>`;
}

function cueSummaryLine(cue: CueSummary): string {
  return `<div class="cue-line"><span class="lbl">Cue Summary:</span> ${cueChips(
    cue
  )} <span class="cue-text">${esc(cue.text)}</span></div>`;
}

function itemLevelCueBlock(cue: CueSummary): string {
  if (!cue.hasItems || cue.items.length === 0) return "";
  const rows = cue.items
    .map((it) => {
      const detail = it.level
        ? `${esc(it.level)} cue recorded`
        : it.hasCue
        ? "Cue recorded"
        : "No cue recorded in submitted evidence";
      return `<li><span class="item-id">Item ${esc(it.itemId)}:</span> ${detail}</li>`;
    })
    .join("");
  return `<div class="item-cue"><div class="lbl">Item-Level Cue Use:</div><ul>${rows}</ul></div>`;
}

function transcriptTurns(turns: TurnLike[]): string {
  const bubbles: string[] = [];
  for (const t of turns) {
    const student = (t.userText ?? "").trim();
    if (student) {
      const time = formatClockTime(t.userSpeechStartAt || t.timestamp);
      bubbles.push(
        `<div class="bubble student"><div class="bubble-head">${
          time ? `<span class="time">[${esc(time)}]</span> ` : ""
        }<span class="speaker">Student</span></div><div class="bubble-body">${esc(student)}</div></div>`
      );
    }
    const patient = (t.modelText ?? "").trim();
    if (patient) {
      const time = formatClockTime(t.patientSpeechStartAt || t.timestamp);
      bubbles.push(
        `<div class="bubble patient"><div class="bubble-head">${
          time ? `<span class="time">[${esc(time)}]</span> ` : ""
        }<span class="speaker">Patient</span></div><div class="bubble-body">${esc(patient)}</div></div>`
      );
    }
  }
  if (bubbles.length === 0) {
    return `<div class="muted">No conversation turns recorded.</div>`;
  }
  return bubbles.join("\n");
}

function taskBlock(tb: TaskBlock): string {
  const summary = `
    <div class="task-summary">
      <div class="task-summary-title">Task: ${esc(tb.label)}</div>
      <div class="kv"><span class="lbl">Items Submitted / Items Recorded:</span> ${esc(
        tb.itemsSubmittedLabel
      )}</div>
      <div class="kv"><span class="lbl">Student Responses:</span> ${tb.studentResponses}</div>
      <div class="kv"><span class="lbl">Avg Words / Response:</span> ${esc(
        tb.avgWordsPerResponseLabel
      )}</div>
      ${cueSummaryLine(tb.cue)}
      <div class="kv"><span class="lbl">Completion Check:</span> Item-level transcript completion is not automatically verified.</div>
      <div class="kv note"><span class="lbl">Cue Mapping:</span> Cue summarized at task/item level when evidence is available. Cue timing within transcript is not shown.</div>
    </div>`;
  return `<div class="task">${summary}<div class="transcript">${transcriptTurns(tb.turns)}</div></div>`;
}

function attemptCard(a: AttemptView): string {
  const badge = a.recommended
    ? `<span class="badge rec">Recommended for Review</span>`
    : `<span class="badge other">Other Completed Attempt</span>`;
  const reason = a.recommended && a.recommendReason
    ? `<div class="reason"><span class="lbl">Reason:</span> ${esc(a.recommendReason)}</div>`
    : "";
  const taskBlocks =
    a.taskBlocks.length > 0
      ? a.taskBlocks.map(taskBlock).join("\n")
      : `<div class="muted">No transcript data available for this attempt.</div>`;

  return `
  <div class="attempt ${a.recommended ? "is-rec" : ""}">
    <div class="attempt-head">
      <span class="attempt-no">Attempt #${esc(a.attemptNo)}</span>
      ${badge}
    </div>
    ${reason}

    <div class="metric-group">
      <div class="metric-group-title">Primary Review Metrics</div>
      <div class="chips">
        ${chip("Status", a.status)}
        ${chip("Duration", a.metrics.durationLabel)}
        ${chip("Turns", String(a.metrics.totalTurns))}
        ${chip("Student Responses", String(a.metrics.studentResponses))}
      </div>
      ${completionBlock(a.completionCheck)}
    </div>

    <div class="metric-group">
      <div class="metric-group-title">Verbal Engagement <span class="subtle">(interaction length — not a clinical quality score)</span></div>
      <div class="chips">
        ${chip("Avg Words / Response", a.metrics.avgWordsPerResponseLabel)}
        ${chip("Short Responses (≤3 words)", String(a.metrics.shortResponses))}
        ${chip("Total Student Words", String(a.metrics.totalStudentWords))}
        ${chip("Longest Response (words)", a.metrics.studentResponses === 0 ? "—" : String(a.metrics.longestResponseWords))}
        ${chip("Engagement", a.metrics.engagementLabel ?? "Not enough data")}
      </div>
    </div>

    <div class="metric-group">
      <div class="metric-group-title">Cue Summary</div>
      ${cueSummaryLine(a.cue)}
      ${itemLevelCueBlock(a.cue)}
    </div>

    <div class="metric-group">
      <div class="metric-group-title">Transcript Evidence <span class="subtle">(task-level blocks)</span></div>
      ${taskBlocks}
    </div>
  </div>`;
}

function assignmentSummaryCard(asg: AssignmentView): string {
  const rec = asg.attempts[0];
  if (!rec) return "";
  return `
  <div class="summary-card">
    <div class="kv"><span class="lbl">Assignment:</span> <strong>${esc(asg.title)}</strong></div>
    <div class="kv"><span class="lbl">Number of Completed Attempts:</span> ${asg.completedAttemptCount}</div>
    <div class="kv"><span class="lbl">Recommended Attempt:</span> Attempt #${esc(rec.attemptNo)}</div>
    <div class="kv"><span class="lbl">Reason:</span> ${esc(rec.recommendReason ?? "—")}</div>
    ${completionBlock(rec.completionCheck)}
    <div class="metric-group-title mt">Key Metrics</div>
    <div class="chips">
      ${chip("Duration", rec.metrics.durationLabel)}
      ${chip("Turns", String(rec.metrics.totalTurns))}
      ${chip("Student Responses", String(rec.metrics.studentResponses))}
      ${chip("Avg Words / Response", rec.metrics.avgWordsPerResponseLabel)}
    </div>
    ${cueSummaryLine(rec.cue)}
    <div class="review-note">Review Note: Review this attempt first.</div>
  </div>`;
}

function moduleSection(mod: ModuleView): string {
  if (!mod.hasCompleted) {
    return `
    <section class="module">
      <h2 class="module-title">${esc(mod.title)}</h2>
      <div class="muted empty">No completed attempts found for this module.</div>
    </section>`;
  }

  const summaryCards = mod.assignments.map(assignmentSummaryCard).join("\n");
  const attemptSections = mod.assignments
    .map(
      (asg) => `
      <div class="assignment-attempts">
        <h4 class="assignment-name">${esc(asg.title)}</h4>
        ${asg.attempts.map((a) => attemptCard(a)).join("\n")}
      </div>`
    )
    .join("\n");

  return `
  <section class="module">
    <h2 class="module-title">${esc(mod.title)}</h2>

    <h3 class="section-title">A. Assignment-Level Summary</h3>
    <div class="summary-cards">${summaryCards}</div>

    <h3 class="section-title">B. Attempt Details</h3>
    ${attemptSections}
  </section>`;
}

const STYLE = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #2b2b2b; background: #ffffff; margin: 0; padding: 24px; line-height: 1.5;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .wrap { max-width: 960px; margin: 0 auto; }
  header.doc { border-bottom: 2px solid #c96442; padding-bottom: 12px; margin-bottom: 20px; }
  header.doc h1 { font-size: 22px; margin: 0 0 4px; color: #1f1f1f; }
  header.doc .student { font-size: 15px; color: #333; }
  header.doc .disclaimer { font-size: 12px; color: #6b6b6b; margin-top: 6px; }
  h2.module-title { font-size: 19px; background: #f4f1ec; border-left: 5px solid #c96442;
    padding: 10px 14px; margin: 28px 0 12px; border-radius: 4px; color: #1f1f1f; }
  h3.section-title { font-size: 15px; color: #444; margin: 18px 0 10px;
    text-transform: uppercase; letter-spacing: 0.04em; }
  h4.assignment-name { font-size: 15px; margin: 16px 0 8px; color: #2b2b2b; }
  .summary-cards { display: block; }
  .summary-card, .attempt {
    border: 1px solid #e6e1d8; background: #faf9f7; border-radius: 8px;
    padding: 14px 16px; margin: 0 0 14px; }
  .attempt.is-rec { border-color: #bcd9c3; background: #f4faf5; }
  .kv { margin: 3px 0; font-size: 14px; }
  .lbl { color: #555; font-weight: 600; }
  .note { color: #6b6b6b; font-size: 12.5px; }
  .mt { margin-top: 10px; }
  .review-note { margin-top: 10px; font-weight: 600; color: #2f6b3a; }
  .metric-group { margin: 12px 0; }
  .metric-group-title { font-size: 13px; font-weight: 700; color: #444; margin: 4px 0 6px;
    text-transform: uppercase; letter-spacing: 0.03em; }
  .subtle { font-weight: 400; text-transform: none; letter-spacing: 0; color: #6b6b6b; font-size: 12px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 6px; background: #fff;
    border: 1px solid #e0dacf; border-radius: 14px; padding: 3px 10px; font-size: 12.5px; }
  .chip-k { color: #6b6b6b; }
  .chip-v { font-weight: 700; color: #1f1f1f; }
  .chip.cue { background: #f3efe9; }
  .attempt-head { display: flex; align-items: center; gap: 10px; margin-bottom: 4px; }
  .attempt-no { font-weight: 700; font-size: 15px; }
  .badge { display: inline-block; font-size: 11.5px; font-weight: 700; padding: 2px 9px;
    border-radius: 10px; border: 1px solid transparent; }
  .badge.rec { background: #e8f3ea; color: #2f6b3a; border-color: #bcd9c3; }
  .badge.other { background: #f0eee9; color: #6b6b6b; border-color: #ddd6ca; }
  .reason { font-size: 13px; margin: 2px 0 8px; color: #333; }
  .completion { font-size: 13px; border-radius: 6px; padding: 7px 10px; margin: 8px 0; }
  .completion-label { font-weight: 700; }
  .completion.ok { background: #f1f4f1; border: 1px solid #d8e2d8; color: #2f4030; }
  .completion.warn { background: #fdf3f0; border: 1px solid #f0c9bd; color: #8a3520; }
  .cue-line { font-size: 13.5px; margin: 6px 0; }
  .cue-text { color: #444; }
  .item-cue { margin: 6px 0 2px; font-size: 13px; }
  .item-cue ul { margin: 4px 0 0; padding-left: 18px; }
  .item-cue li { margin: 2px 0; }
  .item-id { font-weight: 600; color: #444; }
  .task { border: 1px solid #ece7dd; border-radius: 6px; margin: 10px 0; overflow: hidden; }
  .task-summary { background: #f6f3ee; padding: 10px 12px; border-bottom: 1px solid #ece7dd; }
  .task-summary-title { font-weight: 700; font-size: 14px; margin-bottom: 4px; }
  .transcript { padding: 10px 12px; }
  .bubble { margin: 0 0 8px; padding: 8px 10px; border-radius: 6px; max-width: 100%; }
  .bubble.student { background: #eef2f7; border: 1px solid #d8e1ec; }
  .bubble.patient { background: #f3efe9; border: 1px solid #e4dccd; }
  .bubble-head { font-size: 12px; color: #555; margin-bottom: 2px; }
  .bubble .time { color: #8a8a8a; }
  .bubble .speaker { font-weight: 700; color: #333; }
  .bubble-body { font-size: 14px; color: #1f1f1f; white-space: pre-wrap; }
  .muted { color: #8a8a8a; font-size: 13px; font-style: italic; }
  .empty { padding: 8px 0; }
  @media print { body { padding: 0; } .attempt, .summary-card, .task { break-inside: avoid; } }
`;

export function renderReviewPackageHtml(pkg: ReviewPackage): string {
  const body =
    pkg.modules.length > 0
      ? pkg.modules.map(moduleSection).join("\n")
      : `<div class="muted empty">No modules with completed attempts found for this student.</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>VOICE Student Review Package</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <header class="doc">
    <h1>VOICE Student Review Package</h1>
    <div class="student">Student: ${esc(pkg.studentEmail)}</div>
    <div class="disclaimer">Grading-oriented review. Quantitative metrics describe interaction length / verbal participation only and are not clinical quality scores.</div>
  </header>
  ${body}
</div>
</body>
</html>`;
}
