# OAuth sign-in

> **Builds on:** [[HTTP basics]] · [[Cookies and sessions]]

"Sign in with Google" lets Google confirm who you are without our app ever seeing your Google password. The protocol behind it is **OAuth 2.0**, with **OpenID Connect** on top: the part that says *who* you are, not just what you allowed. The step-by-step for our app is in [[Auth]].

## The cast

| Role | Here |
|---|---|
| The person | You, on your phone |
| The **client** (our app) | The API at `tasks.ahmedatif.in`, registered in Google Cloud with a **client id** (public) and **client secret** (private, an env var) |
| The **identity provider** | Google |
| The **redirect URI** | `https://tasks.ahmedatif.in/api/auth/callback/google`: the only address Google will send you back to. Registered in advance, so nobody can make Google deliver your login to their site |

In our app, the client's half of this table is a few lines of Better Auth configuration. Better Auth does the dance itself:

*From `apps/api/src/auth/auth.ts` (shortened):*
```ts
          google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            // …
            prompt: 'select_account' as const,
          },
    // …
    // The origin the browser sees (Vite's in development), so redirects and
    // the Google redirect URI point there: <BETTER_AUTH_URL>/api/auth/callback/google.
    baseURL: env.BETTER_AUTH_URL,
```

The client id and secret come from environment variables, never from the code. The secret is the "private" one in the table, and the repo is public. The redirect URI is built from `baseURL`, so the address registered with Google and the one Better Auth sends must both be the same `BETTER_AUTH_URL`.

## The dance, short version

1. Our app sends your browser to Google with our client id, the redirect URI, what we want (`openid email profile`), a `state`, and a PKCE challenge.
2. You sign in **at Google** and pick an account.
3. Google sends the browser back to the redirect URI with a short-lived **authorization code** and the same `state`.
4. Our **server** trades the code (plus the PKCE verifier and the client secret) for tokens, directly with Google. The **ID token** says: this is Google user `1098…`, email `you@gmail.com`, verified.
5. We decide whether to let that person in (our allowlist), then start our own session ([[Cookies and sessions]]).

The code travels through the browser; the tokens never do. And the code alone is useless without step 4's secrets.

## The two guards

- **`state`** is a random value we make in step 1, remember (a database row plus a signed cookie), and require back in step 3. If someone sends you a callback link carrying *their* code, the `state` won't match and the sign-in is refused. Without it, an attacker could log you into *their* account, then read whatever you save there.
- **PKCE** ("pixy", Proof Key for Code Exchange): in step 1 we make a random secret, the **verifier**, and send Google only its hash, the **challenge**. In step 4 we have to show the verifier. Someone who intercepts the code in step 3 can't redeem it without the verifier, and the verifier never left our server.

## Why Google, and why not magic links (D-059)

Google means no passwords for us to store and no emails to send, and it works on Android and desktop. A **magic link** (a sign-in link sent by email) opens in whatever browser your email app picks, not in the installed PWA, so the session lands in the wrong place. Worse, university link scanners "click" links before you do and use them up.

## Signing in ≠ being allowed in

Google tells us *who* you are. It doesn't decide whether you may use the app: any of the billions of Google accounts can finish the dance. Our allowlist (`AUTH_ALLOWED_EMAILS`) makes that decision.

*From `apps/api/src/auth/allowlist.ts`:*
```ts
// "An allowlist of one" (D-016, A6): only the emails in AUTH_ALLOWED_EMAILS may
// sign in. Google proves who someone is; this list decides whether they're let in.

/** `env.AUTH_ALLOWED_EMAILS` is already trimmed and lower-case; the email from Google may not be. */
export function isEmailAllowed(allowed: readonly string[], email: string): boolean {
  return allowed.includes(email.trim().toLowerCase());
}
```

The whole decision is one `includes`: is this email in the list? Better Auth calls it through a hook just before it would create your user row, so someone who isn't invited never gets a row at all ([[Auth]], step 8). A billion accounts, one guest list.

## Check yourself
- Which values in the dance are secret, and which are fine to be public: client id, client secret, `state`, code, PKCE challenge, PKCE verifier?
- Why does the redirect URI have to be registered with Google in advance? What could an attacker do if Google accepted any redirect URI?
- In our tests, nothing talks to Google. Which single request does the fake Google answer, and why is that the only one? (`src/test/google.ts`.)
