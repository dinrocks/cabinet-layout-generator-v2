/** Wraps the app: shows a sign-in / no-access / loading screen unless the user is
 *  ready (allow-listed) or the app is in offline (local-only) mode. */
import type { ReactNode } from "react";
import { useAuth } from "./AuthContext";
import "./auth.css";

export function SignInGate({ children }: { children: ReactNode }) {
  const { status, email, signIn, signOut } = useAuth();

  // editor is usable when ready (allow-listed) or offline (no cloud configured)
  if (status === "offline" || status === "ready") return <>{children}</>;

  if (status === "loading") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <div className="auth-spinner" aria-label="Connecting" />
          <p className="auth-sub">Connecting…</p>
        </div>
      </div>
    );
  }

  if (status === "no_access") {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1 className="auth-title">Cabinet Layout Generator</h1>
          <p className="auth-sub">Signed in as <strong>{email}</strong></p>
          <p className="auth-warn">
            This email isn't on the access list. Ask the admin to add it, then sign in again.
          </p>
          <button type="button" className="auth-btn ghost" onClick={signOut}>Sign out</button>
        </div>
      </div>
    );
  }

  // signed_out
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1 className="auth-title">Cabinet Layout Generator</h1>
        <p className="auth-sub">Sign in to open and save your team's layouts.</p>
        <div className="auth-providers">
          <button type="button" className="auth-btn" onClick={() => signIn("github")}>Continue with GitHub</button>
          <button type="button" className="auth-btn" onClick={() => signIn("google")}>Continue with Google</button>
        </div>
        <p className="auth-foot">Access is limited to approved emails.</p>
      </div>
    </div>
  );
}
