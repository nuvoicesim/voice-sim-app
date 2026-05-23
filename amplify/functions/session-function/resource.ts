import { defineFunction } from "@aws-amplify/backend";

export const sessionFunction = defineFunction({
  name: "session-api",
  runtime: 20,
});
