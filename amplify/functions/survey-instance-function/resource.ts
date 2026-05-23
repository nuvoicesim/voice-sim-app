import { defineFunction } from "@aws-amplify/backend";

export const surveyInstanceFunction = defineFunction({
  name: "survey-instance-api",
  runtime: 20,
  timeoutSeconds: 30,
});
