/**
 * Dynamic OG image (1200×630) for social/SMS link previews.
 * Pure inline styles per ImageResponse constraints; palette mirrors
 * the landing tokens (navy primary, amber accent, paper card).
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
          background: "#1c2b45",
          color: "#f7f5ef",
          padding: 64,
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", maxWidth: 620 }}>
          <div
            style={{
              display: "flex",
              fontSize: 34,
              fontWeight: 700,
              letterSpacing: 4,
              color: "#e8a33d",
              textTransform: "uppercase",
            }}
          >
            Quota
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.05,
              textTransform: "uppercase",
              marginTop: 24,
            }}
          >
            <span>Price the job.</span>
            <span>Send the bill.</span>
            <span style={{ color: "#e8a33d" }}>Get paid.</span>
          </div>
          <div style={{ display: "flex", fontSize: 28, color: "#c9c4b8", marginTop: 28 }}>
            Quoting &amp; invoicing for contractors — no card fees, ever.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            width: 360,
            background: "#fdfcf8",
            color: "#1c2b45",
            borderRadius: 8,
            padding: 28,
            position: "relative",
            boxShadow: "10px 10px 0 rgba(0,0,0,0.25)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 20, fontWeight: 700, borderBottom: "3px solid #1c2b45", paddingBottom: 12 }}>
            <span>Q-2026-014</span>
            <span>QUOTE</span>
          </div>
          {[
            ["Panel upgrade (200A)", "$2,500"],
            ["Electrician labor", "$600"],
            ["Outlet installation", "$600"],
          ].map(([d, a]) => (
            <div key={d} style={{ display: "flex", justifyContent: "space-between", fontSize: 18, padding: "10px 0", borderBottom: "1px dashed #d5d0c4" }}>
              <span>{d}</span>
              <span>{a}</span>
            </div>
          ))}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, fontWeight: 800, paddingTop: 14 }}>
            <span>TOTAL</span>
            <span>$3,700</span>
          </div>
          <div
            style={{
              display: "flex",
              position: "absolute",
              top: -18,
              right: -14,
              transform: "rotate(-4deg)",
              border: "4px solid #2e7d4f",
              color: "#2e7d4f",
              fontSize: 26,
              fontWeight: 800,
              padding: "4px 14px",
              letterSpacing: 3,
              background: "rgba(253,252,248,0.9)",
            }}
          >
            PAID
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
