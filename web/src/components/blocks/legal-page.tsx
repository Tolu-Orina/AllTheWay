import type { ReactNode } from "react";

import { SiteHeader } from "@/components/blocks/site-header";
import { SiteFooter } from "@/components/blocks/site-footer";
import { Link } from "@/components/primitives/app-link";
import { LEGAL } from "@/legal";

export function LegalPage({
  eyebrow,
  title,
  lede,
  children,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="flex-1">
        <article className="mx-auto w-full max-w-[44rem] px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-blue-deep uppercase dark:text-blue-bright">
            {eyebrow}
          </p>
          <h1 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.015em] sm:text-[40px]">
            {title}
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">{lede}</p>
          <p className="mt-3 text-[13px] text-muted-foreground">
            Effective {LEGAL.effective}. {LEGAL.company} (company number {LEGAL.number}).
          </p>
          <div className="mt-12 flex flex-col gap-9 text-[15.5px] leading-relaxed">{children}</div>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}

export function LegalSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[19px] font-semibold">{title}</h2>
      <div className="mt-2 space-y-3 text-muted-foreground">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function MailLink() {
  return (
    <Link
      href={LEGAL.mailto}
      className="text-blue-deep underline underline-offset-2 dark:text-blue-bright"
    >
      {LEGAL.email}
    </Link>
  );
}
