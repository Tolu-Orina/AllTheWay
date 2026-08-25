import { SiteHeader } from "@/components/blocks/site-header";
import { Hero } from "@/components/blocks/hero";
import { Foundations } from "@/components/blocks/foundations";
import { Pillars } from "@/components/blocks/pillars";
import { InPractice } from "@/components/blocks/in-practice";
import { Trust } from "@/components/blocks/trust";
import { Pricing } from "@/components/blocks/pricing";
import { ClosingCta } from "@/components/blocks/closing-cta";
import { SiteFooter } from "@/components/blocks/site-footer";

export default function LandingPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <Hero />
        <Foundations />
        <Pillars />
        <InPractice />
        <Trust />
        <Pricing />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
