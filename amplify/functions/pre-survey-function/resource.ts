import { defineFunction } from "@aws-amplify/backend";
 
export const preSurveyFunction = defineFunction({
  name: "pre-survey-api",
  runtime: 20,
});
