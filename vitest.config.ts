import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "tests/**/*.test.ts"],
    // Database tests share one database, so run files one at a time.
    fileParallelism: false,
  },
});
