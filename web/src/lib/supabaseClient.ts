/**
 * Supabase client — created only when the env is configured. When it's absent
 * (local dev without keys, CI build, or a deliberate offline run) `supabase` is
 * null and the app runs in local-only mode (Phase-1 behaviour). Nothing here
 * throws if the keys are missing — that's the graceful-degrade contract.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabase: SupabaseClient | null =
  url && anon
    ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;

/** True when cloud features (auth, cloud-saved projects) are available. */
export const cloudEnabled = supabase !== null;

/** The current user's access token (for authenticated calls to the ezdxf service later). */
export async function accessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
