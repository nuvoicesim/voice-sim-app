import { defineFunction } from "@aws-amplify/backend";
 
export const cognitoUserFunction = defineFunction({
  name: "cognito-user-api",
  runtime: 20,
});
