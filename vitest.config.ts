import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  // tsconfig sets jsx:"preserve" (Next handles JSX at build time). The React
  // plugin gives Vitest a proper JSX transform so test modules that
  // transitively import .tsx files (e.g. API routes → PDF components) parse.
  plugins: [react()],
  resolve: {
    // Mirror tsconfig's "@/*" → "./*" path mapping.
    alias: { "@": path.resolve(__dirname, ".") },
  },
  test: {
    // Seed placeholder env before any test module imports (see setup file).
    setupFiles: ["./vitest.setup.ts"],
    // e2e/*.spec.ts are Playwright specs — they must not run under vitest.
    exclude: [...configDefaults.exclude, "e2e/**"],
    coverage: {
      // Report-only: surfaces which new code landed untested without failing
      // a build on an arbitrary percentage. Run with `npm run test:coverage`.
      provider: "v8",
      reporter: ["text-summary", "html"],
      reportsDirectory: "coverage",
      // Only the layers unit tests can meaningfully reach. Components and
      // pages are covered by Playwright, and counting them here would make
      // the number meaningless.
      include: ["lib/**/*.ts", "app/api/**/*.ts"],
      exclude: ["lib/**/__tests__/**", "**/*.d.ts"],
    },
  },
});
