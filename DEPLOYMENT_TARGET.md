# Production deployment target

Production hosting for this project must move to Hetzner. Vercel and ngrok are not approved production hosts or production tunnels.

## Current deployment that needs retirement

The `.github/workflows/mobile-adhoc.yml` workflow currently deploys iOS OTA install assets to Vercel for `mobile-v*` tags. It defaults to `https://type-ota.vercel.app` through `IOS_AD_HOC_BASE_URL`; repository variables can override the URL and Vercel project identifiers. This path is not the target. Migrate the OTA site and release verification to Hetzner, confirm the Vercel endpoint is retired, then shut down the Vercel project.

## Migration requirements

- Design and verify a Hetzner-hosted replacement for the OTA manifest and install assets before changing release behavior.
- Keep deployment credentials in protected GitHub secrets or a managed secret store; never commit them.
- Verify the release workflow, HTTPS, manifest, install link, and rollback path against the Hetzner target.
- Do not configure a new production Vercel deployment or use ngrok for production traffic.
- If this repository is not currently deployable on Hetzner, record the concrete host, service, storage, DNS, backup, and rollback requirements before enabling production deployment.
