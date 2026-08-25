import { Link } from "@/components/primitives/app-link";
import { Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Reveal,
  RevealGroup,
  RevealItem,
} from "@/components/primitives/reveal";
import { cn } from "@/lib/utils";

type Tier = {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  /** What this tier adds over the one before it — not a repeated checklist. */
  features: string[];
  cta: string;
  href: string;
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    tagline: "Enough to find out whether it actually remembers you.",
    features: [
      "One active session at a time",
      "Profile updates weekly",
      "Core connectors, text only",
      "No Watchers",
    ],
    cta: "Start free",
    href: "/signup",
  },
  {
    name: "Plus",
    price: "$18",
    cadence: "per month",
    tagline: "For one person who wants voice, memory and their first Watchers.",
    features: [
      "Unlimited sessions",
      "Profile updates daily",
      "Voice conversation, fair-use minutes",
      "Up to 3 active Watchers",
    ],
    cta: "Start free trial",
    href: "/signup?plan=plus",
    featured: true,
  },
  {
    name: "Team",
    price: "Custom",
    cadence: "per seat",
    tagline: "When the companion has to be safe for a company to adopt.",
    features: [
      "Everything in Plus, per seat",
      "Org-wide Watcher policy controls",
      "SSO through your identity provider",
      "Admin visibility across every trace",
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
            Voice minutes and Watcher runs are metered, because both cost real
            money to run. Everything else is a flat seat price.
          </p>
        </Reveal>

        <RevealGroup className="mt-12 grid items-start gap-5 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <RevealItem key={tier.name}>
              <div
                className={cn(
                  "relative flex h-full flex-col rounded-brand-lg border bg-card p-6 shadow-e1 sm:p-8",
                  tier.featured && "border-blue shadow-e2 lg:-mt-4 lg:pb-10",
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
