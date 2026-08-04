import { beforeEach, describe, expect, it } from "vitest";
import type { WriteConfig } from "./config";
import { digest, loadIdentity, samePublicJwk, sign, trustedIdpUrl, verify } from "./identity";

const idpConfig: Pick<WriteConfig, "idpConfigUrl"> = { idpConfigUrl: "/write/identity/config" };

describe("signed authorship", () => {
  beforeEach(() => {
    localStorage.clear();
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          issuer: location.origin,
          audience: "subscript-editor",
          token_endpoint: "/write/identity/token",
          jwks_uri: "/.well-known/subscript-editor-jwks.json",
          csrf_token: "editor-csrf-token",
          authenticated: false,
        }),
      );
  });

  it("creates a persistent device identity and verifies its signed records", async () => {
    const identity = await loadIdentity(idpConfig);
    const entry = await sign(identity, { kind: "edit", text: "FADE IN:" }, idpConfig);

    expect((await loadIdentity(idpConfig)).id).toBe(identity.id);
    expect(identity.identity?.assurance).toBe("self-issued");
    expect(identity.idp.status).toBe("signed-out");
    expect(identity.idp.csrfToken).toBe("editor-csrf-token");
    expect(entry.author.identity?.assertion).toContain(".");
    expect(localStorage.getItem("subscript.editor.identity.v1") || "").not.toContain("privateKey");
    expect(await verify(entry)).toBe(true);
    expect(await verify({ ...entry, payload: { ...entry.payload, text: "CUT TO:" } })).toBe(false);
  });

  it("uses the configured well-known sign-in endpoint for a signed-out provider", async () => {
    const fetchImplementation = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          issuer: location.origin,
          audience: "subscript-editor",
          token_endpoint: "/write/identity/token",
          jwks_uri: "/.well-known/subscript-editor-jwks.json",
          sign_in_endpoint: "/.well-known/subscript-editor-sign-in",
          authenticated: false,
        }),
      );

    try {
      const identity = await loadIdentity(idpConfig);
      expect(identity.idp.signInUrl).toBe(
        `${location.origin}/.well-known/subscript-editor-sign-in?return_to=%2Fwrite`,
      );
    } finally {
      globalThis.fetch = fetchImplementation;
    }
  });

  it("hashes canonical object content independent of key order", async () => {
    expect(await digest({ scene: 2, author: "Mara" })).toBe(
      await digest({ author: "Mara", scene: 2 }),
    );
  });

  it("labels a failed provider handoff instead of silently presenting it as signed out", async () => {
    const fetchImplementation = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("provider offline");
    };

    try {
      const identity = await loadIdentity(idpConfig);
      expect(identity.identity?.assurance).toBe("self-issued");
      expect(identity.idp.status).toBe("error");
      expect(identity.idp.message).toContain("could not verify");
    } finally {
      globalThis.fetch = fetchImplementation;
    }
  });

  it("skips the identity provider entirely when Subscript integration is disabled", async () => {
    let fetchCalled = false;
    const fetchImplementation = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    };

    try {
      const identity = await loadIdentity({});
      expect(fetchCalled).toBe(false);
      expect(identity.identity?.assurance).toBe("self-issued");
      expect(identity.idp.status).toBe("signed-out");
      expect(identity.idp.signInUrl).toBeUndefined();
    } finally {
      globalThis.fetch = fetchImplementation;
    }
  });

  it("allows loopback HTTP providers only in development", () => {
    expect(trustedIdpUrl("http://localhost:4000/idp", "https://editor.example")).toBe(
      "http://localhost:4000/idp",
    );
    expect(() => trustedIdpUrl("http://identity.example/idp", "https://editor.example")).toThrow(
      "must use HTTPS",
    );
  });

  it("binds an IDP assertion to public key material rather than export metadata", () => {
    const boundKey = { crv: "Ed25519", kty: "OKP", x: "device-public-key" };
    const browserExport = {
      ...boundKey,
      alg: "Ed25519",
      ext: true,
      key_ops: ["verify"],
    } as JsonWebKey;

    expect(samePublicJwk(boundKey, browserExport)).toBe(true);
    expect(samePublicJwk(boundKey, { ...boundKey, x: "another-device" })).toBe(false);
  });
});
