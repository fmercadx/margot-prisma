# licence

The service the mobile app checks at launch. Subscriptions are sold on the web
through Stripe; the app is a login, not a store.

```
POST /licence/verify   {email, key, app, v}  ->  {active, reason?, seat?, company?}
POST /stripe/webhook   Stripe events, signature-verified
GET  /health
```

Runs on Cloudflare Workers — one file, no framework, no build step, free tier.
Nothing here is Cloudflare-specific except `wrangler.toml` and the KV binding;
the handler is a plain `fetch(request, env)`.

```bash
npm test              # 21 tests, no network, no wrangler
npx wrangler deploy
```

## Deploying it

1. **Create the KV namespace** and put its id in `wrangler.toml`:
   ```bash
   npx wrangler kv namespace create LICENCES
   ```

2. **Set the secrets.** These never go in the repo:
   ```bash
   npx wrangler secret put STRIPE_WEBHOOK_SECRET   # whsec_… from the Stripe dashboard
   npx wrangler secret put STRIPE_SECRET_KEY       # sk_… optional, see below
   ```

3. **Point Stripe at it.** Add a webhook endpoint for
   `https://<your-worker>/stripe/webhook` subscribing to
   `checkout.session.completed`, `customer.subscription.updated` and
   `customer.subscription.deleted`.

4. **Set the endpoint in the app** — `credit-analyzer/mobile/app.config.json`,
   which is the only place it lives. `build.py` prepends it to `shell.js`.

5. **Email the key.** A completed checkout writes a key to KV; the response
   body carries it. Wire that into whatever sends the receipt, or read it from
   the Stripe dashboard and send it by hand for the first few customers.

## How it decides

Webhooks are the source of truth and keep KV current, so a launch costs one KV
read rather than a round trip to Stripe.

`STRIPE_SECRET_KEY` is optional but worth setting. Without it, a missed webhook
means a lapsed subscription keeps verifying indefinitely. With it, any record
not confirmed in three days is re-checked against the Stripe API before the
answer is given.

If Stripe is unreachable during that re-check, the cached status stands.
Failing closed there would lock out paying customers during somebody else's
outage, which is a worse failure than a few extra days of access.

`past_due` still verifies. A card that failed overnight should not take the
tool away from someone in the middle of a file — that is what dunning is for.

## Things that are deliberate

**The webhook signature is checked before anything is written.** Skipping it
would let anyone POST a fabricated `checkout.session.completed` and mint
themselves a licence. There is a test that asserts an unsigned webhook writes
nothing at all.

**A wrong key and a wrong email give the identical message.** Different
messages turn this into an oracle: an attacker learns which keys exist by
watching which error comes back. Tested.

**Signature comparison is timing-safe.** `===` on a signature leaks how much of
a guess was right, one character at a time.

**Keys use Crockford base32.** `I`, `L`, `O` and `U` are omitted so nobody
types `1` for `I` or `0` for `O` copying a key off a receipt.

**A repeat checkout reuses the existing key.** A renewal or a plan change must
not silently invalidate the key someone already has installed.

**CORS is limited to the app's own origins.** The public web page has no gate
and never calls this, so nothing else needs access.

## Not done

- **Rate limiting.** Keys are 100 bits of randomness, so guessing is not the
  threat; a flood is. Add Cloudflare rate limiting rules in front of
  `/licence/verify` if this ever gets attention.
- **Seat counts.** `seats` is stored but not enforced. One key currently works
  on any number of devices.
- **Key rotation.** No way yet for a customer to invalidate a leaked key
  without cancelling and re-subscribing.
