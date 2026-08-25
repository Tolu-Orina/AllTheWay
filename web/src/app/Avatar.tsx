import { initialsFromName, nameFor, useAppUser } from "@/app/user";
import { cn } from "@/lib/utils";

/**
 * Initials avatar. Uses the brand gradient rather than the accent, because the
 * accent is reserved for actions and an avatar is not one.
 */
export function Avatar({
  className,
  size = 36,
}: {
  className?: string;
  size?: number;
}) {
  const name = nameFor(useAppUser());
  const initials = initialsFromName(name);

  return (
    <span
      title={name}
      aria-label={name}
      role="img"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-white select-none",
        "bg-[linear-gradient(135deg,var(--at-blue)_0%,var(--at-violet)_100%)]",
        className,
      )}
    >
      {initials}
    </span>
  );
}
