import { defineFunction } from "@aws-amplify/backend";

export const patientProfileFunction = defineFunction({
  name: "patient-profile-api",
  runtime: 20,
});
