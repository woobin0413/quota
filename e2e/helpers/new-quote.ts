import { expect, type Page } from "@playwright/test";

/**
 * Open the quote builder with the new-client form showing.
 *
 * NewQuoteForm fetches /api/clients after mount and, when any exist, flips the
 * client section from "new" to "existing" — which unmounts `client-name-input`.
 * The component guards a real user against that (`clientTouched`), but only
 * once they have clicked a mode button or typed something.
 *
 * Specs used to probe the mode button with a bare `isVisible()`, which does not
 * wait. On a fast machine the list had always arrived by then. On a CI runner
 * it had not: the check read the pre-load DOM, skipped the click, and the fill
 * that followed raced the arriving client list — which flipped the mode and
 * pulled the input out from under it. That surfaced as a 90s timeout on
 * `client-name-input` in four different specs.
 *
 * Waiting for the response first makes the mode deterministic.
 */
export async function openNewQuoteForNewClient(page: Page): Promise<void> {
  const clientsLoaded = page
    .waitForResponse(
      (res) =>
        res.url().includes("/api/clients") && res.request().method() === "GET",
      { timeout: 30_000 }
    )
    // Don't fail the caller if the request never happens — the assertion below
    // is what actually guarantees the form is usable.
    .catch(() => undefined);

  await page.goto("/new-quote");
  await expect(page.getByTestId("quote-builder")).toBeVisible({ timeout: 15_000 });
  await clientsLoaded;

  // Only rendered once at least one client exists; a fresh database has none
  // and the form already starts in new-client mode.
  const newClientButton = page.getByTestId("client-mode-new");
  if (await newClientButton.isVisible().catch(() => false)) {
    await newClientButton.click();
  }

  await expect(page.getByTestId("client-name-input")).toBeVisible({
    timeout: 15_000,
  });
}
