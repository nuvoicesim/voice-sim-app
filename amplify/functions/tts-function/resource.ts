import { defineFunction } from "@aws-amplify/backend";

export const ttsFunction = defineFunction({
  name: "tts-api",
  timeoutSeconds: 30,
});
