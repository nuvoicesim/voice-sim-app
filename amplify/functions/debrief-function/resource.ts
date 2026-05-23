import { defineFunction } from "@aws-amplify/backend";
 
export const debriefFunction = defineFunction({
  name: "debrief-api",
  runtime: 20,
});
