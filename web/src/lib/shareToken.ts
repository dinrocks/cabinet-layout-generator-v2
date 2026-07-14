/** Share-link tokens: 32 random bytes, base64url — long enough that a link is
 *  unguessable, URL-safe without encoding. Revoking = clearing the column. */
export function newShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The URL a recipient opens (main.tsx routes ?share= to the read-only viewer). */
export function shareUrl(token: string, origin: string = window.location.origin): string {
  return `${origin}/?share=${token}`;
}
