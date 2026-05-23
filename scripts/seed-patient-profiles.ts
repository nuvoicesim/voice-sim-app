/**
 * Seed script for PatientProfile table.
 *
 * Usage:
 *   npx tsx scripts/seed-patient-profiles.ts
 *
 * Requires AWS credentials with DynamoDB write access and
 * the TABLE_NAME environment variable pointing to the PatientProfile table.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { DIALOGUE_PROMPTS } from "./runtime-config-defaults/dialogue-prompts";
import { SCORING_PROMPTS } from "./runtime-config-defaults/scoring-prompts";

const TABLE_NAME = process.env.TABLE_NAME || process.env.PATIENT_PROFILE_TABLE_NAME;

if (!TABLE_NAME) {
  console.error("Error: set TABLE_NAME or PATIENT_PROFILE_TABLE_NAME env var to the PatientProfile DynamoDB table name.");
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const PATIENT_PROFILES = [
  {
    patientProfileId: "patient-karen-harris-v1",
    displayName: "Karen Harris",
    profileKey: "karen-harris-broca-mild-v1",
    status: "published",
    dialogueConfig: {
      version: "task1-dialogue-v1",
      systemPrompt: DIALOGUE_PROMPTS.task1,
      model: "gpt-4o",
      temperature: 0.7,
      maxOutputTokens: 220,
    },
    scoringConfig: {
      version: "task1-scoring-v1",
      systemPrompt: SCORING_PROMPTS.task1,
      model: "gpt-4o",
      temperature: 0.8,
      maxOutputTokens: 3000,
    },
    ttsConfig: {
      profileId: "voice-karen-harris-v1",
      version: "task1-tts-v1",
      voiceId: "QXFI3J7JB0fOlMwKDUxE",
      modelId: "eleven_multilingual_v2",
      stability: 0.4,
      similarityBoost: 0.75,
      styleExaggeration: 0.3,
      speed: 1.0,
    },
  },
  {
    patientProfileId: "patient-maria-alvarez-v1",
    displayName: "Maria Alvarez",
    profileKey: "maria-alvarez-aphasia-moderate-v1",
    status: "published",
    dialogueConfig: {
      version: "task2-dialogue-v1",
      systemPrompt: DIALOGUE_PROMPTS.task2,
      model: "gpt-4o",
      temperature: 0.7,
      maxOutputTokens: 220,
    },
    scoringConfig: {
      version: "task2-scoring-v1",
      systemPrompt: SCORING_PROMPTS.task2,
      model: "gpt-4o",
      temperature: 0.8,
      maxOutputTokens: 3000,
    },
    ttsConfig: {
      profileId: "voice-maria-alvarez-v1",
      version: "task2-tts-v1",
      voiceId: "KjIBD4QnlzAqKHmoYfdZ",
      modelId: "eleven_multilingual_v2",
      stability: 0.4,
      similarityBoost: 0.75,
      styleExaggeration: 0.3,
      speed: 1.0,
    },
  },
  {
    patientProfileId: "patient-james-turner-v1",
    displayName: "James Turner",
    profileKey: "james-turner-aphasia-severe-v1",
    status: "published",
    dialogueConfig: {
      version: "task3-dialogue-v1",
      systemPrompt: DIALOGUE_PROMPTS.task3,
      model: "gpt-4o",
      temperature: 0.7,
      maxOutputTokens: 220,
    },
    scoringConfig: {
      version: "task3-scoring-v1",
      systemPrompt: SCORING_PROMPTS.task3,
      model: "gpt-4o",
      temperature: 0.8,
      maxOutputTokens: 3000,
    },
    ttsConfig: {
      profileId: "voice-james-turner-v1",
      version: "task3-tts-v1",
      voiceId: "nlPFgtYJ0K18Hij3YdiX",
      modelId: "eleven_multilingual_v2",
      stability: 0.4,
      similarityBoost: 0.75,
      styleExaggeration: 0.3,
      speed: 1.0,
    },
  },
] as const;

async function seed() {
  const now = new Date().toISOString();

  for (const profile of PATIENT_PROFILES) {
    const item = { ...profile, createdAt: now, updatedAt: now };
    await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    console.log(`Seeded patient profile: ${profile.patientProfileId} (${profile.displayName})`);
  }

  console.log("\nPatientProfile seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
