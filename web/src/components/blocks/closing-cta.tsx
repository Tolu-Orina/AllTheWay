import { Link } from "@/components/primitives/app-link";
import { ArrowRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Reveal } from "@/components/primitives/reveal";

export function ClosingCta() {
  return (
    <section className="relative isolate overflow-hidden border-b bg-accent py-20 sm:py-24">
      <div className="mx-auto w-full max-w-[1280px] px-4 text-center sm:px-6 lg:px-8">
        <Reveal className="mx-auto max-w-[38rem]">
          <h2 className="text-[32px] leading-tight font-semibold tracking-[-0.015em] text-foreground sm:text-[40px]">
            Start with one conversation
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-foreground/70">
            No setup wizard and no preferences form. Talk to it once, correct it
            once, and it starts building the profile that makes the next time
            better.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button render={<Link href="/signup" />} variant="brand" size="xl">
              Start free
              <ArrowRight />
            </Button>
            <Button
              render={<Link href="/contact" />}
              variant="outline"
              size="xl"
              className="bg-card"
            >
              Talk to us
            </Button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
