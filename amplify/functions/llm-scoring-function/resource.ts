import { defineFunction } from "@aws-amplify/backend";

export const llmScoringFunction = defineFunction({
  name: "llm-scoring-api",
  runtime: 20,
  timeoutSeconds: 30,
});

