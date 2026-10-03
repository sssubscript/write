# Subscript Write signaling

This is a standalone Cloudflare Worker for the `y-webrtc` signaling step used by Write's peer-to-peer collaboration. It is intentionally isolated from the main app package and can be deployed independently with Wrangler.

## What it does

- Accepts WebSocket upgrades
- Implements the small `y-webrtc` pub/sub signaling protocol (`subscribe`, `unsubscribe`, `publish`, `ping`)
- Uses a Durable Object as the broker so all signaling clients share a single room registry

This worker only handles peer discovery and signal fanout. It does not carry document state; the actual sync remains peer-to-peer over WebRTC.

## Local development

```sh
cd signaling
npm install
npm run dev
```

Wrangler will print a local WebSocket URL you can use as the signaling endpoint (set it as `VITE_SIGNALING_URL` in `../app/.env.local`).

## Deploy

```sh
cd signaling
pnpm install
pnpm run deploy
```

After deploy, Cloudflare will give you a Worker URL such as:

```txt
wss://subscript-write-signaling.<your-account>.workers.dev
```

Use that URL as `VITE_SIGNALING_URL` when building the app.

## Do you need to self-host this?

No. By default `VITE_SIGNALING_URL` points at the public `wss://y-webrtc-signaling.fly.dev` and `wss://y-webrtc.fly.dev` relays, so Write works out of the box without deploying anything. These are community-run relays with no uptime guarantee; for production, deploy your own worker.

Write is local-first: your script never leaves your browser except peer-to-peer over WebRTC. This worker (or the public relays) only helps two browsers find each other; it never sees document content. If you'd rather not depend on a third-party relay, deploy your own copy with the steps above and point `VITE_SIGNALING_URL` at it.
