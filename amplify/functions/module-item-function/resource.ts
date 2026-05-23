import { defineFunction } from "@aws-amplify/backend";

export const moduleItemFunction = defineFunction({
  name: "module-item-api",
  runtime: 20,
  timeoutSeconds: 30,
});
