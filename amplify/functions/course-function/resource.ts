import { defineFunction } from "@aws-amplify/backend";

export const courseFunction = defineFunction({
  name: "course-api",
  runtime: 20,
  timeoutSeconds: 30,
});
