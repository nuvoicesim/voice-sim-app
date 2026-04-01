import { defineFunction } from "@aws-amplify/backend";
 
export const authFunction = defineFunction({
  name: "auth-api",
  runtime: 20,
});
