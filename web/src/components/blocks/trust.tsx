import { Eye, GitBranch, Lock, ShieldCheck } from "lucide-react";

import {
  Reveal,
  RevealGroup,
  RevealItem,
} from "@/components/primitives/reveal";

const GUARANTEES = [
  {
    icon: ShieldCheck,
    title: "Irreversible actions always stop and ask",
    body: "Sending external mail, moving money, deleting data — these confirm first. It is a floor you cannot lower, only an admin can waive it, and the waiver is itself logged.",
  },
  {
    icon: GitBranch,
    title: "You set the ceiling per category",
    body: "Draft only, send after my review, or send automatically — chosen per Watcher and per kind of action, and changeable the moment you change your mind.",
  },
  {
    icon: Lock,
    title: "Untrusted input gets screened",
    body: "Every inbound email or web page a Watcher reads is checked for prompt injection before it can influence a decision or reach your memory.",
  },
  {
    icon: Eye,
    title: "The audit trail is the same one you read",
    body: "There is no separate admin dashboard holding the real story. The Transparent Trace you can open is the record a security review would be handed.",
  },
];

export function Trust() {
  return (
    <section className="border-b bg-navy-deep py-20 text-porcelain sm:py-28">
      <div className="mx-auto grid w-full max-w-[1280px] gap-12 px-4 sm:px-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-20 lg:px-8">
        <Reveal>
          <p className="text-[12px] font-semibold tracking-[0.12em] text-orange-light uppercase">
            Governed by design
          </p>
          <h2 className="mt-3 text-[32px] leading-tight font-semibold tracking-[-0.015em] sm:text-[40px]">
            Autonomy you can actually hand over
          </h2>
          <p className="mt-4 text-[17px] leading-relaxed text-navy-fg">
            Giving software the ability to act while you are not watching only
            works if the guardrails hold weight. Every autonomous run lands in
            the same plan and the same ledger as a session you drove yourself —
            there is no quieter path.
          </p>
        </Reveal>

        <RevealGroup className="grid gap-px overflow-hidden rounded-brand-lg bg-white/10 sm:grid-cols-2">
          {GUARANTEES.map(({ icon: Icon, title, body }) => (
            <RevealItem key={title} className="bg-navy-deep">
              <div className="h-full p-6">
                <Icon className="size-5 text-orange-light" aria-hidden="true" />
                <h3 className="mt-4 text-[16px] font-semibold">{title}</h3>
                <p className="mt-2 text-[14px] leading-relaxed text-navy-fg">
                  {body}
                </p>
              </div>
            </RevealItem>
          ))}
        </RevealGroup>
      </div>
    </section>
  );
}
