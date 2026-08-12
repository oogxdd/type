use anyhow::{bail, Context, Result};
use iroh::{endpoint::presets, protocol::Router, Endpoint, SecretKey};
use iroh_blobs::{store::fs::FsStore, BlobsProtocol, ALPN as BLOBS_ALPN};
use iroh_docs::{protocol::Docs, sync::Capability, DocTicket, ALPN as DOCS_ALPN};
use iroh_gossip::{net::Gossip, ALPN as GOSSIP_ALPN};
use iroh_tickets::endpoint::EndpointTicket;
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    str::FromStr,
};

const IDENTITY_FILE: &str = "identity.key";
const DOC_TICKETS_FILE: &str = "read-doc-tickets.txt";

#[derive(Debug, PartialEq, Eq)]
struct ServeArgs {
    data_dir: PathBuf,
    doc_tickets: Vec<String>,
    doc_ticket_files: Vec<PathBuf>,
}

fn usage() -> &'static str {
    "Usage:\n  type-sync-peer serve --data-dir <path> [--doc-ticket <read-ticket>]... [--doc-ticket-file <path>]...\n\nThe peer persists an Iroh identity, document replicas, and encrypted blobs in\n<data-dir>. Only read-only document tickets are accepted. A ticket passed on the\ncommand line is saved to <data-dir>/read-doc-tickets.txt for future restarts."
}

fn parse_args<I>(args: I) -> Result<ServeArgs>
where
    I: IntoIterator<Item = String>,
{
    let mut args = args.into_iter();
    let Some(command) = args.next() else {
        bail!(usage());
    };
    if command == "--help" || command == "-h" {
        bail!(usage());
    }
    if command != "serve" {
        bail!("Unknown command '{command}'.\n\n{}", usage());
    }

    let mut data_dir = None;
    let mut doc_tickets = Vec::new();
    let mut doc_ticket_files = Vec::new();
    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--data-dir" => {
                let value = args
                    .next()
                    .context("--data-dir requires a filesystem path")?;
                if data_dir.replace(PathBuf::from(value)).is_some() {
                    bail!("--data-dir may only be specified once");
                }
            }
            "--doc-ticket" => doc_tickets.push(
                args.next()
                    .context("--doc-ticket requires an Iroh document ticket")?,
            ),
            "--doc-ticket-file" => doc_ticket_files.push(PathBuf::from(
                args.next()
                    .context("--doc-ticket-file requires a filesystem path")?,
            )),
            "--help" | "-h" => bail!(usage()),
            _ => bail!("Unknown option '{flag}'.\n\n{}", usage()),
        }
    }

    let data_dir = data_dir.context("--data-dir is required")?;
    if data_dir.as_os_str().is_empty() {
        bail!("--data-dir cannot be empty");
    }
    Ok(ServeArgs {
        data_dir,
        doc_tickets,
        doc_ticket_files,
    })
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = match parse_args(env::args().skip(1)) {
        Ok(args) => args,
        Err(error) => {
            eprintln!("{error:#}");
            std::process::exit(2);
        }
    };
    serve(args).await
}

async fn serve(args: ServeArgs) -> Result<()> {
    ensure_private_directory(&args.data_dir)?;
    let identity = load_or_create_identity(&args.data_dir.join(IDENTITY_FILE))?;
    let tickets_path = args.data_dir.join(DOC_TICKETS_FILE);
    let tickets = collect_read_tickets(&tickets_path, &args.doc_tickets, &args.doc_ticket_files)?;

    let endpoint = Endpoint::builder(presets::N0)
        .secret_key(identity)
        .bind()
        .await
        .context("failed to bind the Iroh endpoint")?;
    let gossip = Gossip::builder().spawn(endpoint.clone());
    let blobs = FsStore::load(args.data_dir.join("blobs"))
        .await
        .context("failed to open the persistent Iroh blob store")?;
    let docs = Docs::persistent(args.data_dir.join("docs"))
        .spawn(endpoint.clone(), (*blobs).clone(), gossip.clone())
        .await
        .context("failed to open the persistent Iroh document store")?;

    let router = Router::builder(endpoint)
        .accept(BLOBS_ALPN, BlobsProtocol::new(&blobs, None))
        .accept(GOSSIP_ALPN, gossip)
        .accept(DOCS_ALPN, docs.clone())
        .spawn();

    // Keep the document handles alive for the lifetime of the router. Importing
    // a ticket starts sync with its advertised peers and persists the replica.
    let mut imported_docs = Vec::with_capacity(tickets.len());
    for ticket in tickets {
        imported_docs.push(
            docs.import(ticket)
                .await
                .context("failed to import a read-only document ticket")?,
        );
    }

    let endpoint_ticket = EndpointTicket::new(router.endpoint().addr()).to_string();
    println!("Type zero-knowledge sync peer is ready.");
    println!("Endpoint ticket (pair trusted devices with this):");
    println!("{endpoint_ticket}");
    println!("Read-only vault replicas: {}", imported_docs.len());
    println!("Data directory: {}", args.data_dir.display());
    println!("Press Ctrl-C to stop cleanly.");

    tokio::signal::ctrl_c()
        .await
        .context("failed to listen for Ctrl-C")?;
    router
        .shutdown()
        .await
        .context("failed to shut down the Iroh router cleanly")?;
    Ok(())
}

fn collect_read_tickets(
    persisted_path: &Path,
    inline: &[String],
    files: &[PathBuf],
) -> Result<Vec<DocTicket>> {
    let mut encoded = Vec::new();
    if persisted_path.exists() {
        encoded.extend(read_ticket_lines(persisted_path)?);
    }
    for file in files {
        encoded.extend(read_ticket_lines(file)?);
    }
    encoded.extend(inline.iter().cloned());

    let mut tickets = Vec::new();
    let mut canonical = Vec::new();
    for value in encoded {
        let ticket =
            DocTicket::from_str(value.trim()).with_context(|| "invalid Iroh document ticket")?;
        if !matches!(&ticket.capability, Capability::Read(_)) {
            bail!(
                "refusing a write-capable document ticket; export a read-only ticket for the sync peer"
            );
        }
        let ticket_string = ticket.to_string();
        if !canonical.contains(&ticket_string) {
            canonical.push(ticket_string);
            tickets.push(ticket);
        }
    }

    if canonical.is_empty() {
        bail!(
            "no document tickets configured; pass at least one --doc-ticket or --doc-ticket-file"
        );
    }
    write_private_file(persisted_path, canonical.join("\n").as_bytes())?;
    Ok(tickets)
}

fn read_ticket_lines(path: &Path) -> Result<Vec<String>> {
    let contents = fs::read_to_string(path)
        .with_context(|| format!("failed to read ticket file '{}'", path.display()))?;
    Ok(contents
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(str::to_owned)
        .collect())
}

fn load_or_create_identity(path: &Path) -> Result<SecretKey> {
    match fs::read(path) {
        Ok(bytes) => {
            let bytes: [u8; 32] = bytes
                .try_into()
                .map_err(|_| anyhow::anyhow!("stored Iroh identity must be exactly 32 bytes"))?;
            Ok(SecretKey::from_bytes(&bytes))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let identity = SecretKey::generate();
            match write_new_private_file(path, &identity.to_bytes()) {
                Ok(()) => Ok(identity),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    load_or_create_identity(path)
                }
                Err(error) => Err(error).context("failed to persist the Iroh identity"),
            }
        }
        Err(error) => Err(error).context("failed to read the Iroh identity"),
    }
}

fn ensure_private_directory(path: &Path) -> Result<()> {
    fs::create_dir_all(path)
        .with_context(|| format!("failed to create data directory '{}'", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .with_context(|| format!("failed to protect data directory '{}'", path.display()))?;
    }
    Ok(())
}

fn write_private_file(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes)
        .with_context(|| format!("failed to write private file '{}'", path.display()))?;
    set_private_file_permissions(path)
}

fn write_new_private_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to protect private file '{}'", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_repeatable_ticket_sources() {
        let args = parse_args(
            [
                "serve",
                "--data-dir",
                "/var/lib/type-peer",
                "--doc-ticket",
                "doc-one",
                "--doc-ticket-file",
                "/run/secrets/type-tickets",
                "--doc-ticket",
                "doc-two",
            ]
            .into_iter()
            .map(str::to_owned),
        )
        .unwrap();

        assert_eq!(args.data_dir, PathBuf::from("/var/lib/type-peer"));
        assert_eq!(args.doc_tickets, ["doc-one", "doc-two"]);
        assert_eq!(
            args.doc_ticket_files,
            [PathBuf::from("/run/secrets/type-tickets")]
        );
    }

    #[test]
    fn rejects_missing_data_directory_and_unknown_flags() {
        assert!(parse_args(["serve"].into_iter().map(str::to_owned)).is_err());
        assert!(parse_args(
            ["serve", "--data-dir", "/tmp/type-peer", "--listen"]
                .into_iter()
                .map(str::to_owned)
        )
        .is_err());
    }
}
