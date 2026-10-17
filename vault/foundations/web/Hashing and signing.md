# Hashing and signing

> **Builds on:** nothing. A starting point.

Three tools that look alike and do different jobs: **hashing**, **signing** and **encryption**. Auth is built from them. Our session cookie uses signing today, and the hand-built machine tokens (v1.5, D-061) will use hashing, so this is the background for the auth you'll write yourself.

## Hashing: a fingerprint

A **hash function** turns any input into a short, fixed-size output:

```sh
printf 'hello' | sha256sum    # 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
printf 'hellp' | sha256sum    # a completely different value
```

Its properties:
- **Same input, same output**, every time, on every machine.
- **One-way:** from the output you can't get the input back. Not "hard"; there's no method except guessing inputs.
- **One letter changed → a totally different output.**
- **Collisions** (two inputs, same output) are practically impossible for SHA-256.

What it's for: storing *proof* of a secret without storing the secret. Keep `sha256(token)` in the database; when someone shows a token, hash it and compare. A stolen database dump then holds only fingerprints.

### Fast hashes vs password hashes

SHA-256 is *fast*: a graphics card computes billions per second. That decides what it's safe for.

- **Random tokens** (32+ random characters) are fine with a fast hash. There are more possibilities than any computer could ever try. That's D-061's plan for the v1.5 machine tokens: SHA-256.
- **Passwords** are not random: people pick `kiit@2026`. An attacker with a dump just hashes a list of likely passwords at billions per second. Passwords therefore need a deliberately **slow** hash (scrypt, Argon2, bcrypt) plus a **salt**, a random value stored next to each hash, so two people with the same password get different hashes. This is a big part of why the app has no passwords (D-059).

## Signing: a tamper-proof seal

A **signature** proves a message came from someone who knows a secret and wasn't changed. The common kind on a server is an **HMAC**: a hash of (secret key + message). Without the key you can't produce a valid HMAC; with it, you can check one.

**Our session cookie** is the example. Its value is `<token>.<signature>`:
- `token` is a random string; the same string is stored in `auth_session.token`;
- `signature` is the HMAC of the token, keyed with `BETTER_AUTH_SECRET`.

You can watch the cookie being built in `dev:session`, which makes exactly the cookie a real sign-in would:

*From `apps/api/src/auth/dev-session.ts` (shortened):*
```ts
  // The cookie is the session token plus an HMAC signature made with
  // BETTER_AUTH_SECRET, URL-encoded the way Better Auth's Set-Cookie sends it.
  const signature = await makeSignature(session.token, ctx.secret);
  return {
    // …
    cookieName: ctx.authCookies.sessionToken.name,
    cookieValue: encodeURIComponent(`${session.token}.${signature}`),
```

What to notice:
- `makeSignature` is Better Auth's HMAC function. Its two inputs are exactly the two above: the message (`session.token`) and the key (`ctx.secret`, which is `BETTER_AUTH_SECRET`).
- `` `${session.token}.${signature}` `` glues them with a dot: the `<token>.<signature>` shape. `encodeURIComponent` escapes any characters a cookie value can't carry as they are.

On every request Better Auth recomputes the signature and refuses the cookie if it doesn't match, *before* any database lookup. So:
- a made-up cookie fails the signature check, at no cost to the database;
- someone holding a database dump has the tokens but not the secret, so they still can't build a valid cookie. That's why the secret must never be in the database, the backups or the repo.

Our code enforces the "never in the repo" part. A fresh clone needs *some* secret to run, so development uses a fixed one, and production refuses it:

*From `apps/api/src/env.ts` (shortened):*
```ts
/**
 * A fixed secret so a fresh clone runs without a `.env`. It is public (it's in
 * this file), so anyone could sign cookies with it: production refuses it.
 */
export const DEV_AUTH_SECRET = 'dev-only-secret-not-for-production-0123456789';
// …
      if (env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['BETTER_AUTH_SECRET'],
          message: 'is the public development value; generate one with `openssl rand -base64 32`',
        });
      }
```

A secret that's on GitHub isn't a secret: anyone could compute valid signatures with it. This check runs only when `NODE_ENV` is `production`, and stops the server from starting ([[Environment variables and config]]).

A signed thing is **readable**: signing hides nothing, it only proves the content wasn't changed. A **JWT** is a signed JSON object; anyone can decode and read it. We don't use JWTs for sessions (D-060, [[Cookies and sessions]]).

## Encryption: a locked box

**Encryption** hides content so only someone with the key can read it, and it's reversible with the key. HTTPS encrypts everything between the phone and the server ([[Reverse proxies and TLS]]). The v0.3 backups will be encrypted with `age` before they leave the box.

## Which one, when

| Need | Tool | Example here |
|---|---|---|
| Check a secret without storing it | Hash | v1.5 machine tokens (`sha256(token)` in the table) |
| Store passwords | Slow hash + salt | We don't (D-059) |
| Prove a value came from us, unchanged | Sign (HMAC) | The session cookie |
| Keep content secret, readable later | Encrypt | HTTPS; v0.3 backups |

## One trap: comparing secrets

`a === b` stops at the first different character, so comparing a guess against the real value takes slightly longer the more leading characters are right. Measured over thousands of tries, that leaks the secret one character at a time: a **timing attack**. Secrets are compared with a constant-time function (`crypto.timingSafeEqual` in Node), which always takes the same time. Better Auth does this for us; you'll do it yourself in the v1.5 tokens.

## Check yourself
- A database dump leaks. Why can't the attacker sign in with the `token` values in `auth_session`?
- Why is SHA-256 fine for a 32-character random token but wrong for a password? What changes, the hash or the input?
- You decode a JWT on jwt.io and read the user's email in it. Was it encrypted? What *does* its signature guarantee?
- Write two lines of Node that compare a received token's hash with a stored hash safely. Which function do you need?
