# Managed Iroh relay

This guide covers the dedicated relay operated by Iroh Services. It does not
cover self-hosting `iroh-relay`.

Pricing and product details below were verified on 2026-08-12. Check the
[official pricing page](https://www.iroh.computer/pricing) before purchasing;
usage prices, taxes, included limits, and availability can change.

## What it does

A managed relay helps two online Iroh endpoints find each other and forwards
end-to-end encrypted QUIC packets when a direct path cannot be established.
It is dedicated to one Iroh Services project, authenticated by default, and
operated by n0.computer.

It is not durable storage. It does not hold a phone upload until an offline Mac
comes back. Type's optional sync peer is a separate, stateful service for that
store-and-forward use case.

The relay cannot decrypt Type traffic, but its operator can observe connection
metadata such as IP addresses, timing, and transferred byte counts. A dedicated
relay improves isolation and operational control; it is not an anonymity
network.

## Current cost

Iroh Services currently requires the Pro plan for managed relays:

| Item | Published price |
| --- | ---: |
| Pro project | USD 19/month |
| Managed cloud relay | USD 0.27/relay/hour |
| First 100 concurrent endpoints | Included in Pro |
| Additional concurrent endpoints | USD 0.50/100 endpoints |

Using the pricing page's 730-hour month:

- one always-on relay: `19 + (0.27 × 730) = USD 216.10/month`;
- two always-on relays: `19 + (2 × 0.27 × 730) = USD 413.20/month`.

Those figures exclude extra metrics/endpoints, negotiated capacity, and taxes.
The interactive Iroh example currently shows USD 218.10 for one relay because
its sample workload also selects 400 endpoints above the included allowance,
adding USD 2. Relay hours are usage-billed; stopping a relay partway through a
month stops further relay-hour charges. Iroh advertises a 30-day trial for
managed hosting.

For Type's current personal experiment the free public relays are the sensible
default. A dedicated managed relay becomes useful for production isolation,
version locking, support, and predictable capacity—not for offline storage.

## Provision it

1. Sign in at [Iroh Services](https://services.iroh.computer/) and create a
   project.
2. Start the Pro trial or upgrade the project to Pro.
3. Open **Relays**, choose **Deploy Relay**, and select a nearby region.
4. Keep access control **Private**. Managed relays are authenticated by default;
   changing the relay to Public lets any endpoint that learns its URL consume
   its capacity.
5. Copy the relay URL shown by the dashboard.
6. In project settings, create an API secret for the Type endpoints. Never put
   this secret in Git, a pairing URL, screenshots, or logs.

For production Iroh recommends at least two relays in different regions. That
roughly doubles the relay-hour portion of the bill, so it is excessive for the
present single-user experiment.

## Configure a Rust endpoint

Iroh's current managed-relay flow uses the `iroh-services` preset. The preset
exchanges the project API secret for a short-lived relay token scoped to the
endpoint key:

```rust
use iroh::Endpoint;

let api_secret = load_from_device_secret_storage()?;
let preset = iroh_services::preset()
    .relays(["https://YOUR_RELAY_HOST"])?
    .api_secret_from_str(&api_secret)?
    .build()?;

let endpoint = Endpoint::bind(preset).await?;
endpoint.online().await;
```

Type currently uses `presets::N0`, so it continues to use the free public relay
network. A future managed-relay setting must be device-local and backed by the
platform keychain/keystore. It must not be written to `.type/settings.json`,
because that file is synced.

After configuring both phone and Mac, open the project's **Relays** page and
verify that the endpoints appear. Test both a normal connection and a network
where direct UDP is unavailable so the relay fallback is actually exercised.

## References

- [Iroh pricing](https://www.iroh.computer/pricing)
- [Dedicated managed relay setup](https://docs.iroh.computer/iroh-services/relays/managed)
- [Relay behavior](https://docs.iroh.computer/concepts/relays)
- [Security and metadata limitations](https://docs.iroh.computer/deployment/security-privacy)
- [Billing FAQ](https://docs.iroh.computer/iroh-services/billing/faq)
