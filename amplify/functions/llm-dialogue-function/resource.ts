import { defineFunction } from "@aws-amplify/backend";

export const llmDialogueFunction = defineFunction({
  name: "llm-dialogue-api",
  timeoutSeconds: 15,
});

