import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"], // transport entry is covered by integration tests spawning real processes
      reporter: ["text-summary", "text", "lcov"],
      thresholds: {
        lines: 80,
      },
    },
  },
});
