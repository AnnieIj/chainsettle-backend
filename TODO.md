# TODO - Harden CORS & Helmet (Production Security)

- [ ] Update `src/main.ts`:
  - [ ] Harden Helmet with explicit CSP, HSTS, noSniff, frameguard deny, xssFilter
  - [ ] Disable `X-Powered-By`
  - [ ] Replace CORS config to use `ALLOWED_ORIGINS` (comma-separated), strict origin allowlist, credentials=true
  - [ ] Keep safe fallback to existing `CORS_ORIGIN` when `ALLOWED_ORIGINS` is missing
- [ ] Update `.env.example`:
  - [ ] Document `ALLOWED_ORIGINS` with example value
- [ ] Sanity checks:
  - [ ] `npm run build`
  - [ ] (Optional) run tests `npm test`

