import { HatSchema, type Hat } from "@alltheway/contracts";

/**
 * The hat Today is filtered to. `null` is All: inject every standing row,
 * retrieve unlabeled documents plus every labelled one.
 */
export type ActiveHat = Hat | null;

/**
 * Whether a stored fact belongs in this turn.
 *
 * Unlabelled rows apply everywhere. A filtered Today includes those plus
 * the active hat. Viewing All includes every labelled row too — that is
 * the point of All.
 */
export function appliesHat(stored: Hat | null | undefined, active: ActiveHat): boolean {
  if (stored == null) return true;
  if (active == null) return true;
  return stored === active;
}

export function parseHat(value: unknown): ActiveHat {
  if (value == null || value === "" || value === "all") return null;
  const parsed = HatSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
