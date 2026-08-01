# P0E-S5 media license and privacy review

Date: 2026-08-01  
Status: engineering remediation approved; destructive history remediation requires separate owner approval

## Decision

CodeWithMee must not ship a media byte merely because it is present in the repository. A shippable media asset needs recorded source/provenance, a license or owner grant covering the intended use, consent where identifiable people or private material are involved, and the required accessibility alternative. Filename, Git author, local path, duplicate hash, MIME signature, or technical validity is not evidence of those rights.

The tracked promo is therefore `QUARANTINED_NOT_FOR_DEPLOYMENT`. The two third-party interaction sounds have been removed from runtime code. Legacy upload bytes remain frozen in place as private migration inputs. No owner identity was inferred from a filename.

## Evidence inventory

### Promo media

| Evidence                  | Result                                                                                                           | Meaning                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Original application path | `client/src/assets/videos/Aaj Ki Raat.mp4`                                                                       | Was statically imported by the home route and included in every production build. |
| Git state                 | Tracked since initial commit `cf2dcbf` on 2026-02-10; no Git LFS attributes                                      | Git records custody, not a usage license.                                         |
| Size and digest           | 17,771,306 bytes; SHA-256 `2C7B862882D5A68B9EAE253EF439DBA8A186A135FF3A4435F701F3D3C9208CA2`                     | Stable identity for quarantine/review.                                            |
| Technical inspection      | Valid MP4 signature; about 297.61 seconds; 640 x 360; `avc1` and `mp4a` sample entries                           | The file is playable media; technical validity does not establish rights.         |
| Repository provenance     | No attribution, source URL, license grant, consent record, captions, transcript, or media manifest found         | Not eligible to ship.                                                             |
| Remediation               | Moved byte-for-byte to `quarantine/media/unverified-aaj-ki-raat.mp4`; static import and home-page player removed | Vite no longer bundles or deploys it; review custody is retained.                 |

The quarantine README records the exact digest and restrictions. Deleting the working-tree copy later would not erase Git history. No history rewrite is authorized in this program.

### Third-party interaction audio

The home route created and preloaded two remote `assets.codepen.io/7558` MP3 objects at module initialization. The repository contains neither source attribution nor license terms for those exact bytes, and contacting the remote host also disclosed visitor network metadata outside the documented application service set. The sound manager, preload calls, hover playback, click playback, and silent unlock sample were removed. The fallback is silent interaction; no product function depends on sound.

### Legacy uploads

Read-only inventory of `server/uploads` on 2026-08-01:

- 43 files totaling 100,209,574 bytes.
- 16 unique SHA-256 values and 6 duplicate groups.
- 42 files are untracked and 1 JPEG is already tracked in Git.
- Extensions: 29 images (18 PNG, 8 JPG, 3 JPEG), 4 MP3, 4 MP4, and 6 WebM.
- All 43 extension/signature pairs matched the expected JPEG, PNG, MP3, MP4, or WebM magic bytes. This is an inventory result, not malware or polyglot clearance.
- All 29 images were readable; 29 contained image metadata, 8 contained device/software/timestamp-class properties, and none exposed GPS properties through the available Windows image decoder. Absence in this decoder is not a guarantee that all sensitive metadata is absent.
- 11 filenames begin with a user identifier pattern. Such names are personal-data clues and must not become public object keys, logs, analytics labels, or documentation.
- Production already returns `410 legacy_local_upload_retired` for `/uploads`; development-only compatibility serving remains available during migration.
- `.gitignore` now excludes `/server/uploads/**` to prevent new runtime bytes from being added accidentally. The already tracked JPEG remains tracked until an approved migration/history-remediation operation.

No legacy upload bytes were deleted, moved, renamed, or rewritten during this review.

## Approved migration and remediation plan

1. **Freeze and access control.** Keep production local serving disabled. Restrict filesystem/repository access to maintainers. Never publish the upload directory or use it as a deployment artifact.
2. **Authoritative inventory.** Run the existing exclusive-output inventory workflow to produce path-independent checksum, size, signature, duplicate-group, and source-provenance records. Store its report outside public artifacts.
3. **Owner mapping without guessing.** Map a byte only through an authoritative legacy database record plus source provenance. Filename identifiers may assist exception review but can never decide ownership. Quarantine unmapped, multiply mapped, or missing-reference records.
4. **Purpose and policy classification.** Assign each mapped file a permitted purpose, visibility (`PRIVATE`, `ENTITLED`, or derived-public only), retention rule, and domain owner. Reject or quarantine types that are not allowed for that purpose.
5. **Private object migration.** Use the Phase 0 file import pipeline to copy—not move—the byte to an opaque private object key. Validate byte count, SHA-256, signature, quota, and target metadata. Do not expose original filenames as keys.
6. **Safety and privacy validation.** Malware/polyglot scanning and purpose-specific media validation are required before `READY`. Strip sensitive metadata from safe derived images when an approved processor exists; keep originals private. Without those adapters, retain `PENDING_REVIEW`/`QUARANTINED` and do not publish.
7. **Parity and cutover.** Reconcile source and target counts/checksums, resolve every exception, verify signed authorization-aware downloads, back up both data sets, and exercise rollback before changing references.
8. **Retention decision.** After parity and a documented retention window, obtain owner approval for deletion of legacy working-tree bytes. Use exact inventory IDs and a recoverable backup; never glob-delete an unresolved directory.
9. **Git-history remediation.** The tracked JPEG and quarantined promo remain in prior commits. If privacy/rights review requires history removal, schedule a separate owner-approved Git-history remediation with a mirror backup, collaborator coordination, force-push plan, host cache/support steps, and credential rotation if any secret is discovered. Current instructions prohibit history rewriting.
10. **Closure evidence.** Record migrated, quarantined, intentionally retained, and deleted counts/checksums; link approvals; prove no private byte is in frontend/server build artifacts; rerun privacy, authorization, download, backup, and restore tests.

## Ownership and dependencies

| Work                                                      | Roadmap owner                              | Dependency                                                        |
| --------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| Legacy inventory, provenance, import, parity, and cutover | `P0C-S2` through `P0C-S5`                  | Read-only Mongo/source access, PostgreSQL, private object adapter |
| Production upload intent/validation/download policy       | `P0B-S6`, Phase 2/3/4 file features        | S3-compatible private storage and validation adapters             |
| Client asset budget and deployment-artifact exclusion     | `P0E-S6`, `P0F-S4`, `P6A-S1`               | Build and CI gates                                                |
| Malware/media validation and metadata-derived images      | Phase 2/3/6 adapters                       | Scanner/processor capacity; manual review fallback on free tier   |
| Working-tree and Git-history deletion                     | Separate owner-approved security operation | Verified backup, parity, retention decision, collaborator plan    |

## Acceptance and residual risk

Accepted now:

- Unproven promo/audio bytes are absent from the shipped runtime graph.
- Promo bytes remain checksum-verifiable in a non-deployment quarantine.
- New local runtime uploads are ignored by Git.
- Production local upload delivery remains fail-closed.
- All 43 legacy bytes remain untouched for deterministic migration and exception handling.

Residual risk:

- The tracked user JPEG and promo remain in existing Git history and any prior clones.
- Files have not undergone malware, polyglot, content, consent, or comprehensive metadata review.
- Legacy ownership and purpose cannot be established without authoritative database reconciliation.
- Development compatibility serving must never be enabled in a public or shared environment.

Safe fallback: keep all ambiguous media private and quarantined, use silent interactions, use owned text/illustrations for the home page, prefer reviewed external course links for long video, and disable publication when a validation adapter is unavailable.

P0E-S5 is complete when the source/runtime gates pass, this evidence remains reproducible, and no deletion or ownership claim occurs before the migration, parity, backup, retention, and approval gates above.
