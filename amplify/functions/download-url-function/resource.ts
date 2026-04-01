import { defineFunction } from "@aws-amplify/backend";
 
export const downloadUrlFunction = defineFunction({
  name: "download-url-api",
  runtime: 20,
});
