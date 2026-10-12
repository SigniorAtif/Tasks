// "An allowlist of one" (D-016, A6): only the emails in AUTH_ALLOWED_EMAILS may
// sign in. Google proves who someone is; this list decides whether they're let in.

/** `env.AUTH_ALLOWED_EMAILS` is already trimmed and lower-case; the email from Google may not be. */
export function isEmailAllowed(allowed: readonly string[], email: string): boolean {
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * The error code a rejected visitor sees, as `?error=not_invited` on the login
 * page. A stable code, so the PWA can show "this app is private" for it.
 */
export const NOT_INVITED = 'not_invited';
