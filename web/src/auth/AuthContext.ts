/** Auth context + types + the useAuth hook (kept separate from the provider component
 *  so the provider file only exports a component — react-refresh friendly). */
import { createContext, useContext } from "react";

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  is_admin: boolean;
}

export type AuthStatus = "loading" | "offline" | "signed_out" | "no_access" | "ready";
export type OAuthProvider = "github" | "google";

export interface AuthValue {
  status: AuthStatus;
  email: string | null; // signed-in email (whatever the status)
  profile: Profile | null; // non-null only when status === "ready"
  signIn: (provider: OAuthProvider) => Promise<void>;
  signOut: () => Promise<void>;
  setDisplayName: (name: string) => Promise<void>;
}

export const AuthCtx = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthCtx);
  if (!v) throw new Error("useAuth must be used within <AuthProvider>");
  return v;
}
