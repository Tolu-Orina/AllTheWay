/**
 * Whether a spoken or typed reply is a yes or a no to a pending plan.
 *
 * Typed chat used to match only `yes` / `go ahead` with no punctuation. Voice
 * says "Yeah, go ahead." and "Yes, please." — those were sent to the planner
 * as a new request, which had no thread, so it asked what they meant and
 * never posted a decision. The meeting never got created.
 *
 * A reply that also changes the plan ("yes, but make it 11") is not a yes.
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
