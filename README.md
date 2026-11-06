# Georgia Tech seat monitor

Free hosted regular-seat alerts for Spring 2027 (term `202702`):

| Course | CRN |
| --- | --- |
| CS 6474 A — Social Computing | 27944 |
| CSE 8803 ASI — AI for Social Impact | 30595 |

Runs on Cloudflare Workers with a once-per-minute Cron Trigger, stores observations in D1, and sends email through Resend. The existing hosted deployment was verified on November 6, 2026: both sections returned valid counts and Resend reported the delivery test as delivered. Uploading this repository does not change that deployment or enable automatic deployments.

## How it works

`worker.mjs` fetches the public Banner enrollment endpoint for each term/CRN, validates counts, persists state, and sends on initial-open or observed closed-to-open transitions. Repeated open observations do not resend. Pending alerts use provider idempotency keys and expire after ten minutes; an observed closure suppresses an unsent alert. A short database lease limits concurrent invocations. A one-time delivery test is recorded separately in D1.

The recipient is configured in `worker.mjs`. This is a private personal repository. No Georgia Tech password is used and no API credentials are stored here.

## Deploy a separate instance

1. Use Cloudflare Workers Free and Resend Free. With Resend's default testing sender, use the same email for the Resend account and destination; other recipients require a verified domain. Leave paid overages off.
2. Install Node.js and run `npm install`, then `npx wrangler login`.
3. Run `npx wrangler d1 create gt-seat-monitor` and copy its id into `wrangler.toml`.
4. Run `npx wrangler d1 execute gt-seat-monitor --remote --file=schema.sql`.
5. Run `npx wrangler secret put RESEND_API_KEY`, entering a sending-only Resend API key at the private prompt.
6. Adjust the email recipient and courses as needed, then run `npm run deploy`.
7. Verify scheduled logs and D1 observations for both courses. Verify the delivery-test receipt separately. New schedules may take several minutes to activate.

The checked-in configuration intentionally contains a placeholder database id. Do not deploy over the existing instance without restoring its actual binding configuration. Public HTTP and preview URLs are disabled; this is a scheduled worker, not a website.

## Tests

Run `npm test` (or `node test.mjs` without installing dependencies). Fixtures are saved public Georgia Tech enrollment HTML. Checks cover parsing, malformed pages, state transitions, deduplication, reopening, pending retry behavior and expiration. They do not simulate the Cloudflare runtime or email delivery. Live operation was verified separately.

## Limits and operations

Alerts are observations, not a registration entitlement. Source delays, service failures, email delays, and brief openings between checks prevent guaranteed immediate alerts. Counts alone cannot establish eligibility or whether seats are reserved. Failed checks preserve the last valid state. Errors are logged; no independent outage notification is configured.

The minute schedule makes about 1,440 runs and 2,880 Georgia Tech requests per day. Keep within free quotas and confirm acceptable source access. Cloudflare Free has a small CPU budget; observed routine execution was 7 ms, but future performance can differ. Free limits and provider terms can change. Remove the Cron Trigger in the Cloudflare dashboard to stop monitoring. The worker continues while your computer is off, and deployment-token expiry does not stop it.

## References

- [Cloudflare Workers free plan](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 quotas](https://developers.cloudflare.com/d1/platform/pricing/)
- [Resend pricing](https://resend.com/pricing)
- [Resend test-sender restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain)
