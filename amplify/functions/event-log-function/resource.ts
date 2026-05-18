import { defineFunction } from "@aws-amplify/backend";

export const eventLogFunction = defineFunction({
  name: "event-log-api",
  runtime: 20,
  timeoutSeconds: 15,
});
