import { defineFunction } from "@aws-amplify/backend";

export const llmDialogueFunction = defineFunction({
  name: "llm-dialogue-api",
  runtime: 20,
  timeoutSeconds: 15,
});

