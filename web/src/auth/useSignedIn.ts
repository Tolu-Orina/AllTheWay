import { useAuth } from "@/auth/useAuth";

/**
 * True as soon as Auth has a user — including a session restored from
 * localStorage on first paint, before Firebase's listener has fired.
 * Guest CTAs stay up while `user` is still null.
 */
export function useSignedIn(): boolean {
  return Boolean(useAuth().user);
}
