import { Reveal } from "@/components/primitives/reveal";

/**
 * Stands in for a customer-logo wall, which we will not fabricate.
 * Every name here is a real dependency named in the architecture doc.
 */
const BUILT_ON = [
  "Gemini Live API",
  "Agent Development Kit",
  "Genkit",
  "Cloud Run",
  "Vertex AI Memory Bank",
];

export function Foundations() {
  return (
    <section className="border-b bg-muted/40 py-8">
      <div className="mx-auto w-full max-w-[1280px] px-4 sm:px-6 lg:px-8">
        <Reveal className="flex flex-col items-center gap-4 text-center sm:flex-row sm:justify-center sm:gap-8">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            Built on
          </p>
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
            {BUILT_ON.map((name) => (
              <li
                key={name}
                className="text-[14px] font-medium text-muted-foreground"
              >
                {name}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
