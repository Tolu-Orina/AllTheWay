import { AudioLines, FileText, Radar } from "lucide-react";

import {
  Reveal,
  RevealGroup,
  RevealItem,
} from "@/components/primitives/reveal";

type Moment = {
  src: string;
  alt: string;
  icon: React.ElementType;
  meta: string;
  title: string;
  body: string;
};

const MOMENTS: Moment[] = [
  {
    src: "/images/practice-draft.webp",
    alt: "Hands writing notes in an open notebook beside a cup of coffee at a desk",
    icon: Radar,
    meta: "Watcher · draft only",
    title: "A client inquiry lands",
    body: "It reads the thread, pulls the closest thing from work you have already done, and has a proposal drafted before you open the tab. It does not send it.",
  },
  {
    src: "/images/practice-transcript.webp",
    alt: "A hand taking handwritten notes beside a laptop showing a video call in progress",
    icon: FileText,
    meta: "Watcher · tasks created",
    title: "A meeting ends",
    body: "The transcript drops into your folder. Action items come out with owners and dates, added to the same plan you were reading this morning.",
  },
  {
    src: "/images/practice-reschedule.webp",
    alt: "A hand writing in a weekly planner next to a phone resting on the page",
    icon: AudioLines,
    meta: "Voice · confirmed first",
    title: "Plans change",
    body: "Say “move Thursday’s call to Friday afternoon.” It reads back exactly what it is about to do, waits for your yes, then does it. One turn, no menus.",
  },
];

export function InPractice() {
  return (
    <section
      id="in-practice"
      className="scroll-mt-20 border-b bg-muted/40 py-20 sm:py-28"
    >
      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <Reveal className="max-w-[44rem]">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-blue-deep uppercase dark:text-blue-bright">
            In practice
          </p>
          <h2 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.015em] sm:text-[40px]">
            What a Tuesday actually looks like
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
            Not a demo script — three ordinary moments where the work either
            waits for you or it does not.
          </p>
        </Reveal>

        <RevealGroup className="mt-12 grid gap-5 md:grid-cols-3">
          {MOMENTS.map(({ src, alt, icon: Icon, meta, title, body }) => (
            <RevealItem key={title} className="min-w-0">
              <article className="group flex h-full flex-col overflow-hidden rounded-brand-lg border bg-card shadow-e1 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-e2">
                <img
                  src={src}
                  alt={alt}
                  width={1200}
                  height={750}
                  loading="lazy"
                  decoding="async"
                  className="aspect-[16/10] w-full bg-muted object-cover"
                />

                <div className="flex flex-1 flex-col gap-3 p-6">
                  <p className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-blue-deep uppercase dark:text-blue-bright">
                    <Icon className="size-4" aria-hidden="true" />
                    {meta}
                  </p>
                  <h3 className="text-[20px] leading-snug font-semibold">
                    {title}
                  </h3>
                  <p className="text-[15px] leading-relaxed text-muted-foreground">
                    {body}
                  </p>
                </div>
              </article>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
