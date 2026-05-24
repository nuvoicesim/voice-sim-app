/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "amplify/functions/**/*.test.ts",
      "__tests__/**/*.test.ts",
    ],
    exclude: ["node_modules", "amplify/node_modules", "dist", ".amplify"],
  },
});
