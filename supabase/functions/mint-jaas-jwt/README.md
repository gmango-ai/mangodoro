# mint-jaas-jwt

Mints a JaaS JWT for the calling Supabase user so the browser embed
can join a room without a long-lived signing key in the client bundle.

## Required secrets

Set these once with the Supabase CLI from the project root:

```bash
supabase secrets set \
  JAAS_APP_ID="vpaas-magic-cookie-…" \
  JAAS_KID="vpaas-magic-cookie-…/abc123" \
  JAAS_PRIVATE_KEY="$(cat ./private-keys/jaas.pk)"
```

- `JAAS_APP_ID` — your JaaS tenant identifier
- `JAAS_KID` — `AppID/ShortKeyID` (visible in JaaS Console → API Keys)
- `JAAS_PRIVATE_KEY` — the PEM body of the `.pk` file you downloaded
  when you created the API key. Multi-line; the shell substitution
  above handles it.

`SUPABASE_URL` and `SUPABASE_ANON_KEY` come from the platform — you
don't need to set them.

## Deploy

```bash
supabase functions deploy mint-jaas-jwt
```

The function requires a Supabase user JWT (verify_jwt remains on);
unauthenticated callers get 401.

## Removing the dev backstop

Once the function is deployed and you've confirmed it works, you can:

- Delete `VITE_JITSI_DEV_JWT` from `.env` and from Vercel — the client
  only needs `VITE_JITSI_APP_ID` to know which provider to use.
- Stop running `scripts/jaas-mint.mjs` every 2 hours.

The static-JWT fallback in `src/lib/jitsi.js` only fires when the edge
function call fails AND `VITE_JITSI_DEV_JWT` is set — handy for local
work when you don't want to deploy on every change.
