import { defineFunction } from "@aws-amplify/backend";

export const moduleFunction = defineFunction({
  name: "module-api",
  runtime: 20,
  timeoutSeconds: 30,
});
