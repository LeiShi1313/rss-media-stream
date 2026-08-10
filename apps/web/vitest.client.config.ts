import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost/"
      }
    },
    clearMocks: true,
    include: ["tests/client/**/*.test.tsx"],
    setupFiles: ["./tests/client/setup.ts"],
    unstubEnvs: true,
    unstubGlobals: true
  }
});
