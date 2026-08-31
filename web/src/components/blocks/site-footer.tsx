import { Link } from "@/components/primitives/app-link";

import { Logo } from "@/components/primitives/logo";

const GROUPS = [
  {
    title: "Product",
    links: [
      { label: "Voice", href: "#voice" },
      { label: "Watchers", href: "#watchers" },
      { label: "Cognitive Profile", href: "#memory" },
      { label: "Pricing", href: "#pricing" },
    ],
  },
  {
    title: "Company",
    links: [{ label: "Contact", href: "/contact" }],
  },
  {
    title: "Legal",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="bg-background py-16">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="grid gap-12 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <Logo />
            <p className="mt-4 max-w-[22rem] text-[14px] leading-relaxed text-muted-foreground">
              Your collaborative companion — voice, autonomous follow-through,
              and a memory you are free to read, correct, and take with you.
            </p>
          </div>

          {GROUPS.map((group) => (
            <nav key={group.title} aria-label={group.title}>
              <h2 className="text-[13px] font-semibold">{group.title}</h2>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t pt-8 text-[13px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} AllTheWay. All rights reserved.</p>
          <p>Built by Rinegan Solutions Limited.</p>
        </div>
      </div>
    </footer>
  );
}
