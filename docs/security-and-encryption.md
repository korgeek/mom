# Security and encryption

[Project README](../README.md) · [Dated implementation evidence](superpowers/evidence/2026-10-18-screen-lock-responsive/README.md)

This document describes the working-tree implementation and its limits as of 2026-10-29; it does not by itself establish deployment. The responsive screen-lock implementation passed scoped built-application QA and human visual review; its deployment status is recorded in the dated release evidence. Source inspection and synthetic tests are evidence for specific paths, not a security certification or a claim that every browser, device or storage location has been audited.

## Data flow and storage boundary

MoM prepares audio, manages projects and encrypts its persistent sensitive data in the user's browser. Cloudflare serves static application assets. There is no MoM account, meeting-data API, application database or AI relay in the current hosting design.

The browser sends prepared audio to the selected speech-to-text service and sends the selected transcript and instructions to the selected notes service only after the relevant user authorization. The user supplies provider credentials. OpenAI, OpenRouter and explicitly registered compatible endpoints are external data recipients; OpenRouter may add a downstream processing provider. Model discovery and explicit authentication checks also contact providers. Local encryption does not establish their retention, training, billing or account policies, and request cancellation cannot reverse provider charges.

The app encrypts retained source/prepared audio blocks, manifests and pointers; projects and sensitive metadata; raw STT responses and transcript versions; generated/edited notes; recorded request/response diagnostics; persisted provider credentials; incomplete recording drafts; and retained screen settings and selected editor drafts before writing them to IndexedDB. API keys may alternatively remain session-only. Password fields, raw API-key entry fields and transmission consent are excluded from screen-restoration drafts.

The public IndexedDB header and record envelopes contain technical information needed to decrypt and validate the vault: version numbers, random vault/key/record identifiers, KDF parameters, salt, IVs, wrapped-key bytes, ciphertext and operation/nonce accounting. The authentication-failure counter and pending-deletion flag are also public metadata. Record existence, counts and encrypted sizes can be observable. Sensitive titles and filenames are stored inside encrypted payloads; encryption does not hide all storage metadata.

Implementation: [vault crypto](../src/react-app/vault/crypto.ts), [encrypted store](../src/react-app/vault/store.ts), [source writer](../src/react-app/vault/source-writer.ts) and [session lifecycle](../src/react-app/vault/session.ts).

## Current cryptographic construction

These are implemented parameters, not newly recommended settings or an assurance that parameter selection has received a comprehensive independent review.

| Component | Current implementation |
| --- | --- |
| Data encryption key (DEK) | 32 random bytes, generated with native `crypto.getRandomValues`; used as an AES-256-GCM key. |
| Password derivation | Native PBKDF2 with SHA-256, 600,000 iterations and a random 16-byte (128-bit) salt; derives a 256-bit AES-GCM key-encryption key (KEK). |
| DEK protection | The KEK encrypts the raw DEK using AES-GCM encrypt/decrypt with a random 12-byte (96-bit) IV and 128-bit authentication tag. The header's Base64 `wrappedKey` decodes to 48 bytes: 32 bytes of encrypted key material plus the 16-byte tag. |
| Record protection | AES-256-GCM under the DEK, a 12-byte (96-bit) IV per encryption and a 128-bit tag. Audio is stored in bounded blocks of at most 1 MiB. |
| Wrap AAD | A purpose marker, crypto version, vault ID, key ID, KDF/hash/iteration identifiers and salt bind the wrapped DEK to its intended context. |
| Record AAD | A distinct purpose marker, crypto/schema versions, vault ID, expected record ID and key ID bind each record to its intended identity. |
| Key objects | Imported DEKs and derived KEKs are non-extractable Web Crypto keys with the required encrypt/decrypt uses. |

AES-GCM authentication rejects corrupted ciphertext or mismatched authenticated context. The app also checks envelope identities, supported versions, lengths and payload structure. These checks do not detect every possible rollback to an older, otherwise valid complete vault snapshot.

The header stores the encrypted DEK and public parameters. Unlocking derives a KEK from the supplied passphrase, authenticates/decrypts `wrappedKey`, then imports the recovered DEK. A wrong passphrase fails authentication and does not open the vault. There is no separate persisted screen-unlock password or verifier. Screen reauthentication uses the existing wrapped DEK, with guards against owner, lock/reset or passphrase-change races.

### IV reservations and write failures

For an existing DEK, the coordinator generates a random 12-byte IV and reserves its `keyId.IV` identifier in the `nonces` store. A single IndexedDB transaction checks ownership and collision state, adds the reservation and increments the header's operation count. Encryption starts only after that reservation transaction completes. A collision causes a new random attempt, with at most eight attempts; the DEK is limited to **2²⁰ = 1,048,576** record-encryption operations. The implementation stops at that limit rather than silently rotating keys or resetting accounting.

Reservations remain consumed after encryption failure, an aborted later publication or a reload. A newly created vault is the special first-write case: its fresh key, first encrypted catalog, nonce and header become durable together; a failed creation does not reuse that newly generated key. The transaction helper treats completion/abort as the durable outcome.

Sensitive content is encrypted before the content-bearing `put`/`add`. Nonce reservations and public header fields can be written in plaintext because they are technical accounting, not meeting content. Promotion transactions keep encrypted blocks and their authenticated project/manifest ownership consistent. A failed write is not reported as a saved result.

### Passphrase rules and loss

New vaults require 15–256 Unicode code points and at most 1024 UTF-8 bytes. Whitespace-only and decimal-digit-only values, short repeated patterns, control characters and a small list of common values are rejected; spaces and case are preserved. These checks do not measure entropy or reject every predictable phrase. Existing vaults retain their original 8–256-character unlock compatibility. Use a long, unique passphrase even when an older short one still works.

The current working tree implements a shared local authentication-failure counter: the UI warns after three failures; after five, it latches a deletion-pending state and attempts to delete this browser's vault. A successful authentication resets the counter before the threshold. Deletion is destructive and cannot recover the recordings, transcripts, notes or stored keys. If deletion fails, the app reports that deletion is pending and offers retry. Following a security review of a cross-tab stale-retry deletion risk, the retry is bound to the original vault ID, and the ID and deletion latch are checked atomically in the clear transaction; a synthetic replacement-vault test covers this path. See the [current audit](superpowers/evidence/2026-10-29-security-release/security-audit.md) for status and tests.

AES-GCM authentication failure cannot by itself distinguish a wrong passphrase from a syntactically valid but damaged or modified wrapped key, salt or IV. Repeated correct attempts against a damaged header can therefore be counted toward deletion. This is a data-loss risk; do not represent every authentication failure as proof of an incorrect passphrase. Storage errors and interrupted attempts are separate from authentication failures. Short or numeric incorrect candidates count as failures; candidates beyond the supported input limits are rejected without being counted. The audit records the remaining limitations.

Someone with copied vault bytes can try candidate passphrases offline. The 3/5 counter is public IndexedDB metadata and does not limit guesses against a copy; an attacker who can alter or restore the local database can also reset or roll back that counter. PBKDF2 raises the cost of each guess but does not make a predictable passphrase strong.
The vault layer contains a passphrase-change API that authenticates the old wrapped DEK and re-encrypts the same DEK under a newly derived KEK, salt and IV. It does not re-encrypt every data record or rotate the DEK. Someone holding both an older header and its passphrase can recover that same DEK and decrypt later records encrypted under it; the operation does not invalidate copies of an older header. The public UI currently does not offer this operation.

There is no account-based password reset, recovery key or supported encrypted backup/restore. Losing the passphrase can make the existing vault unreadable. The whole-vault reset is destructive: it deletes this browser vault and permits a fresh one; it cannot recover its old password or content. Clearing browser data, profile loss or storage eviction can also lose data.

## Screen locking and full key release

Both work policies use the same persistent encryption. Inactivity locking defaults to one minute and supports 1/3/5/10/30 minutes, one hour or disabled. The app checks actual elapsed time on return as well as timer callbacks. Network responses and automatic progress do not count as user activity.

| Boundary | Behavior in the current implementation |
| --- | --- |
| Standard, the default | Screen locking removes sensitive DOM/accessibility content, stops playback and blocks new UI commands. Already authorized recording, preparation, transcription and notes work may continue. Decrypted data, session credentials and the DEK remain available to the owning tab while needed for that work. When the last work is saved and the screen remains locked, the controller performs full locking and releases app-held sensitive/key references. |
| Strict | Screen locking or a document becoming hidden stops work, fences late publication and saves completed work before full release. A `blur` event alone is not this policy's boundary. Selecting the policy during a task applies at the next lock/hidden boundary; it does not itself immediately abort the task. |
| Explicit full lock/page departure | The full-lock path blocks new work, cancels jobs, stops media resources and tries to save completed/pending work. Shutdown saving is best effort; page closure or OS termination may prevent asynchronous completion. |
| Final save failure | The app stays behind a restricted save-failure recovery gate and blocks ordinary work. Necessary private data/key references remain for retry. It does not claim successful full key release; explicit discard is a separate destructive choice. |

Native Web Locks coordinate one active owner of a vault across tabs. A second tab does not acquire a parallel unlocked session. Ownership release waits for the native lock request to settle before immediate reopening. Reauthentication of a Standard screen lock checks the passphrase without replacing the existing owner or cancelling its jobs.

Full release drops the app's key/data references and cleans up resources; it cannot guarantee that JavaScript strings, Web Crypto internals, browser copies or OS pages have been physically overwritten. Non-extractable means the Web Crypto export operation is unavailable for that key object; code with the live key can still request authorized decrypt operations.

## What this protects, and what it cannot guarantee

The main at-rest goal is to prevent a person who copies the app-managed encrypted browser records from reading sensitive content without the passphrase, subject to passphrase strength and correct implementation. Standard screen locking is a screen/command boundary while work continues; it is not equivalent to removing every key from memory.

| Outside that at-rest boundary | Consequence |
| --- | --- |
| Original user files, `.md` downloads and clipboard output | They remain outside the vault. Markdown export is plaintext and contains the selected notes, not a complete vault backup. |
| Unlocked or Standard-running tab | Plaintext and usable key objects must exist for the authorized task. Developer tools, malicious same-origin code, an extension with sufficient access, an administrator or a compromised browser/OS may access them. |
| Browser Blob backing and OS memory management | Plaintext media Blobs/object URLs are used for processing/playback. Browsers can back Blobs with disk files, and OS swap or crash handling can retain memory. Encrypted IndexedDB writes do not establish “zero plaintext anywhere on disk.” |
| Browser/OS suspension, microphone interruption or process exit | Continued recording or background requests cannot be guaranteed. Only committed chunks/results are durable; pending input and abrupt-exit edits may be lost. An interrupted encrypted draft is not automatically a completed recording. |
| External AI services | Their receipt, retention, retries, billing and output quality are separate from local encryption. |

Sensitive provider fetch paths use `cache: 'no-store'`; this is not a cleanup of existing caches or a provider-retention promise. Source/chunk playback revokes temporary URLs during cleanup, and the app releases its reachable working references during full locking. Neither proves browser-wide memory or disk erasure. Chromium's [Blob storage design](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/storage/browser/blob/README.md) documents memory/disk backing; no actual plaintext spill in a user's profile was established by the recorded tests.

## Backup and device transfer: design only

**Encrypted full-vault backup/restore and device transfer are not implemented.** Downloading a `.md` file exports one selected notes revision. It does not carry source audio, raw responses, transcript history, credentials, pending drafts or the full vault structure, and it cannot migrate the workspace.

The user's intended future design preserves the **original inner encrypted vault**: its ciphertext, wrapped-DEK header, versions, nonce reservations, operation counts and associated structure remain intact. That snapshot would be placed inside an additional encrypted archive protected by a **separate backup password**. Restore would require both the outer backup password and the original vault passphrase. These are successive layers, not two alternative ways to recover the same secret.

The original inner data key and ciphertext remain unchanged. This design cannot recover a forgotten original vault passphrase. The archive/encryption format, password KDF settings and implementation have not been selected. Before implementation, review consistent snapshot capture, authenticated archive validation, preservation of nonce/operation accounting, atomic restore, owner coordination and failure recovery. Verification must demonstrate restoration from an actual synthetic export; the existence of an encrypted archive alone would not prove it can restore a usable vault.

## Recorded evidence and remaining work

The [2026-10-29 security audit](superpowers/evidence/2026-10-29-security-release/security-audit.md) records the current working-tree review, synthetic checks, corrections and remaining limitations. The [2026-10-18 evidence record](superpowers/evidence/2026-10-18-screen-lock-responsive/README.md) is the source for exact commands, failures, corrections and environment limits. Its results apply to the source/build and synthetic inputs recorded there:

- **Selected vault/lock unit checks:** `npm run test:unit -- tests/screen-state.spec.ts tests/lock.spec.ts tests/vault.spec.ts` recorded **62 passing** tests. They cover the directly affected encrypted state, ownership, reauthentication and lock paths; they are not a whole-repository or cryptographic-certification result.
- **Synthetic browser storage audit:** fresh Chrome contexts checked sentinel absence in raw IndexedDB stores/Web Storage, checked CacheStorage/service-worker/console observations, and rejected a wrong passphrase before successful reopening. These checks did not open an existing user vault, dump a production browser profile or audit OS/Blob backing files.
- **Development-server browser group:** the first run passed **20 of 23** cases. Three failures were separately corrected/rechecked, with an additional wrong-passphrase-message recheck. Provider results were keyless fixtures, not authenticated inference.
- **Built-preview workflows:** six scenarios have passing evidence across the initial run and targeted corrections/rechecks: Standard recording at 390/820px, Strict hidden-page interruption, rapid Enter/touch, 768px security settings and the transcript/notes/usage flow. Synthetic sentinels were absent from raw IndexedDB and Web Storage; CacheStorage/service-worker and console observations are recorded separately. The final recording corrections ran against a rebuilt preview; unchanged notes/settings/strict evidence was reused. The record names the exact builds, commands and failed checks. These tests do not establish real OS background behavior or authenticated inference; human visual review passed.

No security certification, full independent cryptographic review or blanket “all temporary data stays in RAM” result is claimed. Actual provider inference, real speech/notes quality, physical mobile browsers and microphones, OS suspension and termination, real storage quota/eviction, and comprehensive device/profile forensics remain outside this evidence. The current KDF/password policy and any future backup design need review against the intended threat model and supported devices.
