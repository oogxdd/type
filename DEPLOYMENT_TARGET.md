# Production deployment target

Production hosting for this project must move to Hetzner. Vercel and ngrok are not approved production hosts or production tunnels.

## Current deployment that needs retirement

The `mobile-adhoc.yml` workflow currently publishes the iOS OTA install site to Vercel on `mobile-v*` releases, and the README documents `https://type-ota.vercel.app`. This existing production path is non-compliant with the target. It must be retired, and the Vercel project shut down, as part of the migration.

## Migration requirements

- Design and verify a Hetzner-hosted replacement for the OTA manifest and install assets before changing release behavior.
- Keep deployment credentials in protected GitHub secrets or a managed secret store; never commit them.
- Verify the release workflow, HTTPS, manifest, install link, and rollback path against the Hetzner target.
- Do not configure a new production Vercel deployment or use ngrok for production traffic.
- If this repository is not currently deployable on Hetzner, record the concrete host, service, storage, DNS, backup, and rollback requirements before enabling production deployment.
