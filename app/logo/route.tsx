/**
 * Brand mark for Auth0 Universal Login (`branding.logo_url`).
 *
 * Auth0 needs a publicly reachable raster URL, and the repo has no logo asset —
 * so this renders one from the same `next/og` pipeline as /og rather than
 * introducing a binary to keep in sync with the palette.
 *
 * Sized 480×120: Universal Login scales the logo to a fixed height and keeps
 * the aspect ratio, so a wordmark reads better than a square icon. The
 * background is transparent to sit on Auth0's page background.
 *
 * Palette mirrors the landing tokens in app/globals.css:
 *   --primary  216 41% 18%  → #1B2A41
 *   --accent    40 82% 52%  → #E9A620
 */

import { ImageResponse } from "next/og";

export const runtime = "edge";

export async function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          background: "transparent",
          fontFamily: "sans-serif",
        }}
      >
        {/* Accent block standing in for the document mark in the site header */}
        <div
          style={{
            display: "flex",
            width: 56,
            height: 56,
            borderRadius: 10,
            background: "#E9A620",
          }}
        />
        <div
          style={{
            display: "flex",
            fontSize: 54,
            fontWeight: 700,
            letterSpacing: 6,
            color: "#1B2A41",
            textTransform: "uppercase",
          }}
        >
          Quota
        </div>
      </div>
    ),
    { width: 480, height: 120 }
  );
}
