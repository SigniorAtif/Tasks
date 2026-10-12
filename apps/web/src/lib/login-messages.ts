// What the login screen says when signing in goes wrong. Two different moments:
//
// 1. Starting sign-in fails: the button asks our server for Google's address
//    and gets an error (or no answer) instead.
// 2. Finishing sign-in fails: Google sent the user back, but Better Auth
//    refused, and redirected to `/login?error=<code>`.

/** A sentence for people, plus an optional raw code for the small print. */
export interface LoginMessage {
  text: string;
  code?: string;
}

/** Callback codes that mean "this Google account isn't on the allowlist" (D-016). */
const NOT_ALLOWED_CODES = new Set(['not_invited', 'unable_to_create_user']);

/** The message for `/login?error=<code>`. */
export function callbackErrorMessage(code: string): LoginMessage {
  // Better Auth spells codes in lower case, but one thrown by our own hook
  // might not be; compare without case so either matches.
  if (NOT_ALLOWED_CODES.has(code.toLowerCase())) {
    return { text: "This Google account isn't allowed to sign in." };
  }
  return { text: "Sign-in didn't finish. Please try again.", code };
}

/** The shape of the `error` Better Auth's client returns when a request fails. */
export interface SignInFailure {
  status?: number;
  code?: string | undefined;
  message?: string | undefined;
}

/**
 * The message for a failed start of sign-in. `null` means the request never got
 * an answer (offline, or the server is down).
 */
export function signInErrorMessage(failure: SignInFailure | null): LoginMessage {
  if (failure === null) {
    return { text: "Couldn't reach the server. Check your connection and try again." };
  }
  const code =
    failure.code ?? (failure.status === undefined ? undefined : `HTTP ${failure.status}`);
  // Better Auth answers 404 PROVIDER_NOT_FOUND when the server has no Google
  // client configured (GOOGLE_CLIENT_ID/SECRET unset, fine in development).
  if (failure.code === 'PROVIDER_NOT_FOUND') {
    return { text: "Google sign-in isn't set up on this server yet.", code: failure.code };
  }
  return { text: "Couldn't start Google sign-in. Please try again.", code };
}
