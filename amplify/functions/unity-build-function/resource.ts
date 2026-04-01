import { defineFunction } from "@aws-amplify/backend";

export const unityBuildFunction = defineFunction({
  name: "unity-build-api",
  timeoutSeconds: 120,
  memoryMB: 1024,
});
