import { defineFunction } from "@aws-amplify/backend";

export const sceneCatalogFunction = defineFunction({
  name: "scene-catalog-api",
  runtime: 20,
});
