# Reverse proxies and TLS

> **Builds on:** [[How a request travels]] · [[Hashing and signing]]

What Cloudflare and Caddy do in front of the API, and how HTTPS works. The big picture is in [[How a request travels]]; why one hostname matters is in [[Origin]].

## Reverse proxy

A **reverse proxy** receives requests on behalf of a server and passes them on, so the client only ever talks to the proxy. We have two in a row:

```
phone ──HTTPS──▶ Cloudflare ──HTTPS──▶ Caddy (on the box) ──HTTP──▶ API container
```

- **Cloudflare** hides the box's real IP address, absorbs floods of junk traffic, and can rate-limit sign-in attempts.
- **Caddy** handles HTTPS on the box and forwards to the API over the private Docker network. It also holds requests for a few seconds while a deploy restarts the API, so you see a short pause instead of an error.

The last hop is plain HTTP because it never leaves the box.

## TLS, HTTPS and certificates

**TLS** is the encryption under HTTPS, and it does two jobs. Nobody between your phone and the server (say, the hostel Wi-Fi) can read or change the traffic. And your phone can check it's really talking to `tasks.ahmedatif.in`.

That second job needs a **certificate**: a file saying "this key belongs to tasks.ahmedatif.in", signed by a **certificate authority** that browsers trust. **Let's Encrypt** issues them for free through a protocol called **ACME**, which asks the server to prove it controls the name, typically by serving a random file at `http://tasks.ahmedatif.in/.well-known/acme-challenge/…`. Caddy does all of this automatically, and renews before expiry.

With Cloudflare in front there are two certificates: Cloudflare's (what your phone sees) and Caddy's (what Cloudflare sees). Cloudflare's **Full (strict)** mode insists that Caddy's certificate is valid. **Flexible** mode would send your traffic to the box unencrypted, which is why we never use it. The padlock would still show; it just wouldn't mean much.

## HSTS

`Strict-Transport-Security: max-age=31536000` tells the browser: "for the next year, never use plain HTTP for this host, not even if a link says `http://`". It closes the gap where the very first request could be intercepted. We leave out `includeSubDomains` and `preload` because both are hard to undo.

*From `deploy/Caddyfile`:*
```sh
	# HSTS: "for the next year, only ever use HTTPS for this host". Only meaningful (and
	# only sent) over HTTPS. No includeSubDomains and no preload: both are hard to undo.
	@https protocol https
	header @https Strict-Transport-Security "max-age=31536000"
```

`@https protocol https` defines a **matcher**, a named condition ("requests that arrived over HTTPS"). The `header` line applies only to requests that match it, so a laptop running the stack on plain `http://localhost` never gets the header.

Only Caddy sends this header. The API's `secureHeaders()` ([[API server]]) would add Hono's default too, `Strict-Transport-Security: max-age=15552000; includeSubDomains`, so behind Caddy one answer could carry two different HSTS headers, one of them *with* `includeSubDomains`. A browser obeys only the first one it reads, and which one that is depends on how Caddy merges the API's headers with its own. Rather than rely on that order, the API switches its copy off:

*From `apps/api/src/app.ts`:*
```ts
  // HSTS is left to Caddy (deploy/Caddyfile), which sends it over HTTPS only and
  // without includeSubDomains. Hono's default would add a second, different one.
  app.use(secureHeaders({ strictTransportSecurity: false }));
```

The rule behind it: one header, one owner. Caddy is the right owner because it's the part that knows whether the request came over HTTPS (the `@https` matcher above), while the API behind it only ever sees plain HTTP from Caddy. A test (`errors.test.ts`, "leaves HSTS to Caddy") fails if the API starts sending it again. Once the server is up, `curl -sI https://tasks.ahmedatif.in/healthz | grep -i strict` should print exactly one line.

## The visitor's IP

Because Cloudflare forwards every request, the API would otherwise see Cloudflare's IP for every visitor. That breaks rate limiting: one abuser would get everyone throttled. So Cloudflare puts the real IP in a header, `CF-Connecting-IP`.

The catch is that a header is just text. Anyone who finds the box's IP can connect directly and write `CF-Connecting-IP: 1.2.3.4` themselves. So Caddy believes that header **only when the connection comes from Cloudflare's published IP ranges** (`trusted_proxies`), and then hands the API one value in `X-Forwarded-For`, replacing whatever the visitor sent. This was checked by experiment: a trusted sender's `CF-Connecting-IP` came through, and from an untrusted sender the API saw the sender's real address and the fake headers were dropped.

*From `deploy/Caddyfile` (shortened):*
```sh
		# Cloudflare sits in front of the box, so every request arrives from a Cloudflare
		# address. Cloudflare puts the visitor's real IP in CF-Connecting-IP. Believe that
		# header only when the request really comes from Cloudflare (its published ranges,
		# https://www.cloudflare.com/ips/, checked 2026-10-12); from anyone else it could
		# be a lie. Re-check the list every few months.
		# … trusted_proxies static 173.245.48.0/20 103.21.244.0/22 and 20 more ranges, on one long line
		client_ip_headers CF-Connecting-IP
# …
	reverse_proxy api:3000 {
		# Hand the API exactly one visitor IP: the one Caddy worked out above. Passing the
		# incoming X-Forwarded-For along would let a visitor put a fake IP at its front.
		header_up X-Forwarded-For {client_ip}
```

What to notice:
- `trusted_proxies` lists the senders whose `CF-Connecting-IP` Caddy believes, and `client_ip_headers` names that header. From any other sender, Caddy uses the address the connection really came from.
- `{client_ip}` is a Caddy placeholder for the IP it settled on. `header_up` sets a header on the request going *up* to the API, replacing what the visitor sent.
- `reverse_proxy api:3000` is the forwarding itself: `api` is the API container's name on the private Docker network, the last, unencrypted hop.

## Alternatives

- **Nginx** instead of Caddy: more common, but you set up certificates and renewals yourself.
- **No Cloudflare:** one less hop, but the box's IP is public and there's no edge protection.
- **Cloudflare Tunnel or an Origin CA certificate:** simpler TLS on the box, but then the site works *only* through Cloudflare, with no way to switch it off if an Indian ISP has trouble reaching Cloudflare.

## Check yourself
- Which of the three hops is unencrypted, and why is that acceptable?
- Someone connects straight to the box's IP (skipping Cloudflare) with the header `CF-Connecting-IP: 8.8.8.8`. If they sign in, which IP does Better Auth store in `auth_session.ip_address`: 8.8.8.8 or their real one? Which two lines of the Caddyfile decide it? (The API's own access-log line records no IP at all; Caddy's log and that column do.)
- Why does Cloudflare's "Flexible" mode cause problems even though the padlock still shows in the browser?
- HSTS is sent by Caddy, not by the API. Why couldn't the API decide correctly on its own whether to send it? (Hint: what protocol does the request from Caddy to the API use?)
