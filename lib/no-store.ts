/**
 * Cache headers for authenticated responses.
 *
 * next.config.js sets the site-wide security headers, but it cannot tell an
 * authenticated route from the public landing page — and the landing page, /og
 * and /logo must stay cacheable. So this is applied from middleware, which
 * already classifies public vs protected.
 *
 * Without it, signing out leaves the dashboard renderable from browser history
 * cache: the Back button shows a signed-out user their own client list.
 */

const NO_STORE = "no-store, no-cache, must-revalidate, max-age=0";

/** Mark a response non-storable. Returns the same instance for inline use. */
export function applyNoStore<T extends Response>(res: T): T {
  res.headers.set("Cache-Control", NO_STORE);
  // Pragma is redundant for modern browsers but costs nothing and covers
  // intermediaries that only understand HTTP/1.0.
  res.headers.set("Pragma", "no-cache");
  return res;
}

/**
 * Evict this origin's cached pages at sign-out.
 *
 * `no-store` alone is no longer enough. Chrome shipped bfcache for
 * `Cache-Control: no-store` pages in March–April 2025, so an authenticated page
 * can be restored by the Back button even though it was never written to the
 * HTTP cache — Chrome relies on observing a cookie change to evict it instead.
 * That is exactly the "Back button shows the dashboard after logout" report.
 * https://developer.chrome.com/docs/web-platform/bfcache-ccns
 *
 * `Clear-Site-Data` states the intent explicitly rather than depending on the
 * browser inferring it. Applied only to the logout response.
 *
 * `storage` is deliberately omitted: it would wipe localStorage wholesale,
 * including the landing language preference, which is not session data.
 * Header.handleSignOut already clears the per-device flags that *are* session
 * scoped.
 *
 * Requires a secure context. localhost qualifies, so this also holds in dev
 * and e2e; plain-HTTP deployments would silently ignore it.
 */
export function applyClearSiteData<T extends Response>(res: T): T {
  res.headers.set("Clear-Site-Data", '"cache", "cookies"');
  return res;
}
