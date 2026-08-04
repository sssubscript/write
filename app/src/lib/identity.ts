import type { WriteConfig } from "./config";

export type IdentityAssurance = "authoritative" | "self-issued";

export type IdentityProfile = {
  subject: string;
  fullName: string;
  username?: string;
  avatarUrl?: string;
  profileUrl?: string;
  issuer: string;
  jwksUri?: string;
  assurance: IdentityAssurance;
  assertion: string;
  expiresAt: number;
};

export type Author = {
  id: string;
  name: string;
  publicKey: JsonWebKey;
  identity?: IdentityProfile;
};

export type DeviceIdentity = Author & {
  privateKey: CryptoKey;
  idp: {
    status: "authoritative" | "signed-out" | "error";
    message?: string;
    signInUrl?: string;
    csrfToken?: string;
  };
};

export type Signed<T> = {
  payload: T;
  author: Author;
  signature: string;
  algorithm: "Ed25519";
};

type StoredDevice = {
  id: string;
  name: string;
  publicKey: JsonWebKey;
  privateKey: CryptoKey;
};

type LegacyDevice = {
  id: string;
  name: string;
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
};

type IdpConfiguration = {
  issuer: string;
  audience: string;
  token_endpoint: string;
  jwks_uri: string;
  sign_in_endpoint?: string;
  csrf_token?: string;
  authenticated?: boolean;
};

type JwtParts = {
  header: Record<string, unknown>;
  claims: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
};

type SigningJwk = JsonWebKey & { kid?: string };

const storageKey = "subscript.editor.identity.v1";
const databaseName = "subscript-editor-identity";
const storeName = "device";
const jwksCache = new Map<string, Promise<SigningJwk[]>>();
let volatileDevice: StoredDevice | null = null;
const deviceNameWords = [
  "amber",
  "atlas",
  "cinder",
  "juniper",
  "lumen",
  "marigold",
  "nova",
  "river",
  "sable",
  "wren",
];

const bytesToBase64 = (bytes: ArrayBuffer | Uint8Array) => {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};

const base64ToBytes = (value: string) => {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};

const asArrayBuffer = (value: Uint8Array) =>
  value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;

const canonical = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
};

const jsonBase64 = (value: unknown) =>
  bytesToBase64(new TextEncoder().encode(JSON.stringify(value)));

const parseJsonBase64 = (value: string) =>
  JSON.parse(new TextDecoder().decode(base64ToBytes(value))) as Record<string, unknown>;

export const samePublicJwk = (left: JsonWebKey, right: JsonWebKey) => {
  const publicMaterial = (key: JsonWebKey) => ({
    crv: key.crv,
    kty: key.kty,
    x: key.x,
  });
  return canonical(publicMaterial(left)) === canonical(publicMaterial(right));
};

const randomNonce = () => bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));

export const trustedIdpUrl = (value: string, origin = location.origin) => {
  const url = new URL(value, origin);
  const sameOrigin = url.origin === origin && ["http:", "https:"].includes(url.protocol);
  const localDevelopmentProvider =
    import.meta.env.DEV &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !sameOrigin && !localDevelopmentProvider)
    throw new Error("Identity provider endpoints must use HTTPS.");
  return url.toString();
};

const openStore = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readStoredDevice = async (): Promise<StoredDevice | null> => {
  if (typeof indexedDB === "undefined") return volatileDevice;
  const database = await openStore();
  return new Promise<StoredDevice | null>((resolve, reject) => {
    const request = database
      .transaction(storeName, "readonly")
      .objectStore(storeName)
      .get("current");
    request.onsuccess = () => resolve((request.result as StoredDevice | undefined) || null);
    request.onerror = () => reject(request.error);
  }).finally(() => database.close());
};

const writeStoredDevice = async (device: StoredDevice) => {
  if (typeof indexedDB === "undefined") {
    volatileDevice = device;
    return;
  }
  const database = await openStore();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(device, "current");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

export async function digest(value: unknown) {
  const bytes = new TextEncoder().encode(canonical(value));
  return bytesToBase64(await crypto.subtle.digest("SHA-256", bytes));
}

const createStoredDevice = async (): Promise<StoredDevice> => {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return {
    id: (await digest(publicKey)).slice(0, 22),
    name: `${deviceNameWords[Math.floor(Math.random() * deviceNameWords.length)]}-${deviceNameWords[Math.floor(Math.random() * deviceNameWords.length)]}-${crypto.randomUUID().slice(0, 4)}`,
    publicKey,
    privateKey: pair.privateKey,
  };
};

const migrateLegacyDevice = async (): Promise<StoredDevice | null> => {
  const stored = localStorage.getItem(storageKey);
  if (!stored) return null;
  const legacy = JSON.parse(stored) as LegacyDevice;
  if (!legacy.privateKey || !legacy.publicKey) return null;
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    legacy.privateKey,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const device = { id: legacy.id, name: legacy.name, publicKey: legacy.publicKey, privateKey };
  await writeStoredDevice(device);
  localStorage.setItem(
    storageKey,
    JSON.stringify({ id: device.id, name: device.name, publicKey: device.publicKey }),
  );
  return device;
};

const loadStoredDevice = async () => {
  const existing = await readStoredDevice();
  if (existing) return existing;
  const migrated = await migrateLegacyDevice();
  if (migrated) return migrated;
  const created = await createStoredDevice();
  await writeStoredDevice(created);
  return created;
};

const unpackJwt = (token: string): JwtParts => {
  const [header, claims, signature, ...rest] = token.split(".");
  if (!header || !claims || !signature || rest.length)
    throw new Error("Malformed identity assertion.");
  return {
    header: parseJsonBase64(header),
    claims: parseJsonBase64(claims),
    signingInput: `${header}.${claims}`,
    signature: base64ToBytes(signature),
  };
};

const verifyJwt = async (
  token: string,
  configuration: Pick<IdpConfiguration, "issuer" | "audience" | "jwks_uri">,
  nonce?: string,
  at?: number,
) => {
  const parts = unpackJwt(token);
  if (parts.header.alg !== "RS256" || typeof parts.header.kid !== "string")
    throw new Error("Unsupported identity assertion.");
  const keys = await loadJwks(configuration.jwks_uri);
  const jwk = keys.find((key) => key.kid === parts.header.kid && key.kty === "RSA");
  if (!jwk) throw new Error("Identity signing key was not found.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    asArrayBuffer(parts.signature),
    new TextEncoder().encode(parts.signingInput),
  );
  if (!valid) throw new Error("Identity assertion signature is invalid.");
  validateClaims(parts.claims, configuration, nonce, at);
  return parts.claims;
};

const validateClaims = (
  claims: Record<string, unknown>,
  configuration: Pick<IdpConfiguration, "issuer" | "audience">,
  nonce?: string,
  at = Date.now(),
) => {
  const instant = Math.floor(at / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== configuration.issuer || !audience.includes(configuration.audience))
    throw new Error("Identity assertion audience is invalid.");
  if (
    typeof claims.exp !== "number" ||
    typeof claims.iat !== "number" ||
    claims.exp < instant - 60 ||
    claims.iat > instant + 60
  )
    throw new Error("Identity assertion is outside its validity window.");
  if (typeof claims.nbf === "number" && claims.nbf > instant + 60)
    throw new Error("Identity assertion is not active yet.");
  if (nonce && claims.nonce !== nonce) throw new Error("Identity assertion nonce does not match.");
};

const loadJwks = (uri: string): Promise<SigningJwk[]> => {
  const trustedUri = trustedIdpUrl(uri);
  if (!jwksCache.has(trustedUri)) {
    jwksCache.set(
      trustedUri,
      fetch(trustedUri, { cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("Identity signing keys are unavailable.");
          const body = (await response.json()) as { keys?: JsonWebKey[] };
          if (!Array.isArray(body.keys)) throw new Error("Identity signing keys are invalid.");
          return body.keys as SigningJwk[];
        })
        .catch((error) => {
          jwksCache.delete(trustedUri);
          throw error;
        }),
    );
  }
  return jwksCache.get(trustedUri)!;
};

const makeSelfAssertion = async (device: StoredDevice): Promise<IdentityProfile> => {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: `urn:subscript:self:${device.id}`,
    sub: `urn:subscript:device:${device.id}`,
    aud: "subscript-editor",
    iat: now,
    nbf: now,
    exp: now + 24 * 60 * 60,
    jti: crypto.randomUUID(),
    name: device.name,
    cnf: { jwk: device.publicKey },
  };
  const header = { alg: "EdDSA", typ: "JWT", jwk: device.publicKey };
  const signingInput = `${jsonBase64(header)}.${jsonBase64(claims)}`;
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    device.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return {
    subject: claims.sub,
    fullName: device.name,
    issuer: claims.iss,
    assurance: "self-issued",
    assertion: `${signingInput}.${bytesToBase64(signature)}`,
    expiresAt: claims.exp * 1000,
  };
};

const requestAuthoritativeIdentity = async (
  device: StoredDevice,
  config: Pick<WriteConfig, "idpConfigUrl">,
): Promise<{ identity: IdentityProfile | null; signInUrl?: string; csrfToken?: string }> => {
  const idpUrl = config.idpConfigUrl;
  if (!idpUrl) return { identity: null };
  const configurationResponse = await fetch(trustedIdpUrl(idpUrl), {
    cache: "no-store",
    credentials: "include",
  });
  if (!configurationResponse.ok) throw new Error("Identity provider configuration is unavailable.");
  const configuration = (await configurationResponse.json()) as IdpConfiguration;
  configuration.issuer = trustedIdpUrl(configuration.issuer).replace(/\/$/, "");
  configuration.token_endpoint = trustedIdpUrl(configuration.token_endpoint);
  configuration.jwks_uri = trustedIdpUrl(configuration.jwks_uri);
  const signInUrl = configuration.sign_in_endpoint
    ? (() => {
        const url = new URL(trustedIdpUrl(configuration.sign_in_endpoint));
        url.searchParams.set("return_to", "/write");
        return url.toString();
      })()
    : undefined;
  if (configuration.authenticated === false)
    return { identity: null, signInUrl, csrfToken: configuration.csrf_token };
  const nonce = randomNonce();
  const tokenResponse = await fetch(configuration.token_endpoint, {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": configuration.csrf_token || "" },
    body: JSON.stringify({ device_jwk: device.publicKey, nonce }),
  });
  if (!tokenResponse.ok) throw new Error("Identity provider rejected this device key.");
  const { token } = (await tokenResponse.json()) as { token?: string };
  if (!token) throw new Error("Identity provider did not return an assertion.");
  const claims = await verifyJwt(token, configuration, nonce);
  const binding = claims.cnf as { jwk?: JsonWebKey } | undefined;
  if (
    !binding?.jwk ||
    !samePublicJwk(binding.jwk, device.publicKey) ||
    typeof claims.sub !== "string" ||
    typeof claims.name !== "string" ||
    typeof claims.exp !== "number"
  )
    throw new Error("Identity assertion is not bound to this device key.");
  return {
    signInUrl,
    csrfToken: configuration.csrf_token,
    identity: {
      subject: claims.sub,
      fullName: claims.name,
      username:
        typeof claims.preferred_username === "string" ? claims.preferred_username : undefined,
      avatarUrl: typeof claims.picture === "string" ? claims.picture : undefined,
      profileUrl: typeof claims.profile === "string" ? claims.profile : undefined,
      issuer: configuration.issuer,
      jwksUri: configuration.jwks_uri,
      assurance: "authoritative",
      assertion: token,
      expiresAt: claims.exp * 1000,
    },
  };
};

const assembleIdentity = async (
  device: StoredDevice,
  config: Pick<WriteConfig, "idpConfigUrl">,
): Promise<DeviceIdentity> => {
  let authoritativeIdentity: IdentityProfile | null = null;
  let idp: DeviceIdentity["idp"] = { status: "signed-out" };

  try {
    const result = await requestAuthoritativeIdentity(device, config);
    authoritativeIdentity = result.identity;
    if (authoritativeIdentity) idp = { status: "authoritative", csrfToken: result.csrfToken };
    else
      idp = {
        status: "signed-out",
        signInUrl: result.signInUrl,
        csrfToken: result.csrfToken,
      };
  } catch {
    idp = {
      status: "error",
      message:
        "Subscript could not verify your account. Reload the page; if this continues, check the identity provider configuration.",
    };
  }

  const identity = authoritativeIdentity || (await makeSelfAssertion(device));
  return {
    id: device.id,
    name: identity.fullName,
    publicKey: device.publicKey,
    privateKey: device.privateKey,
    identity,
    idp,
  };
};

export async function loadIdentity(
  config: Pick<WriteConfig, "idpConfigUrl">,
): Promise<DeviceIdentity> {
  return assembleIdentity(await loadStoredDevice(), config);
}

export async function renameIdentity(
  identity: DeviceIdentity,
  name: string,
  config: Pick<WriteConfig, "idpConfigUrl">,
) {
  const device = await loadStoredDevice();
  const next = { ...device, name: name.trim() || device.name };
  await writeStoredDevice(next);
  return assembleIdentity(next, config);
}

const refreshIdentity = async (
  identity: DeviceIdentity,
  config: Pick<WriteConfig, "idpConfigUrl">,
) => {
  if (identity.identity && identity.identity.expiresAt > Date.now() + 60_000) return identity;
  const refreshed = await loadIdentity(config);
  Object.assign(identity, refreshed);
  return identity;
};

export async function sign<T>(
  identity: DeviceIdentity,
  payload: T,
  config: Pick<WriteConfig, "idpConfigUrl">,
): Promise<Signed<T>> {
  await refreshIdentity(identity, config);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    identity.privateKey,
    new TextEncoder().encode(canonical(payload)),
  );
  return {
    payload,
    author: {
      id: identity.id,
      name: identity.name,
      publicKey: identity.publicKey,
      identity: identity.identity,
    },
    signature: bytesToBase64(signature),
    algorithm: "Ed25519",
  };
}

const verifyIdentity = async (author: Author, at: string | undefined) => {
  if (!author.identity) return true;
  const parts = unpackJwt(author.identity.assertion);
  const signedAt = at ? Date.parse(at) : Date.now();
  if (Number.isNaN(signedAt)) return false;
  if (author.identity.assurance === "self-issued") {
    if (
      parts.header.alg !== "EdDSA" ||
      !samePublicJwk(parts.header.jwk as JsonWebKey, author.publicKey)
    )
      return false;
    validateClaims(
      parts.claims,
      { issuer: author.identity.issuer, audience: "subscript-editor" },
      undefined,
      signedAt,
    );
    const key = await crypto.subtle.importKey("jwk", author.publicKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
    return crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      asArrayBuffer(parts.signature),
      new TextEncoder().encode(parts.signingInput),
    );
  }
  const configuration = {
    issuer: author.identity.issuer,
    audience: "subscript-editor",
    jwks_uri:
      author.identity.jwksUri || `${author.identity.issuer}/.well-known/subscript-editor-jwks.json`,
  };
  const claims = await verifyJwt(author.identity.assertion, configuration, undefined, signedAt);
  const binding = claims.cnf as { jwk?: JsonWebKey } | undefined;
  return Boolean(
    binding?.jwk &&
      samePublicJwk(binding.jwk, author.publicKey) &&
      claims.sub === author.identity.subject,
  );
};

export async function verify<T>(entry: Signed<T>) {
  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      entry.author.publicKey,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const deviceValid = await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      asArrayBuffer(base64ToBytes(entry.signature)),
      new TextEncoder().encode(canonical(entry.payload)),
    );
    if (!deviceValid) return false;
    const createdAt =
      "createdAt" in (entry.payload as object)
        ? String((entry.payload as { createdAt?: string }).createdAt)
        : undefined;
    return verifyIdentity(entry.author, createdAt);
  } catch {
    return false;
  }
}
