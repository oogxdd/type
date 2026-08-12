# Type sync peer

`type-sync-peer` is the optional always-online, persistent replica for Type's
zero-knowledge sync topology. It stores `iroh-docs` metadata and encrypted blob
values so the phone and Mac do not need to be online at the same time.

The process deliberately contains no Type vault key, Git credentials, notes
root, or decryption code. It accepts only an `iroh-docs` **read capability** and
exits if given a write-capable ticket. Paths, filenames, operation metadata,
Markdown, transcripts, audio, and receipts must be encrypted by a trusted Type
client before publication.

## Run

First export a read-only `DocTicket` from a trusted Type device. On the peer:

```sh
type-sync-peer serve \
  --data-dir /var/lib/type-sync-peer \
  --doc-ticket 'docaa...'
```

For a service manager, keep the ticket out of the process list:

```sh
type-sync-peer serve \
  --data-dir /var/lib/type-sync-peer \
  --doc-ticket-file /run/secrets/type-read-doc-tickets
```

One ticket per line is accepted. Blank lines and lines starting with `#` are
ignored. Imported tickets are canonicalized and persisted as
`read-doc-tickets.txt` inside the private data directory, so restarts only need:

```sh
type-sync-peer serve --data-dir /var/lib/type-sync-peer
```

On first start the process prints its stable Iroh `EndpointTicket`. Pair trusted
devices with this endpoint so they dial the persistent replica even while the
other trusted device is offline. Keep `identity.key` stable; changing it changes
the peer's Iroh endpoint identity.

The current experimental binary uses Iroh's public N0 relay preset. Production
managed-relay provisioning and cost are documented in
[`../../docs/MANAGED_IROH_RELAY.md`](../../docs/MANAGED_IROH_RELAY.md).

## What the peer can still observe

The peer cannot decrypt Type values, but it can observe the Iroh document
namespace, author public keys, timestamps, stable opaque per-path entry ids,
ciphertext hashes and sizes, connection addresses/timing, and total storage. This is
zero-knowledge for shared content, not traffic-analysis anonymity.
