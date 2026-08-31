import { motion, useReducedMotion } from "motion/react";

/**
 * Who the product is for — named as jobs a person would recognise, not as a
 * fabricated customer-logo wall.
 */
const PERSONAS = [
  "Founders",
  "Operators",
  "Lawyers",
  "Product managers",
  "Analysts",
  "Consultants",
  "Chiefs of staff",
  "Finance teams",
] as const;

const CYCLE = ["Built for", ...PERSONAS];
/** Two copies so the loop can jump without a visible seam. */
const STRIP = [...CYCLE, ...CYCLE];

export function Foundations() {
  const reduced = useReducedMotion();
  const spoken = `Built for ${PERSONAS.join(", ").toLowerCase()}.`;

  return (
    <section className="overflow-hidden border-b bg-muted/40 py-6" aria-label={spoken}>
      <p className="sr-only">{spoken}</p>
      {reduced ? (
        <ul className="mx-auto flex w-full max-w-[1280px] flex-wrap items-center justify-center gap-x-8 gap-y-2 px-4 sm:px-6 lg:px-8">
          {CYCLE.map((name) => (
            <li
              key={name}
              className="text-[15px] font-black tracking-[0.06em] text-foreground uppercase"
            >
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <div aria-hidden="true" className="flex">
          <motion.div
            className="flex w-max items-center gap-12 pr-12 sm:gap-16 sm:pr-16"
            animate={{ x: ["-50%", "0%"] }}
            transition={{ duration: 48, ease: "linear", repeat: Infinity }}
          >
            {STRIP.map((name, i) => (
              <span
                key={`${name}-${i}`}
                className="shrink-0 text-[18px] font-black tracking-[0.08em] text-foreground uppercase sm:text-[22px]"
              >
                {name}
              </span>
            ))}
          </motion.div>
        </div>
      )}
    </section>
  );
}
