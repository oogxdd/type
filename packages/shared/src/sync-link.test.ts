import { describe, expect, it } from "vitest";

import {
  buildSyncDeepLink,
  CLOUD_PAIRING_LINK_PREFIX,
  isCloudPairingLink,
  parseSyncDeepLink,
  stripPairingUsernameFromSshRemote,
} from "./sync-link";

describe("sync deep link", () => {
  it("round-trips remote, branch, and name", () => {
    const link = buildSyncDeepLink({
      remote: "ssh://pair-token@192.168.1.10:9418/notes",
      branch: "main",
      name: "Computer (mac.local)",
      hostKeySha256: "SHA256:abc123",
    });
    expect(parseSyncDeepLink(link)).toEqual({
      remote: "ssh://pair-token@192.168.1.10:9418/notes",
      branch: "main",
      name: "Computer (mac.local)",
      hostKeySha256: "SHA256:abc123",
    });
  });

  it("round-trips with only a remote", () => {
    const link = buildSyncDeepLink({ remote: "ssh://user@host/repo.git" });
    expect(parseSyncDeepLink(link)).toEqual({
      remote: "ssh://user@host/repo.git",
      branch: undefined,
      name: undefined,
      hostKeySha256: undefined,
    });
  });

  it("accepts URLSearchParams-style + for spaces (old desktop builds)", () => {
    const parsed = parseSyncDeepLink(
      "type2://sync?remote=git%3A%2F%2F10.0.0.2%2Fnotes&name=Computer+%28mac%29"
    );
    expect(parsed).toEqual({
      remote: "git://10.0.0.2/notes",
      branch: undefined,
      name: "Computer (mac)",
      hostKeySha256: undefined,
    });
  });

  it("rejects other schemes, hosts, and missing remotes", () => {
    expect(parseSyncDeepLink("https://example.com?remote=x")).toBeNull();
    expect(parseSyncDeepLink("type2://other?remote=x")).toBeNull();
    expect(parseSyncDeepLink("type2://sync?branch=main")).toBeNull();
  });

  it("tolerates malformed percent-encoding without throwing", () => {
    expect(parseSyncDeepLink("type2://sync?remote=%E0%A4%A")).toBeNull();
  });

  it("strips only local-sync pairing usernames from ssh remotes", () => {
    expect(
      stripPairingUsernameFromSshRemote("ssh://pair-abc123@192.168.1.10:9418/My%20Notes")
    ).toBe("ssh://192.168.1.10:9418/My%20Notes");
    expect(stripPairingUsernameFromSshRemote("ssh://git@github.com/acme/notes.git")).toBe(
      "ssh://git@github.com/acme/notes.git"
    );
    expect(stripPairingUsernameFromSshRemote("https://example.com/notes.git")).toBe(
      "https://example.com/notes.git"
    );
  });
});

describe("cloud pairing links", () => {
  it("pins the prefix the Rust core builds", () => {
    // The payload is built and parsed in
    // crates/type-core/src/adapters/object_sync/pairing.rs. If that constant
    // changes and this one doesn't, every scan silently falls through to the
    // LAN parser and reports "not a Type sync code".
    expect(CLOUD_PAIRING_LINK_PREFIX).toBe("type2://cloud/");
  });

  it("recognizes a cloud code without mistaking it for a LAN one", () => {
    const cloud = `${CLOUD_PAIRING_LINK_PREFIX}eyJlIjoiaHR0cHM6Ly94In0`;
    expect(isCloudPairingLink(cloud)).toBe(true);
    // Scanners often return trailing whitespace.
    expect(isCloudPairingLink(`  ${cloud}\n`)).toBe(true);
    expect(parseSyncDeepLink(cloud)).toBeNull();

    expect(isCloudPairingLink("type2://sync?remote=ssh%3A%2F%2Fhost%2Fn")).toBe(false);
    expect(isCloudPairingLink("https://example.com")).toBe(false);
  });
});
