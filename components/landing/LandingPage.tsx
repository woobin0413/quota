"use client";

import { LanguageProvider } from "@/components/landing/LanguageProvider";
import {
  Faq, Features, Hero, LandingFooter, LandingHeader,
  Pricing, SocialProof, VoiceTeaser,
} from "@/components/landing/sections";

export function LandingPage() {
  return (
    <LanguageProvider>
      <main className="min-h-screen bg-background">
        <LandingHeader />
        <Hero />
        <VoiceTeaser />
        <Features />
        <Pricing />
        <SocialProof />
        <Faq />
        <LandingFooter />
      </main>
    </LanguageProvider>
  );
}
