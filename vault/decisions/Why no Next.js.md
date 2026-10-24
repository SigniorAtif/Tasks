# Why no Next.js (for the app)

The app is a React + Vite single-page app (SPA) with a separate Hono API. The public landing page is a separate thing, and could use Next.js or a static site generator.

## What an SPA is

The server sends one mostly empty HTML page plus a JavaScript bundle. After that, React draws every screen in the browser and only fetches JSON from the API. Next.js can instead render pages on the server (SSR) and send ready-made HTML.

## Why an SPA here

- **SSR mostly helps SEO and first paint.** The app is behind a login, so search engines never see it. The landing page is where SEO matters.
- **Offline PWA.** An SPA is plain static files, so a service worker caches it simply. SSR and server components complicate that.
- **Native later.** Capacitor can wrap static files into a phone app. A server-rendered app is harder to wrap.
- **API-first.** The CLI, the git hook and the VS Code extension all call the same API as the web app. In Next.js, the backend tends to drift into route handlers inside the frontend.
- **Less framework to patch.** Next.js has changed routers and caching defaults several times, and had serious CVEs in 2025 (a middleware auth bypass, an RCE in React Server Components).

## What we give up

File-based routing (TanStack Router has it too), `next/image`, a fixed project structure, and one-click Vercel deploys. None of them matter much here.

## Animation

Motion (`motion/react`) and GSAP (`@gsap/react`) work in any React app. Page transitions are easier in an SPA: `AnimatePresence` around the route outlet, or TanStack Router's built-in View Transitions.

Source: `docs/brainstorm/09-frontend.md` §3–4.
