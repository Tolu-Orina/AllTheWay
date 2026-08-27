import { Link } from "@/components/primitives/app-link";
import { ArrowRight, Play } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Ambient } from "@/components/blocks/ambient";
import { ProductPanel } from "@/components/blocks/product-panel";
import { Walkways } from "@/components/blocks/walkways";

export function Hero() {
  const reduced = useReducedMotion();

  // One orchestrated page-load beat: copy, then CTA, then the product panel.
  const rise = (delay: number) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <section className="relative isolate overflow-hidden border-b">
      <Ambient />
      <Walkways className="pointer-events-none absolute inset-0 -z-10 hidden h-full w-full lg:block" />

      <div className="grid w-full items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-16 lg:px-8 lg:py-32">
        {/* ---- the argument ---- */}
        <div className="max-w-[36rem]">
          <motion.h1
            {...rise(0)}
            className="text-[40px] leading-[1.06] font-bold tracking-[-0.022em] sm:text-[52px] lg:text-[60px]"
          >
            Finally, an agent that goes{" "}
            <span className="bg-[linear-gradient(110deg,var(--grad-1)_0%,var(--grad-2)_45%,var(--grad-3)_100%)] bg-clip-text text-transparent">
              all the way
            </span>{" "}
            with you
          </motion.h1>

          <motion.p
            {...rise(0.08)}
            className="mt-6 text-[18px] leading-relaxed text-muted-foreground sm:text-[19px]"
          >
            Talk it through, bring the document, keep the meeting. It shows
            the plan before it acts — and you can see what it has learned.
          </motion.p>

          <motion.div
            {...rise(0.16)}
            className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center"
          >
            <Button
              render={<Link href="/signup" />}
              variant="brand"
              size="xl"
              className="w-full sm:w-auto"
            >
              Start free
              <ArrowRight />
            </Button>
            <Button
              render={<Link href="#voice" />}
              variant="outline"
              size="xl"
              className="w-full sm:w-auto"
            >
              <Play />
              See how it works
            </Button>
          </motion.div>

          <motion.p
            {...rise(0.24)}
            className="mt-5 text-[13px] text-muted-foreground"
          >
            Free plan, no card required. Nothing irreversible happens without
            your say-so.
          </motion.p>
        </div>

        {/* ---- the evidence ---- */}
        <motion.div
          initial={
            reduced ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.98 }
          }
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <ProductPanel />
        </motion.div>
      </div>
    </section>
  );
}
