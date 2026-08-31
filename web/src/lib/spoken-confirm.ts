/**
 * Whether a spoken or typed reply is a yes or a no to a pending plan.
 *
 * Keep in step with `services/gateway/src/voice/confirm.ts`. Voice says
 * "Yeah, go ahead." and "Yes, please." — a regex that only matched `yes`
 * treated those as a new turn and ran nothing.
 */

const FILLER = /[^\p{L}\p{N}\s]/gu;

export function normalizeSpoken(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(FILLER, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CHANGES_THE_PLAN =
  /\b(but|except|instead|change|wait|actually|don t|dont|do not|not|without|except for)\b/;

const YES_WHOLE =
  /^(y|ye+|yeah|yep|yup|yes|ok|okay|k|sure|alright|alright then|go ahead|go for it|do it|do that|please|please do|please do that|yes please|yeah go ahead|yes go ahead|yes please do|ok go ahead|okay go ahead|sure go ahead|that s fine|thats fine|that is fine|confirm|confirmed|do so)$/;

export function isSpokenYes(text: string): boolean {
  const t = normalizeSpoken(text);
  if (!t || t.length > 48) return false;
  if (CHANGES_THE_PLAN.test(t)) return false;
  return YES_WHOLE.test(t);
}

const NO_WHOLE =
  /^(n|no|nope|nah|stop|cancel|never mind|nevermind|don t|dont|do not|no thanks|no thank you|no stop|don t do that|dont do that|not now)$/;

export function isSpokenNo(text: string): boolean {
  const t = normalizeSpoken(text);
  if (!t || t.length > 48) return false;
  return NO_WHOLE.test(t);
}

/** Clicking a numbered plan card sends the step label, not "yes". */
export function isPendingConfirmReply(
  text: string,
  pending?: {
    actions?: Array<{ label?: string }>;
    steps?: Array<{ label?: string }>;
  },
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed === "1" || isSpokenYes(trimmed)) return true;
  const norm = normalizeSpoken(trimmed);
  if (!norm) return false;
  const labels = [
    ...(pending?.actions ?? []).map((a) => a.label),
    ...(pending?.steps ?? []).map((s) => s.label),
  ];
  return labels.some((label) => label && normalizeSpoken(label) === norm);
}
