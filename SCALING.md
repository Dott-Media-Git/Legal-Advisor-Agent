# Production scaling runbook

The production request path uses Supabase Auth, PostgREST, relational Postgres rows and Storage. It does not restore or rewrite the legacy `app_state` snapshot. Database functions make multi-row case/referral operations atomic, and rate-limit counters are shared across Vercel instances.

## Capacity gates

Before a large launch, enable a paid Supabase plan with Point-in-Time Recovery, spend caps/alerts, sufficient database compute and connection capacity. Use a paid Vercel plan with function concurrency appropriate to measured peak traffic, WAF/bot protection, log drains and spend alerts. Plan upgrades and quota purchases require the account owner's billing approval and cannot be safely inferred from source code.

Use staged gates instead of claiming an unmeasured user count:

1. Run `LOAD_TEST_URL=https://your-preview/api/health LOAD_TEST_REQUESTS=1000 LOAD_TEST_CONCURRENCY=50 npm run test:load` from at least two regions.
2. Load-test authenticated reads, conversation writes, uploads and referral creation with disposable tenant data.
3. Keep API p95 below 750 ms, database CPU below 70%, error rate below 1%, and pool saturation below 70% at 2x forecast peak requests per second.
4. Increase Supabase compute and Vercel concurrency before raising traffic gates. Re-run after every schema or model-provider change.

## Operational controls

- Authentication: Supabase access tokens; no server-local sessions in production.
- Isolation: workspace membership plus RLS; service-role keys remain server-only.
- Rate limits: 12 auth, 30 AI, and 180 general API requests per IP per minute. Tune by abuse data.
- Storage: private `legal-documents` bucket with workspace-prefixed object names.
- Recovery: enable PITR and test a restore quarterly.
- Secrets: rotate any key pasted into chat or logs; never expose the service role in browser code.
- Monitoring: alert on 5xx rate, p95 latency, auth failures, database CPU/IO, storage growth and provider errors.
