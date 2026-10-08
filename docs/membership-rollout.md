# Multi-group deployment and migration runbook

The new application works with the original group schema until `schemaMigrations/multi-group-v2` is complete. A started but incomplete migration fails closed. Do not run the original group migration or developer bootstrap after this migration begins. Only `api/index.js` is a Vercel function; `vercel.json` and the `dist` frontend deployment remain unchanged.

## Local validation and rehearsal

Run `npm test`, `npm run lint`, `npm run build`, and `npm run test:groups:browser`. Unit/HTTP/browser fixtures inject an in-memory database and mail transport. Real MongoDB tests require a separately supplied `MONGODB_GROUPS_TEST_URI`; they never load production credentials and use only generated `stamjer_groups_test_*` databases. Run `npm run test:groups:mongo` and `node --test test/membershipMongoIntegration.test.js` against an explicitly approved disposable replica set if available.

The migration script requires an explicit database name and never infers one from the connection URI. No preflight/dry-run operation writes documents or indexes. Use a read-only credential for production preflight when available. Reports contain identifiers and fingerprints, not passwords, email addresses, connection strings or receipt contents.

```powershell
node scripts/migrate-memberships.js --preflight --database Stamjer
node scripts/migrate-memberships.js --dry-run --database Stamjer --resolutions C:\private\membership-resolutions.json
```

Resolve every error before applying. No resolutions file is needed for an ordinary existing membership whose initial join date was never recorded: its first period is explicitly `{ joinedAt: null, endedAt: null, provenance: "legacy-import" }`. This grants the original historical calendar access without inventing a joining date. Only the first imported period can have an unknown start; all new joins and rejoins use exact timestamps.

Existing `legacy` users become **ended memberships (Alumni)**, never current memberships with a legacy participation status. Current participation status is Active or Inactive. Recorded archive departure/arrival dates or evidenced resolutions establish exact boundaries. If an imported Alumni departure is unknown, the period uses the fixed migration cutoff with `endProvenance: "migration-access-cutoff"` and `migrationAccessCutoff`: this is a calendar access boundary, **not a claimed departure date**. Dry-run lists every such fallback. Scheduled events on or after this cutoff are excluded, even if they were created earlier. The cutoff is fixed on first apply and reused on interrupted apply. Future Alumni participation and assignments are removed while original plans are retained as import provenance and legacy attendance contributions stay frozen.

An optional resolutions file can supply verified boundaries and identity continuity evidence (replace these example values):

```json
{
  "memberships": {
    "2:stam-default": {
      "evidence": "Verified departure register reference",
      "periods": [
        { "joinedAt": null, "endedAt": "2025-07-01T00:00:00+02:00", "provenance": "legacy-import" }
      ]
    }
  },
  "identities": {
    "11": { "evidence": "Verified identity continuity; only needed if ID 11 exists again" }
  }
}
```

CalendarPage, event details and personal feeds share the same rule: scheduled start falls in any membership period, including the inclusive start and excluding the end. Event creation/publication dates have no influence. Gaps remain inaccessible; backdated events within a permitted period are visible. The migration does not add publication dates or publication provenance metadata. Offsetless event dates mean Europe/Amsterdam; DST gaps/folds require explicit offsets.

Deleted identities receive historical records without login or application access. Global ID allocation starts above all retained references, including deleted identities and transfer archives. Unexplained foreign references, conflicting archive boundaries, overlapping periods, possible reused IDs and live/archive score overlaps remain blockers. An older interrupted lifecycle migration must be reconciled or restored before using this revision; already-complete incompatible membership data is reported by verification and is not silently rewritten. No additional schema version is introduced for the unapplied migration.

Developers manage memberships across groups. Current group administrators manage Active/Inactive status, ending and rejoining within their own groups; they can add an existing account by exact email without browsing other groups' identities. Joining leaves every other membership unchanged. Rejoining defaults to Active and regular member, preserving periods, scores, declarations and the calendar URL. Role changes remain developer-only. Only a developer can remove the last group administrator, providing the authorized recovery path. New transfers and their user-facing controls are retired; original archives remain readable.

Restore a full backup into an approved isolated temporary database in the existing Atlas deployment (subject to capacity and permissions), or an approved disposable replica set. Rehearse apply, verification, interruption/resume and actual rollback there. `mongorestore --dryRun` alone does not prove restore works. Never point tests at `Stamjer`. No additional cluster or paid service is required by the implementation.

## Production cutover — separate authorization required

1. Record the exact current deployment revision, application environment, database inventory/counts and membership/scoring baselines. Retain the stable `TOKEN_SECRET`; changing it invalidates existing login sessions and membership feed URLs.
2. Deploy the compatible build under maintenance, stop **all** writers (production, previews, local API processes, jobs and old clients), and drain in-flight requests. Do not permit old code to write during or after migration.
3. Take a full `mongodump` archive of `Stamjer` outside the repository. Use private credentials without shell-history disclosure. Verify the archive SHA-256 and collection inventory; complete the restore rehearsal before proceeding. Preserve unrelated collections and all file data, not just users/events.
4. Repeat dry-run with the approved resolutions and stopped writers. Review errors, warnings, group totals and withheld historical access. Applying requires both the target and confirmation flag:

   ```powershell
   node scripts/migrate-memberships.js --apply --database Stamjer --confirm-database Stamjer --resolutions C:\private\membership-resolutions.json
   node scripts/migrate-memberships.js --verify --database Stamjer
   ```

5. If interrupted, leave maintenance enabled and rerun apply with the identical resolutions file. Membership/period/history IDs are deterministic and existing documents are never blindly overwritten. A source or resolution fingerprint mismatch blocks resume. Investigate it rather than forcing the marker to complete. The completion marker is written only after original-data and score verification.
6. Start only the new API and verify an existing cookie, a member, a group admin and a developer. Check group switching, an ended membership, calendar/feed event parity, subscriptions across departure/rejoin, scoped totals, declaration history/receipt privacy and SMTP behavior. Reopen writes only after these checks pass.
7. Tell members to replace their old group-wide subscription once with the personal URL from Account. Old shared URLs are disabled after cutover. Ordinary departure/rejoin keeps the new URL; explicit personal revocation or a developer group-wide rotation replaces it. External calendars can cache events until their next refresh.

No production migration or deployment has been performed by this task.

## Declaration delivery and historical limitations

Earlier email-only declarations have no reconstructable database history in this checkout. Existing persistent declaration documents are preserved; new submissions are stored with private receipt documents in the same MongoDB database. No persistent filesystem or new service is used. Each receipt remains within the existing per-file limit and is downloaded through authenticated ownership checks.

`stored` means persisted without a sending attempt. It may be retried by a current member using the saved record. `sending` means an attempt started but its result is not yet confirmed. `smtp-accepted` records acceptance by the mail transport, not reimbursement approval or inbox delivery. `delivery-failed` records an explicit SMTP rejection. `delivery-unknown` records a thrown error after sending began. A process interruption can leave `sending`; investigate the existing SMTP/email evidence before issuing another submission. Unknown or already attempted delivery is deliberately not automatically repeated, because SMTP cannot provide exactly-once delivery across a process crash. Idempotency keys suppress duplicate attempts with the same content. Alumni may only read their own records and receipts when the group's declaration feature is enabled.

## Rollback

Stop and drain every writer again. Preserve a separate full dump of the failed/new state before restoring the original backup. Restore **all** original `Stamjer` collections and redeploy the matching original revision/environment. A collection-level restore is insufficient: newly introduced collections absent from the original backup must be removed from **Stamjer only**, using the recorded backup inventory. In particular `mongorestore --drop` does not remove collections missing from its archive. Verify the resolved cluster/database and inventory before any deletion; do not touch other Atlas databases.

Before reopening, verify original identities, hashes, sessions, group settings, events, archives, push subscriptions and declaration/file records against the backup. Rollback after writes reopen loses post-backup changes unless they are separately reconciled; retain the failure dump for that reconciliation. Do not delete original fields/indexes in this rollout; deferred cleanup requires a separate verified change.
