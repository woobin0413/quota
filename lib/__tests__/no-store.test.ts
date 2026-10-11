/**
 * Authenticated responses must not be storable. Without this the browser keeps
 * dashboard HTML in history cache and the Back button re-renders a signed-out
 * user's client list. next.config.js has no cache headers, so middleware is the
 * only thing standing between sign-out and a stale render.
 */

import { describe, it, expect } from "vitest";
import { applyClearSiteData, applyNoStore } from "@/lib/no-store";

describe("applyNoStore", () => {
  it("marks the response non-storable", () => {
    const res = applyNoStore(new Response("ok"));

    expect(res.headers.get("cache-control")).toBe(
      "no-store, no-cache, must-revalidate, max-age=0"
    );
    expect(res.headers.get("pragma")).toBe("no-cache");
  });

  it("returns the same response instance so it can be used inline", () => {
    const res = new Response("ok");
    expect(applyNoStore(res)).toBe(res);
  });

  it("overwrites a permissive Cache-Control already on the response", () => {
    const res = new Response("ok", {
      headers: { "cache-control": "public, max-age=3600" },
    });

    expect(applyNoStore(res).headers.get("cache-control")).toContain("no-store");
  });
});

describe("applyClearSiteData", () => {
  it("evicts cache and cookies at sign-out", () => {
    // no-store stopped being sufficient when Chrome enabled bfcache for
    // no-store pages (March 2025): the dashboard could be restored by the Back
    // button after logout. This header is what states the eviction explicitly.
    const res = applyClearSiteData(new Response("ok"));
    expect(res.headers.get("clear-site-data")).toBe('"cache", "cookies"');
  });

  it("leaves storage alone so the landing language preference survives", () => {
    // Wiping storage wholesale would also drop non-session data. The
    // per-device session flags are cleared explicitly in Header.handleSignOut.
    expect(
      applyClearSiteData(new Response("ok")).headers.get("clear-site-data")
    ).not.toContain("storage");
  });

  it("composes with applyNoStore, which is how middleware uses it", () => {
    const res = applyClearSiteData(applyNoStore(new Response("ok")));
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("clear-site-data")).toContain("cookies");
  });
});
