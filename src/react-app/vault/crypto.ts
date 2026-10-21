// Native Web Crypto only. Public envelopes contain no meeting/provider metadata.
export const CRYPTO_VERSION = 1;
export const SCHEMA_VERSION = 1;
export const ITERATIONS = 600000;
export const OPERATION_LIMIT = 2 ** 20;
export type VaultHeader = Readonly<{
    id: "vault";
    cryptoVersion: number;
    schemaVersion: number;
    vaultId: string;
    keyId: string;
    kdf: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
    iv: string;
    wrappedKey: string;
    operations: number;
    secretRecordId: string;
}>;
export type RecordEnvelope = Readonly<{
    recordId: string;
    vaultId: string;
    keyId: string;
    cryptoVersion: number;
    schemaVersion: number;
    iv: string;
    ciphertext: ArrayBuffer;
}>;
const encoder = new TextEncoder();
function nativeCrypto(): Crypto {
    if (!globalThis.crypto?.subtle)
        throw new Error("Secure cryptography support is required");
    return globalThis.crypto;
}
export function randomId(): string { return nativeCrypto().randomUUID(); }
export function randomBytes(size: number): Uint8Array<ArrayBuffer> { return nativeCrypto().getRandomValues(new Uint8Array(size)); }
export function base64(bytes: Uint8Array): string { return btoa(Array.from(bytes, v => String.fromCharCode(v)).join("")); }
export function decodeBase64(value: string, size?: number): Uint8Array<ArrayBuffer> {
    if (typeof value !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))
        throw new Error("Invalid encrypted envelope");
    let bytes: Uint8Array<ArrayBuffer>;
    try {
        bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0));
    }
    catch {
        throw new Error("Invalid encrypted envelope");
    }
    if (base64(bytes) !== value || (size !== undefined && bytes.length !== size))
        throw new Error("Invalid encrypted envelope");
    return bytes;
}
export function validatePassphrase(secret: string): void {
    const count = [...secret].length;
    if (count < 8 || count > 256 || encoder.encode(secret).byteLength > 1024 || /^\p{Nd}+$/u.test(secret)) {
        throw new Error("Use a unique passphrase of 8–256 characters; numeric passphrases are unsupported");
    }
}
function validateHeader(header: VaultHeader): void {
    if (!header || header.id !== "vault" || header.cryptoVersion !== CRYPTO_VERSION || header.schemaVersion !== SCHEMA_VERSION ||
        header.kdf !== "PBKDF2" || header.hash !== "SHA-256" || header.iterations !== ITERATIONS ||
        !header.vaultId || !header.keyId || header.secretRecordId !== header.keyId ||
        !Number.isSafeInteger(header.operations) || header.operations < 0 || header.operations > OPERATION_LIMIT)
        throw new Error("Unsupported or invalid vault version");
    decodeBase64(header.salt, 16);
    decodeBase64(header.iv, 12);
    decodeBase64(header.wrappedKey, 48);
}
function wrapAAD(header: VaultHeader): Uint8Array<ArrayBuffer> {
    return encoder.encode(JSON.stringify(["mom-wrap", header.cryptoVersion, header.vaultId, header.keyId, "PBKDF2", "SHA-256", ITERATIONS, header.salt]));
}
function recordAAD(header: VaultHeader, recordId: string): Uint8Array<ArrayBuffer> {
    return encoder.encode(JSON.stringify(["mom-record", CRYPTO_VERSION, SCHEMA_VERSION, header.vaultId, recordId, header.keyId]));
}
async function wrappingKey(secret: string, salt: string): Promise<CryptoKey> {
    validatePassphrase(secret);
    const bytes = encoder.encode(secret);
    try {
        const material = await nativeCrypto().subtle.importKey("raw", bytes, "PBKDF2", false, ["deriveKey"]);
        return await nativeCrypto().subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: decodeBase64(salt, 16) }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    }
    finally {
        bytes.fill(0);
    }
}
async function importDataKey(bytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
    return nativeCrypto().subtle.importKey("raw", bytes, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
export async function createHeader(secret: string, vaultId: string): Promise<{
    header: VaultHeader;
    key: CryptoKey;
}> {
    validatePassphrase(secret);
    const raw = randomBytes(32);
    try {
        const keyId = randomId();
        const base: VaultHeader = { id: "vault", cryptoVersion: CRYPTO_VERSION, schemaVersion: SCHEMA_VERSION, vaultId, keyId, kdf: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: base64(randomBytes(16)), iv: base64(randomBytes(12)), wrappedKey: "", operations: 0, secretRecordId: keyId };
        const wrapKey = await wrappingKey(secret, base.salt);
        const wrapped = await nativeCrypto().subtle.encrypt({ name: "AES-GCM", iv: decodeBase64(base.iv, 12), additionalData: wrapAAD(base), tagLength: 128 }, wrapKey, raw);
        return { header: Object.freeze({ ...base, wrappedKey: base64(new Uint8Array(wrapped)) }), key: await importDataKey(raw) };
    }
    finally {
        raw.fill(0);
    }
}
async function unwrapBytes(secret: string, header: VaultHeader): Promise<Uint8Array<ArrayBuffer>> {
    validateHeader(header);
    try {
        const key = await wrappingKey(secret, header.salt);
        const bytes = await nativeCrypto().subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(header.iv, 12), additionalData: wrapAAD(header), tagLength: 128 }, key, decodeBase64(header.wrappedKey, 48));
        return new Uint8Array(bytes);
    }
    catch {
        throw new Error("Unable to unlock vault");
    }
}
export async function unwrapHeader(secret: string, header: VaultHeader): Promise<CryptoKey> {
    const raw = await unwrapBytes(secret, header);
    try {
        return await importDataKey(raw);
    }
    finally {
        raw.fill(0);
    }
}
export async function verifyHeaderPassphrase(secret: string, header: VaultHeader): Promise<void> {
    const raw = await unwrapBytes(secret, header);
    raw.fill(0);
}
export async function rewrapHeader(current: string, next: string, header: VaultHeader): Promise<VaultHeader> {
    validatePassphrase(next);
    const raw = await unwrapBytes(current, header);
    try {
        const candidate = { ...header, salt: base64(randomBytes(16)), iv: base64(randomBytes(12)) };
        const key = await wrappingKey(next, candidate.salt);
        const wrapped = await nativeCrypto().subtle.encrypt({ name: "AES-GCM", iv: decodeBase64(candidate.iv, 12), additionalData: wrapAAD(candidate), tagLength: 128 }, key, raw);
        return Object.freeze({ ...candidate, wrappedKey: base64(new Uint8Array(wrapped)) });
    }
    finally {
        raw.fill(0);
    }
}
// The coordinator durably reserves every IV/operation before calling this function.
export async function encryptRecord(key: CryptoKey, header: VaultHeader, recordId: string, plaintext: Uint8Array<ArrayBuffer>, iv: Uint8Array<ArrayBuffer>): Promise<RecordEnvelope> {
    if (iv.length !== 12 || !recordId)
        throw new Error("Invalid record identity");
    const ciphertext = await nativeCrypto().subtle.encrypt({ name: "AES-GCM", iv, additionalData: recordAAD(header, recordId), tagLength: 128 }, key, plaintext);
    return Object.freeze({ recordId, vaultId: header.vaultId, keyId: header.keyId, cryptoVersion: CRYPTO_VERSION, schemaVersion: SCHEMA_VERSION, iv: base64(iv), ciphertext });
}
export async function decryptRecord(key: CryptoKey, header: VaultHeader, expectedId: string, envelope: RecordEnvelope): Promise<Uint8Array<ArrayBuffer>> {
    if (!envelope || envelope.cryptoVersion !== CRYPTO_VERSION || envelope.schemaVersion !== SCHEMA_VERSION || envelope.recordId !== expectedId || envelope.vaultId !== header.vaultId || envelope.keyId !== header.keyId || !(envelope.ciphertext instanceof ArrayBuffer) || envelope.ciphertext.byteLength < 16)
        throw new Error("Unsupported or invalid encrypted record");
    try {
        return new Uint8Array(await nativeCrypto().subtle.decrypt({ name: "AES-GCM", iv: decodeBase64(envelope.iv, 12), additionalData: recordAAD(header, expectedId), tagLength: 128 }, key, envelope.ciphertext));
    }
    catch {
        throw new Error("Unable to authenticate encrypted record");
    }
}
