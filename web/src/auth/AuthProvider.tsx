/**
 * Auth state for the editor. When cloud isn't configured (`supabase === null`)
 * the status is permanently "offline" and the app runs local-only. When it is
 * configured, a user must sign in AND have a profile (= be allow-listed) to reach
 * "ready"; signing in without an allow-listed email lands on "no_access".
 */
import { useEffect, useState, type ReactNode } from "react";
import { supabase, cloudEnabled } from "../lib/supabaseClient";
import { AuthCtx, type AuthStatus, type AuthValue, type Profile } from "./AuthContext";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(cloudEnabled ? "loading" : "offline");
  const [email, setEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    if (!supabase) return; // status already starts "offline" (see useState initializer)
    const sb = supabase;
    let active = true;

    // resolve a user → { signed_out | no_access | ready } by checking for a profile row
    async function resolve(user: { id: string; email?: string } | undefined) {
      if (!active) return;
      if (!user) {
        setEmail(null);
        setProfile(null);
        setStatus("signed_out");
        return;
      }
      setEmail(user.email ?? null);
      const { data, error } = await sb
        .from("profiles")
        .select("id,email,display_name,is_admin")
        .eq("id", user.id)
        .maybeSingle();
      if (!active) return;
      if (error || !data) {
        setProfile(null);
        setStatus("no_access"); // signed in but not allow-listed
        return;
      }
      setProfile(data as Profile);
      setStatus("ready");
    }

    sb.auth
      .getSession()
      .then(({ data }) => resolve(data.session?.user ?? undefined))
      .catch(() => { if (active) setStatus("offline"); }); // unreachable → degrade to local editor

    const { data: sub } = sb.auth.onAuthStateChange((_event, session) => {
      void resolve(session?.user ?? undefined);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value: AuthValue = {
    status,
    email,
    profile,
    signIn: async (provider) => {
      if (!supabase) return;
      await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    },
    signOut: async () => {
      if (!supabase) return;
      await supabase.auth.signOut();
      setProfile(null);
      setEmail(null);
      setStatus("signed_out");
    },
    setDisplayName: async (name) => {
      if (!supabase || !profile) return;
      const { error } = await supabase.from("profiles").update({ display_name: name }).eq("id", profile.id);
      if (!error) setProfile({ ...profile, display_name: name });
    },
  };

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
