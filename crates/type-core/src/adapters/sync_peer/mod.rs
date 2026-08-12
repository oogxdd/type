//! Zero-knowledge primitives for the optional persistent sync peer.
//!
//! Iroh transports and replicates the output of this module. Paths, operation
//! metadata, and file contents are encrypted here before they reach Iroh.

mod envelope;
mod iroh_docs;

pub use envelope::*;
pub use iroh_docs::*;
