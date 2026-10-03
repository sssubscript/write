# Write

Write is a free, open-source, local-first screenwriting app. No account, no server, no lock-in: your script lives in your browser, syncs peer-to-peer when you collaborate, and every edit is cryptographically signed so you always know who wrote what.

Write is a project of **[Subscript](https://subscript.to)** — a home for screenwriters to get their scripts read, reviewed, and into festivals and contests. Write is Subscript's answer to "where do I actually write the thing?" It's free and open source because the tool you draft in shouldn't be a subscription. If you want feedback on a finished draft, a home for your script, or to submit to contests, that's what [subscript.to](https://subscript.to) is for.

The hosted version lives at **[write.subscript.to](https://write.subscript.to)** — open it and start typing, no signup required.

## What it does

- **Local-first**: your project is stored in IndexedDB in your own browser. Nothing is uploaded unless you choose to share it.
- **Peer-to-peer collaboration**: share a link and collaborators sync directly with you over WebRTC ([Yjs](https://yjs.dev/) + [y-webrtc](https://github.com/yjs/y-webrtc)). There's no central server that stores your document.
- **Signed provenance**: every edit and annotation is signed with a device-local Ed25519 key, so you can always verify who wrote or commented on a passage.
- **No account required**: a self-issued, device-bound identity is created automatically. Give your device a name and start writing.
- **Screenplay-native editing**: scene headings, action, dialogue, and the rest of standard screenplay format, with Final Draft (FDX) import and export.

## Developing

If you want to develop or run this locally, you can! This project uses TypeScript, React, Vite, and can be optionally deployed (for very cheap) to Cloudflare Workers.
Install dependencies and start the dev server with:

```sh
pnpm install
pnpm dev
```

This starts the app at `http://localhost:1430`. By default it connects to public y-webrtc signaling relays and the public STUN server included below, so peer-to-peer collaboration works out of the box; run your own [signaling worker](./signaling) if you want to self-host that piece too.

### Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` | Start the Vite dev server |
| `pnpm build` | Type-check and build a static production bundle to `app/dist` |
| `pnpm test` | Run the unit test suite (Vitest) |
| `pnpm lint` | Type-check and run Biome |
| `pnpm signal` | Run the signaling worker locally with `wrangler dev` |

## Configuration

Copy `app/.env.example` to `app/.env.local` and adjust as needed:

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_HOMEPAGE` | Where the wordmark links | `https://subscript.to` |
| `VITE_SIGNALING_URL` | WebRTC signaling endpoints, comma-separated | `wss://y-webrtc-signaling.fly.dev,wss://y-webrtc.fly.dev` |
| `VITE_STUN_URL` | STUN server for NAT traversal | `stun:stun.l.google.com:19302` |
| `VITE_TURN_URL` / `VITE_TURN_USERNAME` / `VITE_TURN_CREDENTIAL` | Optional TURN relay for peers behind restrictive NATs | unset |

## Embedding Write in another page

Besides the standalone site, Write can be built as a drop-in component for a page you serve yourself — e.g. a Subscript page with its own `<head>` (analytics, meta tags, etc.) that just wants the editor somewhere in the body. Build it with:

```sh
pnpm --dir app build:embed
```

This produces a single dependency-free ES module at `app/dist-embed/subscript-write.js` (React and friends bundled in, styles injected at runtime, nothing else required on the page). Two ways to use it:

**As a custom element** — importing the module registers `<subscript-write>`:

```html
<script type="module" src="/assets/subscript-write.js"></script>
<subscript-write
  style="display:block; height:100vh"
  homepage="https://subscript.to"
  signaling-url="wss://your-signaling-worker"
  idp-config-url="/write/identity/config"
></subscript-write>
```

Attributes map to the config options below (kebab-case); the element mounts on connect and unmounts on disconnect.

**Programmatically**, from your own script:

```js
import { mount } from "/assets/subscript-write.js";

const editor = mount(document.getElementById("editor-slot"), {
  homepage: "https://subscript.to",
  signalingUrl: "wss://your-signaling-worker",
  idpConfigUrl: "/write/identity/config",
});

// later, if the slot is torn down:
editor.unmount();
```

`mount(element, config?)` returns `{ unmount }`. All config is optional and falls back to the same defaults as the standalone build (public STUN, subscript.to homepage, no IDP). See [`app/src/lib/config.ts`](./app/src/lib/config.ts) for the full `WriteConfig` shape — it's the same options as the `VITE_*` env vars below, just provided at runtime instead of build time, since an embedded bundle has no build-time env vars of its own.

## Self-hosting

Everything Write depends on can be run by you:

- **The app** is a static site. Build it with `pnpm build` and serve `app/dist` from anywhere, or deploy it to Cloudflare Workers with `pnpm --dir app deploy` (see [`app/wrangler.jsonc`](./app/wrangler.jsonc)).
- **Signaling** is a small, stateless Cloudflare Worker (see [`signaling/`](./signaling)) that only helps two browsers find each other over WebRTC — it never sees your document. Deploy your own with `pnpm --dir signaling deploy` and point `VITE_SIGNALING_URL` at it.
- **STUN** defaults to Google's free public STUN server, which is enough for most direct peer connections and requires no setup.
- **TURN** is optional and only needed for peers behind especially restrictive NATs/firewalls that can't connect directly. Point `VITE_TURN_URL` (plus username/credential) at any standard TURN server (e.g. [coturn](https://github.com/coturn/coturn)) if you need it.

None of these components store your screenplay. Document content only ever lives in participants' browsers and travels directly between them.

## Deploying

The canonical [write.subscript.to](https://write.subscript.to) deployment is built and published by [`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml) on every push to `main`, via GitHub Pages with a custom domain (see [`app/public/CNAME`](./app/public/CNAME)).

To deploy your own fork to Cloudflare instead:

```sh
cd app
pnpm install
pnpm run deploy:dry-run   # sanity check
pnpm run deploy
```

Wrangler uses [`wrangler.jsonc`](./app/wrangler.jsonc) and serves the built Vite output from `dist/` with SPA fallback enabled.

## Identity assertions

By default, Write creates a self-issued Ed25519 assertion bound to a device-local key. It's cryptographically verifiable but marked `self-issued` — it identifies a device, not an account.

To wire Write up to your own account system, set `VITE_EDITOR_IDP_CONFIG_URL` to a JSON endpoint that returns `issuer`, `audience`, `token_endpoint`, and `jwks_uri`. Its token endpoint must accept the device's public JWK plus a one-time nonce and return an RS256 assertion with a matching `cnf.jwk` claim. Write verifies issuer, audience, nonce, expiry, signing key, and device-key binding before trusting the result. External providers must use HTTPS in production; `http://localhost`, `http://127.0.0.1`, and `http://[::1]` are allowed in development only.

## Project layout

```
write/
├── app/          # The React + Vite screenplay editor (deployed as a static site / Cloudflare Worker)
└── signaling/    # Standalone Cloudflare Worker for y-webrtc peer discovery
```

## License

[MIT](./LICENSE) — do what you like with it. If you build something on top of Write, we'd love to hear about it: [subscript.to](https://subscript.to).
