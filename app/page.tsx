import type { Metadata } from "next";
import { LandingPage } from "@/components/landing/LandingPage";

export const metadata: Metadata = {
  title: "Quota — Quoting & invoicing for contractors",
  description:
    "Keep your own price book, quote in minutes, email invoices with PDFs, and track payments without giving up a cut. No card fees, ever.",
  openGraph: {
    title: "Quota — Quoting & invoicing for contractors",
    description:
      "Price the job. Send the bill. Get paid. No card fees, ever.",
    type: "website",
    images: [
      {
        url: "/og",
        width: 1200,
        height: 630,
        alt: "Quota — Price the job. Send the bill. Get paid. Invoice card stamped PAID.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Quota — Quoting & invoicing for contractors",
    description: "Price the job. Send the bill. Get paid. No card fees, ever.",
    images: ["/og"],
  },
};

export default function Home() {
  return <LandingPage />;
}
