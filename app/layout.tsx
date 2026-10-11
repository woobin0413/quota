import type { Metadata, Viewport } from "next";
import { Inter, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  // Absolute base for OG/twitter image URLs (crawlers reject relative)
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ),
  title: "Quota - Professional Quotes for Contractors",
  description:
    "Build professional quotes from your own work catalog and send them to clients in minutes",
};

// Light-only app: pin the color scheme so native controls (selects,
// scrollbars) don't render dark on OS dark mode, and match the tab/theme
// color to the cream page background.
export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f9f8f6",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        className={`${inter.variable} ${barlowCondensed.variable} ${plexMono.variable} font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
