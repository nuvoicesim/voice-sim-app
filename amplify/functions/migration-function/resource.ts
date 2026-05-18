import { defineFunction } from "@aws-amplify/backend";

export const migrationFunction = defineFunction({
  name: "migration-api",
  runtime: 20,
  // Migration scans entire tables; allow longer timeout.
  timeoutSeconds: 300,
  memoryMB: 1024,
});
