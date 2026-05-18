// VOICE Phase 1 rubric configuration.
//
// These rubric prompts are intentionally NOT stored on PatientProfile.scoringConfig.
// The May 18 faculty decision treats Phase 1 rubric as patient-independent — the
// scoring logic is shared across all patients and varies only by section. Storing
// the prompts in code makes the prompt version explicit (PROMPT_VERSION below),
// avoids requiring a DynamoDB seed of PatientProfile rows just to make rubric work,
// and keeps the Unity-facing contract in lockstep with the code that produces it.
//
// VOICE-specific adaptations to honor:
//   - Section A (Object Naming) uses ONLY Semantic / Phonemic / Model cues.
//     Tactile cueing is NOT part of VOICE Phase 1 and must not appear in the
//     rubric prompt or the response schema.
//   - Section A score 2 is for a recognizable phonemic paraphasia with NO cue,
//     not for self-correction/repetition.
//   - Section B (Word Fluency) excludes examiner-provided examples (horse, tiger)
//     from the valid-unique count.

export const PROMPT_VERSION = "phase1-rubric-2026-05-18";

export type Phase1SectionId = "A" | "B" | "C" | "D";
export type Phase1TaskType =
  | "object_naming"
  | "word_fluency"
  | "sentence_completion"
  | "responsive_speech";
export type AssessmentGranularity = "item_level" | "task_level";

export interface Phase1RubricSectionConfig {
  sectionId: Phase1SectionId;
  taskType: Phase1TaskType;
  granularity: AssessmentGranularity;
  scoreMin: number;
  scoreMax: number;
  // System prompt sent to the OpenAI scoring model. The student-evidence body is
  // appended as a separate user message at request time.
  systemPrompt: string;
  // OpenAI Structured Outputs schema — constrains the model to the exact rubric
  // response shape this branch returns to Unity.
  responseFormat: Record<string, unknown>;
  // OpenAI request tuning. Defaults are tight because rubric responses are short
  // structured JSON, not narrative coaching reports.
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

// ---------- Section A (Object Naming) ----------

const SECTION_A_SYSTEM_PROMPT = [
  "You are a rubric-based scoring assistant for the VOICE Phase 1 Section A Object Naming assessment for a Speech-Language Pathology student studying patients with aphasia.",
  "",
  "Per-item scoring rubric (each named picture is scored independently):",
  "  3 = Patient names the pictured object correctly, or with only a minor articulatory error, AND no cue was needed.",
  "  2 = The object name is still recognizable but contains a phonemic paraphasia, AND no cue was needed. This is NOT self-correction or repetition.",
  "  1 = A Semantic, Phonemic, or Model cue was used before the patient produced a correct or recognizable target response.",
  "  0 = Incorrect, unreasonable, unrelated, or no response even after available cueing.",
  "",
  "VOICE adaptation rules you MUST follow:",
  "  - The only cue types in VOICE are Semantic, Phonemic, and Model. Tactile cueing does NOT exist in VOICE; never mention or score tactile cueing.",
  "  - If any of Semantic, Phonemic, or Model cue was used before the patient produced a correct or recognizable response, the expectedScore for that item is 1.",
  "  - cueUsed / cueLevel fields, when present on a request item, are authoritative evidence of whether a cue was used.",
  "  - Do NOT invent narrative coaching feedback. rubricReason must be a short, factual justification (1-2 sentences) for the expectedScore.",
  "  - You evaluate the patient's response against the target word, not against the student's selected score.",
  "",
  "Inputs you will receive in the user message:",
  "  - studyTaskContext.items[] — one entry per assessed picture. Each item carries: itemId, targetAnswer, alternateTarget (may be empty), studentSelectedScore (the student's manual rubric choice), patientFinalResponse (the LLM-generated patient utterance), cueUsed (optional), cueLevel (optional: Semantic / Phonemic / Model).",
  "",
  "For each item return:",
  "  itemId, studentSelectedScore (echo), expectedScore (your rubric judgment 0-3), scoreMatchesExpected (boolean), rubricReason (short justification), cueUsed (echo when supplied), cueType (echo when supplied).",
  "",
  "Return ONLY the JSON described by the response schema. Do not include markdown fences or commentary.",
].join("\n");

const SECTION_A_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  json_schema: {
    name: "phase1_section_a_rubric",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sectionId: { type: "string", enum: ["A"] },
        taskType: { type: "string", enum: ["object_naming"] },
        assessmentGranularity: { type: "string", enum: ["item_level"] },
        taskSummary: { type: "string" },
        itemFeedback: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string" },
              studentSelectedScore: { type: "integer", minimum: 0, maximum: 3 },
              expectedScore: { type: "integer", minimum: 0, maximum: 3 },
              scoreMatchesExpected: { type: "boolean" },
              rubricReason: { type: "string" },
              cueUsed: { type: "boolean" },
              cueType: { type: "string", enum: ["Semantic", "Phonemic", "Model", ""] },
            },
            required: [
              "itemId",
              "studentSelectedScore",
              "expectedScore",
              "scoreMatchesExpected",
              "rubricReason",
              "cueUsed",
              "cueType",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["sectionId", "taskType", "assessmentGranularity", "taskSummary", "itemFeedback"],
      additionalProperties: false,
    },
  },
};

// ---------- Section B (Word Fluency) ----------

const SECTION_B_SYSTEM_PROMPT = [
  "You are a rubric-based scoring assistant for the VOICE Phase 1 Section B Word Fluency assessment.",
  "",
  "Task: in one minute the patient names as many animals as possible.",
  "",
  "Scoring rules:",
  "  - 1 point per UNIQUE valid animal named by the patient.",
  "  - Do NOT count repeated animals.",
  "  - Do NOT count off-category words.",
  "  - If 'horse' or 'tiger' was given as an examiner example in the conversation, do NOT count that animal as a patient-generated valid unique response.",
  "  - Count recognizable phonemic paraphasias if the intended animal is still clear enough to be identified.",
  "  - The maximum scorable expectedScore is capped at 20.",
  "",
  "Inputs you will receive in the user message:",
  "  - studyTaskContext.items[0] — synthetic task-level container carrying studentSelectedScore (0-20, the student's manual count) and any transcript/notes available.",
  "  - conversationTurns[] — full transcript including patient utterances and examiner prompts. Use this to recover the patient's animal list and to detect 'horse'/'tiger' examiner mentions.",
  "",
  "Return a single task-level rubric assessment with:",
  "  taskId, studentSelectedScore (echo), expectedScore (your computed count, 0-20), scoreMatchesExpected (boolean), rubricReason (short justification, mention the discrepancy if any), and scoringDetail with validUniqueResponseCount, repeatedResponseCount, excludedExampleCount (horse/tiger when produced), offCategoryCount.",
  "",
  "Return ONLY the JSON described by the response schema. Do not include markdown fences or commentary.",
].join("\n");

const SECTION_B_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  json_schema: {
    name: "phase1_section_b_rubric",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sectionId: { type: "string", enum: ["B"] },
        taskType: { type: "string", enum: ["word_fluency"] },
        assessmentGranularity: { type: "string", enum: ["task_level"] },
        taskSummary: { type: "string" },
        taskFeedback: {
          type: "object",
          properties: {
            taskId: { type: "string" },
            studentSelectedScore: { type: "integer", minimum: 0, maximum: 20 },
            expectedScore: { type: "integer", minimum: 0, maximum: 20 },
            scoreMatchesExpected: { type: "boolean" },
            rubricReason: { type: "string" },
            scoringDetail: {
              type: "object",
              properties: {
                validUniqueResponseCount: { type: "integer", minimum: 0 },
                repeatedResponseCount: { type: "integer", minimum: 0 },
                excludedExampleCount: { type: "integer", minimum: 0 },
                offCategoryCount: { type: "integer", minimum: 0 },
              },
              required: [
                "validUniqueResponseCount",
                "repeatedResponseCount",
                "excludedExampleCount",
                "offCategoryCount",
              ],
              additionalProperties: false,
            },
          },
          required: [
            "taskId",
            "studentSelectedScore",
            "expectedScore",
            "scoreMatchesExpected",
            "rubricReason",
            "scoringDetail",
          ],
          additionalProperties: false,
        },
      },
      required: ["sectionId", "taskType", "assessmentGranularity", "taskSummary", "taskFeedback"],
      additionalProperties: false,
    },
  },
};

// ---------- Section C (Sentence Completion) ----------

const SECTION_C_SYSTEM_PROMPT = [
  "You are a rubric-based scoring assistant for the VOICE Phase 1 Section C Sentence Completion assessment.",
  "",
  "Per-item scoring rubric:",
  "  2 = Target response or a clinically reasonable alternative response is given.",
  "  1 = A phonemic paraphasia OR an off-target but semantically plausible alternative response is given.",
  "  0 = Unreasonable, unrelated, contradictory, or no response.",
  "",
  "Example interpretation guidance for 'Grass is ____' with target 'green':",
  "  'green' -> 2",
  "  'brown' -> 1 (off-target but semantically plausible color for grass)",
  "  'cold'  -> 0 (unreasonable/unrelated to the sentence frame)",
  "",
  "Inputs you will receive in the user message:",
  "  - studyTaskContext.items[] — one entry per item, with itemId, prompt sentence frame (targetAnswer / alternateTarget context), studentSelectedScore, patientFinalResponse.",
  "",
  "For each item return: itemId, studentSelectedScore (echo), expectedScore (0-2), scoreMatchesExpected (boolean), rubricReason (1-2 sentences).",
  "",
  "Return ONLY the JSON described by the response schema. Do not include markdown fences or commentary.",
].join("\n");

const SECTION_C_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  json_schema: {
    name: "phase1_section_c_rubric",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sectionId: { type: "string", enum: ["C"] },
        taskType: { type: "string", enum: ["sentence_completion"] },
        assessmentGranularity: { type: "string", enum: ["item_level"] },
        taskSummary: { type: "string" },
        itemFeedback: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string" },
              studentSelectedScore: { type: "integer", minimum: 0, maximum: 2 },
              expectedScore: { type: "integer", minimum: 0, maximum: 2 },
              scoreMatchesExpected: { type: "boolean" },
              rubricReason: { type: "string" },
            },
            required: [
              "itemId",
              "studentSelectedScore",
              "expectedScore",
              "scoreMatchesExpected",
              "rubricReason",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["sectionId", "taskType", "assessmentGranularity", "taskSummary", "itemFeedback"],
      additionalProperties: false,
    },
  },
};

// ---------- Section D (Responsive Speech) ----------

const SECTION_D_SYSTEM_PROMPT = [
  "You are a rubric-based scoring assistant for the VOICE Phase 1 Section D Responsive Speech assessment.",
  "",
  "Per-item scoring rubric:",
  "  2 = Target response or a reasonable alternative response is given.",
  "  1 = A phonemic paraphasia OR an off-target but semantically related/plausible alternative response.",
  "  0 = Unreasonable, unrelated, contradictory, or no response.",
  "",
  "Example interpretation guidance for 'Nurses work in a ____':",
  "  'hospital' -> 2",
  "  'clinic'   -> 2 (reasonable alternative)",
  "  'office'   -> 1 (off-target but semantically plausible workplace)",
  "  'store'    -> 0 (unreasonable/unrelated to nursing context)",
  "",
  "Inputs you will receive in the user message:",
  "  - studyTaskContext.items[] — one entry per item with itemId, prompt (targetAnswer / alternateTarget context), studentSelectedScore, patientFinalResponse.",
  "",
  "For each item return: itemId, studentSelectedScore (echo), expectedScore (0-2), scoreMatchesExpected (boolean), rubricReason (1-2 sentences).",
  "",
  "Return ONLY the JSON described by the response schema. Do not include markdown fences or commentary.",
].join("\n");

const SECTION_D_RESPONSE_FORMAT: Record<string, unknown> = {
  type: "json_schema",
  json_schema: {
    name: "phase1_section_d_rubric",
    strict: true,
    schema: {
      type: "object",
      properties: {
        sectionId: { type: "string", enum: ["D"] },
        taskType: { type: "string", enum: ["responsive_speech"] },
        assessmentGranularity: { type: "string", enum: ["item_level"] },
        taskSummary: { type: "string" },
        itemFeedback: {
          type: "array",
          items: {
            type: "object",
            properties: {
              itemId: { type: "string" },
              studentSelectedScore: { type: "integer", minimum: 0, maximum: 2 },
              expectedScore: { type: "integer", minimum: 0, maximum: 2 },
              scoreMatchesExpected: { type: "boolean" },
              rubricReason: { type: "string" },
            },
            required: [
              "itemId",
              "studentSelectedScore",
              "expectedScore",
              "scoreMatchesExpected",
              "rubricReason",
            ],
            additionalProperties: false,
          },
        },
      },
      required: ["sectionId", "taskType", "assessmentGranularity", "taskSummary", "itemFeedback"],
      additionalProperties: false,
    },
  },
};

const SECTION_CONFIGS: Record<Phase1SectionId, Phase1RubricSectionConfig> = {
  A: {
    sectionId: "A",
    taskType: "object_naming",
    granularity: "item_level",
    scoreMin: 0,
    scoreMax: 3,
    systemPrompt: SECTION_A_SYSTEM_PROMPT,
    responseFormat: SECTION_A_RESPONSE_FORMAT,
  },
  B: {
    sectionId: "B",
    taskType: "word_fluency",
    granularity: "task_level",
    scoreMin: 0,
    scoreMax: 20,
    systemPrompt: SECTION_B_SYSTEM_PROMPT,
    responseFormat: SECTION_B_RESPONSE_FORMAT,
  },
  C: {
    sectionId: "C",
    taskType: "sentence_completion",
    granularity: "item_level",
    scoreMin: 0,
    scoreMax: 2,
    systemPrompt: SECTION_C_SYSTEM_PROMPT,
    responseFormat: SECTION_C_RESPONSE_FORMAT,
  },
  D: {
    sectionId: "D",
    taskType: "responsive_speech",
    granularity: "item_level",
    scoreMin: 0,
    scoreMax: 2,
    systemPrompt: SECTION_D_SYSTEM_PROMPT,
    responseFormat: SECTION_D_RESPONSE_FORMAT,
  },
};

function asPhase1SectionId(value: unknown): Phase1SectionId | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toUpperCase();
  if (trimmed === "A" || trimmed === "B" || trimmed === "C" || trimmed === "D") {
    return trimmed;
  }
  return undefined;
}

function taskTypeForSection(sectionId: Phase1SectionId): Phase1TaskType {
  return SECTION_CONFIGS[sectionId].taskType;
}

// Resolve a per-section rubric config from the loosely-typed Unity taskContext.
// Accepts either sectionId ("A".."D") or taskType — if both are present they must
// agree, otherwise sectionId wins. Returns null when the section cannot be
// determined; caller decides how to respond (400 vs soft-fail).
export function resolvePhase1RubricConfig(
  sectionIdRaw: unknown,
  taskTypeRaw: unknown
): Phase1RubricSectionConfig | null {
  const sectionId = asPhase1SectionId(sectionIdRaw);
  if (sectionId) {
    return SECTION_CONFIGS[sectionId];
  }

  // Fall back: try taskType.
  if (typeof taskTypeRaw === "string") {
    const tt = taskTypeRaw.trim().toLowerCase();
    for (const cfg of Object.values(SECTION_CONFIGS)) {
      if (cfg.taskType === tt) return cfg;
    }
  }
  return null;
}

export function getPhase1RubricConfig(sectionId: Phase1SectionId): Phase1RubricSectionConfig {
  return SECTION_CONFIGS[sectionId];
}

export function isItemLevelSection(sectionId: Phase1SectionId): boolean {
  return SECTION_CONFIGS[sectionId].granularity === "item_level";
}

export { taskTypeForSection };
