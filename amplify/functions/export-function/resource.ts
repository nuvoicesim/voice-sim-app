import { defineFunction } from "@aws-amplify/backend";

/**
 * Faculty "Review Package" export (one student, HTML).
 *
 * Read-only, course-scoped. Gathers one student's completed sessions across a
 * course's assignments and renders a grading-oriented HTML review package.
 * Lives on its own ExportAPI RestApi/stack (see amplify/backend.ts) because the
 * legacy NurseTownAPI stack is at the 500-resource CFN limit.
 */
export const exportFunction = defineFunction({
  name: "review-package-export",
  runtime: 20,
  // HTML generation + a handful of one-student scans/queries; 30s is ample.
  timeoutSeconds: 30,
  memoryMB: 512,
});
