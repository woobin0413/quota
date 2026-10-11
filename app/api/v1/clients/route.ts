/** Frozen v1 path. See docs/api/v1.md — additive changes only. */
export { GET } from "@/app/api/clients/route";

// The base route sets this; route segment config is not inherited through a
// re-export, so it has to be restated here or the response gets cached.
export const dynamic = "force-dynamic";
