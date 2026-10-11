import { defineConfig, devices } from "@playwright/test";
import fs from "fs";
import path from "path";

// Load .env.local so test code can read E2E_* credentials.
// (next dev loads it for the app on its own.)
const envPath = path.join(__dirname, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2];
    }
  }
}

// Hosted runners are several times slower than a dev machine, which turns
// every implicit timing assumption in the suite into a coin flip. Give CI more
// headroom and let it retry, so a load-induced blip is reported as `flaky`
// rather than as a failure indistinguishable from a real defect.
const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  timeout: isCI ? 90_000 : 60_000,
  fullyParallel: false, // shared dev DB — keep runs deterministic
  workers: 1,
  retries: isCI ? 2 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "setup",
      testMatch: /global\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/user.json",
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // CI runs the real production build. `next dev` compiles each route on
    // first request, so the first assertion against any page races the
    // compiler — the single biggest source of CI-only flakiness here — and it
    // exercises a bundle no user ever sees (StrictMode double-invoke, no
    // minification, dev-only warnings). The build runs as its own CI step;
    // locally `next dev` stays, for the fast edit loop.
    command: isCI ? "npm run start" : "npm run dev",
    url: "http://localhost:3000",
    // Never reuse a running dev server: its env is uncontrolled, and e2e
    // must only run against a server Playwright started with RESEND_MOCK=1
    // (no real email, test-data gate relaxed). If port 3000 is busy,
    // Playwright fails fast — stop the dev server and rerun.
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      ...process.env,
      RESEND_MOCK: "1",
      ALLOW_DEV_TIER_SWITCH: "1",
      QUOTA_LOCAL_E2E: "1",
    } as Record<string, string>,
  },
});
