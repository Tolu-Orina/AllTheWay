import { createContext } from "react";

import type { AuthAdapter, AuthUser } from "@/auth/types";

export type AuthContextValue = {
  user: AuthUser | null;
  /** True until the adapter has reported once — guards must wait for this. */
  loading: boolean;
  adapter: AuthAdapter;
};

export const AuthContext = createContext<AuthContextValue | null>(null);
