import { Link } from "@/components/primitives/app-link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Reveal,
  RevealGroup,
  RevealItem,
} from "@/components/primitives/reveal";
import { cn } from "@/lib/utils";
import table from "@/lib/plans.json";

type PlanRow = {
  tier: string;
  label: string;
  pricePence: number;
  limits: Record<string, number | null>;
};

const plans = table.plans as PlanRow[];
const free = plans.find((p) => p.tier === "free")!;
const plus = plans.find((p) => p.tier === "plus")!;
const max = plans.find((p) => p.tier === "max")!;

function gbp(pence: number): string {
  return `£${(pence / 100).toFixed(0)}`;
}

function count(limit: number | null, unit: string): string {
  if (limit === null) return `Unmetered ${unit}`;
  return `${limit.toLocaleString("en-GB")} ${unit}`;
}

type Card = {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
};

const TIERS: Card[] = [
  {
    name: free.label,
    price: gbp(free.pricePence),
    cadence: "forever",
    tagline: "Enough to find out whether it actually remembers you.",
    features: [
      count(free.limits.voice_minutes, "voice minutes"),
      count(free.limits.watcher_runs, "watcher runs"),
      count(free.limits.documents, "documents stored"),
      count(free.limits.connector_calls, "connector calls"),
    ],
    cta: "Start free",
    href: "/signup",
  },
  {
    name: plus.label,
    price: gbp(plus.pricePence),
    cadence: "per month",
    tagline: "For one person who wants voice, memory and their first Watchers.",
    features: [
      count(plus.limits.voice_minutes, "voice minutes"),
      count(plus.limits.watcher_runs, "watcher runs"),
      count(plus.limits.documents, "documents stored"),
      count(plus.limits.connector_calls, "connector calls"),
    ],
    cta: "Get Plus",
    href: "/signup",
    featured: true,
  },
  {
    name: max.label,
    price: gbp(max.pricePence),
    cadence: "per month",
    tagline: "Unmetered voice and Watchers, and room for a finished video.",
    features: [
      count(max.limits.voice_minutes, "voice minutes"),
      count(max.limits.watcher_runs, "watcher runs"),
      count(max.limits.documents, "documents stored"),
      `${max.limits.draft_video_seconds}s draft / ${max.limits.final_video_seconds}s final video`,
    ],
    cta: "Get Max",
    href: "/signup",
  },
  {
    name: "Team / Enterprise",
    price: "Talk to us",
    cadence: "custom",
    tagline: "Sharing, live meeting checks, and org policy — when you need more than one person.",
    features: [
      "Sharing is Team, not a checkout",
      "Live meeting checks",
      "Org policy for Watchers",
      "SSO and seats when you need them",
    ],
    cta: "Talk to us",
    href: "/contact",
  },
];

export function Pricing() {
  return (
    <section
      id="pricing"
      className="scroll-mt-20 border-b bg-background py-20 sm:py-32"
    >
      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-[42rem]">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-blue-deep uppercase dark:text-blue-bright">
            Pricing
          </p>
          <h2 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.015em] sm:text-[40px]">
            Pay for what it actually does
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
            Voice minutes, Watcher runs and stored documents are metered,
            because those are what actually cost something to keep. Plus and
            Max are billed in pounds. Team and Enterprise are a conversation.
            There is no trial — start free, upgrade when you need the room.
          </p>
        </Reveal>

        <RevealGroup className="mt-12 grid items-start gap-5 md:grid-cols-2 xl:grid-cols-4">
          {TIERS.map((tier) => (
            <RevealItem key={tier.name}>
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-brand-lg border bg-card p-6 shadow-e1 sm:p-8",
                  tier.featured && "border-blue shadow-e2 xl:-mt-4 xl:pb-10",
                )}
              >
                {tier.featured ? (
                  <span className="absolute -top-3 left-6 rounded-full bg-blue px-3 py-1 text-[12px] font-semibold text-white">
                    Most chosen
                  </span>
                ) : null}

                <h3 className="text-[20px] font-semibold">{tier.name}</h3>

                <p className="mt-4 flex items-baseline gap-2">
                  <span className="text-[38px] leading-none font-bold tracking-tight">
                    {tier.price}
                  </span>
                  <span className="text-[14px] text-muted-foreground">
                    {tier.cadence}
                  </span>
                </p>

                <p className="mt-3 text-[14px] leading-relaxed text-muted-foreground">
                  {tier.tagline}
                </p>

                <ul className="mt-6 mb-8 space-y-3 border-t pt-6 text-[14px]">
                  {tier.features.map((f) => (
                    <li key={f} className="flex gap-3">
                      <Check
                        className="mt-0.5 size-4 shrink-0 text-primary"
                        aria-hidden="true"
                        strokeWidth={2.5}
                      />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  render={<Link href={tier.href} />}
                  size="xl"
                  variant={tier.featured ? "brand" : "outline"}
                  className="mt-auto w-full"
                >
                  {tier.cta}
                </Button>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
