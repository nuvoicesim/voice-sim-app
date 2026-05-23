import { defineFunction } from "@aws-amplify/backend";

export const ttsFunction = defineFunction({
  name: "tts-api",
  runtime: 20,
  timeoutSeconds: 30,
});
