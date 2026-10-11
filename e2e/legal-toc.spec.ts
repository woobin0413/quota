import { test, expect } from "@playwright/test";

/**
 * Legal page table-of-contents / anchor consistency.
 *
 * /privacy and /terms render a `TableOfContents` built from a `SECTIONS`
 * array, alongside `Clause` components whose `id="section-N"` is what the
 * ToC links point at (see app/(legal)/_components.tsx). Nothing type-checks
 * that the two lists agree — an editor can add/remove/reorder a `Clause`
 * without touching `SECTIONS`, or vice versa, and get a ToC entry that
 * either 404s to nowhere on the page or a clause nobody can jump to.
 *
 * The privacy page was hand-edited on this branch (payment disclosure,
 * named processors, retention wording); this is the check that a hand edit
 * did not silently break the ToC ↔ clause pairing. /refunds is intentionally
 * excluded — it uses `Clause` for two of its sections but renders no
 * `TableOfContents`, so there is nothing to reconcile there.
 */

const TOC_NAV = 'nav[aria-label="On this page"]';

test.describe("legal page table of contents (public)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ["/privacy", "/terms"] as const) {
    test(`${path}: every ToC entry links to a clause that exists, in order, with a matching title`, async ({
      page,
    }) => {
      await page.goto(path);

      const tocLinks = page.locator(`${TOC_NAV} a[href^="#section-"]`);
      const tocCount = await tocLinks.count();
      expect(tocCount, "table of contents must list at least one section").toBeGreaterThan(0);

      const clauseHeadings = page.locator('section[id^="section-"] > div > h2');
      const clauseCount = await clauseHeadings.count();

      expect(
        clauseCount,
        `${path}: ToC lists ${tocCount} section(s) but the page renders ${clauseCount} clause(s) — they must match 1:1`
      ).toBe(tocCount);

      for (let i = 0; i < tocCount; i++) {
        const href = await tocLinks.nth(i).getAttribute("href");
        expect(href).toMatch(/^#section-\d+$/);
        const sectionId = href!.slice(1);

        // The anchor target must exist on the page at all (a stale ToC
        // entry pointing at a renumbered or removed clause would fail here).
        const target = page.locator(`#${sectionId}`);
        await expect(
          target,
          `${path}: ToC entry "${href}" has no matching clause on the page`
        ).toHaveCount(1);

        // Order: the i-th ToC link's target must be the i-th rendered clause,
        // not merely present somewhere on the page.
        const heading = clauseHeadings.nth(i);
        const tocText = (await tocLinks.nth(i).textContent())?.trim();
        const clauseSectionId = await target.getAttribute("id");
        expect(
          clauseSectionId,
          `${path}: ToC position ${i} does not line up with clause position ${i}`
        ).toBe(sectionId);
        await expect(heading).toHaveText(tocText!);
      }
    });

    test(`${path}: clicking a ToC entry scrolls its clause into view`, async ({ page }) => {
      await page.goto(path);
      const lastLink = page.locator(`${TOC_NAV} a[href^="#section-"]`).last();
      const href = await lastLink.getAttribute("href");
      await lastLink.click();
      await expect(page).toHaveURL(new RegExp(`${href!.replace("#", "\\#")}$`));
      await expect(page.locator(href!)).toBeInViewport();
    });
  }

  test("terms cross-links to /privacy and /refunds resolve", async ({ page }) => {
    await page.goto("/terms");
    const privacyLink = page.getByRole("link", { name: "Privacy Policy" });
    const refundsLink = page.getByRole("link", { name: "Refund Policy" });
    await expect(privacyLink).toHaveAttribute("href", "/privacy");
    await expect(refundsLink).toHaveAttribute("href", "/refunds");

    const privacyRes = await page.request.get(
      (await privacyLink.getAttribute("href"))!
    );
    expect(privacyRes.status()).toBe(200);
    const refundsRes = await page.request.get(
      (await refundsLink.getAttribute("href"))!
    );
    expect(refundsRes.status()).toBe(200);
  });
});
