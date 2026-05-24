import { defineFunction } from "@aws-amplify/backend";

export const moduleAssetFunction = defineFunction({
  name: "module-asset-api",
  runtime: 20,
  timeoutSeconds: 10,
});
