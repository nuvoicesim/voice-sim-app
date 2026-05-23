import { defineFunction } from "@aws-amplify/backend";
 
export const postSurveyFunction = defineFunction({
  name: "post-survey-api",
  runtime: 20,
});
