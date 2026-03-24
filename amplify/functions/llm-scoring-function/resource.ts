import { defineFunction } from "@aws-amplify/backend";

export const llmScoringFunction = defineFunction({
  name: "llm-scoring-api",
  timeoutSeconds: 30,
});

