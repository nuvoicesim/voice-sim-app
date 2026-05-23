import { defineFunction } from "@aws-amplify/backend";
 
export const simulationDataFunction = defineFunction({
  name: "simulation-data-api",
  runtime: 20,
});
