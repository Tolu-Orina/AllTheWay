import { cn } from "@/lib/utils";

/**
 * The brand mark. Source of truth is public/android-chrome-512x512.png;
 * this 64px WebP is generated from it by scripts/generate-icons.mjs.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <img
      src="/logo-mark-64.webp"
      alt=""
      aria-hidden="true"
      width={32}
      height={32}
      className={cn("size-8 shrink-0 object-contain", className)}
    />
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[22px] font-bold tracking-[-0.02em]">
        AllTheWay
      </span>
    </span>
  );
}
