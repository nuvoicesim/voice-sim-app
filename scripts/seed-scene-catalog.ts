/**
 * Seed script for SceneCatalog table.
 * Maps the existing task1/task2/task3 simulation levels to scene records.
 *
 * Usage (after deployment):
 *   npx tsx scripts/seed-scene-catalog.ts
 *
 * Requires AWS credentials with DynamoDB write access and
 * the TABLE_NAME environment variable pointing to the SceneCatalog table.
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME || process.env.SCENE_CATALOG_TABLE_NAME;

if (!TABLE_NAME) {
  console.error("Error: set TABLE_NAME or SCENE_CATALOG_TABLE_NAME env var to the SceneCatalog DynamoDB table name.");
  process.exit(1);
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const SCENES = [
  {
    sceneId: "scene-task1",
    scenarioKey: "task1",
    title: "Mrs. Karen Harris - Mild Broca's Aphasia",
    description: "45-year-old woman, 3 months post left-sided stroke. Mild Broca's aphasia with non-fluent, effortful, telegraphic speech.",
    difficulty: "beginner",
    tags: ["aphasia", "broca", "mild", "stroke"],
    unityBuildFolder: "broca-aphasia-webgl",
    isActive: true,
  },
  {
    sceneId: "scene-task2",
    scenarioKey: "task2",
    title: "Moderate Aphasia Simulation",
    description: "Moderate aphasia simulation scenario for intermediate-level practice.",
    difficulty: "intermediate",
    tags: ["aphasia", "moderate"],
    unityBuildFolder: "broca-aphasia-webgl",
    isActive: true,
  },
  {
    sceneId: "scene-task3",
    scenarioKey: "task3",
    title: "Severe Aphasia Simulation",
    description: "Severe aphasia simulation scenario for advanced-level practice.",
    difficulty: "advanced",
    tags: ["aphasia", "severe"],
    unityBuildFolder: "broca-aphasia-webgl",
    isActive: true,
  },
];

async function seed() {
  const now = new Date().toISOString();

  for (const scene of SCENES) {
    const item = { ...scene, createdAt: now, updatedAt: now };

    await client.send(new PutCommand({ TableName: TABLE_NAME, Item: item }));
    console.log(`Seeded: ${scene.sceneId} (${scene.scenarioKey}) - ${scene.title}`);
  }

  console.log("\nSceneCatalog seed complete.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
