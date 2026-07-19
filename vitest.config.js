import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Separate from vite.config.js on purpose: this file is test-only and is
// never loaded by `vite dev`/`vite build`, so it cannot affect production
// behavior. It mirrors the plugins from vite.config.js so JSX/TS in test
// files transform the same way.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
    // Node's built-in experimental `localStorage` global (added in recent
    // Node versions) shadows jsdom's window.localStorage implementation and
    // throws ("localStorage.clear is not a function") unless disabled here.
    poolOptions: {
      threads: { execArgv: ["--no-experimental-webstorage"] },
      forks: { execArgv: ["--no-experimental-webstorage"] },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      // "all: true" reports every included file's coverage even if no test
      // ever imports it, so untested screens show up as 0% instead of being
      // silently omitted from the numbers.
      all: true,
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/test/**",
        "src/**/*.d.ts",
        "src/main.tsx", // ReactDOM bootstrap only, no business logic
        "src/firebase.ts", // Firebase SDK init/config only, no business logic
        "dist/**",
        "node_modules/**",
        "**/*.config.{js,ts}",
      ],
    },
  },
});
