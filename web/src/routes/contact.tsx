import { useEffect } from "react";

import { SiteHeader } from "@/components/blocks/site-header";
import { SiteFooter } from "@/components/blocks/site-footer";
import { Button } from "@/components/ui/button";
import { Link } from "@/components/primitives/app-link";

const MAILTO = "mailto:alltheway@rinegansolutions.com";

/**
 * Team and Enterprise are a conversation, not a Stripe price.
 *
 * `/contact` is what the pricing card, footer, and closing CTA already pointed
 * at. Leaving it unwired made "Talk to us" a 404.
 */
export default function ContactPage() {
  useEffect(() => {
    document.title = "Contact · AllTheWay";
  }, []);

  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <section className="mx-auto w-full max-w-[42rem] px-4 py-20 sm:px-6 sm:py-32 lg:px-8">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-blue-deep uppercase dark:text-blue-bright">
            Contact
          </p>
          <h1 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.015em] sm:text-[40px]">
            Team and Enterprise
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
            Plus and Max are self-serve. Sharing, live meeting checks, seats,
            and org policy are a conversation — there is no Team checkout.
          </p>
          <Button
            render={<Link href={MAILTO} />}
            variant="brand"
            size="xl"
            className="mt-8"
          >
            Talk to us
          </Button>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
