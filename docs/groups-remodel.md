# Deploy the groups remodel

Follow the numbered steps in order. Run commands in **PowerShell on your computer**, from the Stamjer repository. Run each command separately and check its result before continuing.

Use your **existing Atlas cluster** and the production database **`Stamjer`**. This procedure uses a maintenance window and a local backup; no second cluster, separate deployment or paid service is required.

**No live migration or bootstrap has been performed yet.** The completed implementation and local checks are recorded in `GROUPS_REMODEL_PLAN.md`; the production steps below remain to be performed.

**Order: test locally → verify settings → stop all writers → back up and verify → preview and inspect → apply and verify → bootstrap if needed → deploy → validate → reopen.**

## 1. Prepare and test the code locally

```powershell
Set-Location 'C:\Users\rickk\OneDrive\General\Scouting\Stamjer'
node --version
npm ci
Remove-Item Env:MONGODB_GROUPS_TEST_URI -ErrorAction SilentlyContinue
npm test
npm run lint
npm run build
npm run test:groups:browser
```

Use Node **22 or newer** for the browser check. It uses Chrome at its default Windows location; set `BROWSER_PATH` to its executable if Chrome is elsewhere. The local HTTP/browser checks use substitute database and mail services and do not need a production copy.

The example clears the optional integration-test variable so these local checks do not connect to Atlas. To run the real MongoDB integration test safely on the existing cluster, follow [Optional real MongoDB test](#optional-real-mongodb-test) after step 5 and before step 6.

Record the exact tested code revision. If pushing your production branch automatically deploys to Vercel, **wait until step 11 to push that branch**. Any code change requires repeating the relevant local checks before deployment.

**Continue when:** installation, tests, lint, build and browser checks pass, and the tested version is ready to deploy.

## 2. Prepare and verify production settings

Use the existing Atlas cluster. The new mutations require a replica set or sharded cluster; a standalone MongoDB server is insufficient.

**The API, migration CLI and bootstrap CLI always use `Stamjer`.** Confirm the cluster hostname and account in the URI; changing its database suffix does not redirect these scripts to another database.

Configure and compare settings in both places:

- **Local `.env`:** used by migration/bootstrap commands and any locally started API.
- **Hosting Production environment settings:** used by the deployed API. On Vercel, check the existing project's Production environment.

Hosting settings do not automatically reach PowerShell. If `.env` does not exist, copy `.env.example` to `.env`; otherwise edit it without overwriting secrets. Open a fresh PowerShell terminal in the repository. Existing `$env:` variables override `.env`; remove conflicting overrides, especially `MONGODB_URI`, before continuing.

| Setting | Production value |
| --- | --- |
| `MONGODB_URI` | Existing production Atlas connection string. The application/migration account needs read/write and index-creation access to `Stamjer`. |
| `NODE_ENV` | `production` for the deployed API. |
| `CLIENT_ORIGIN` | Your production website origin, such as `https://your-site.example`. |
| `TOKEN_SECRET` | Preserve the existing production value. Changing it logs out devices. |
| `SMTP_SERVICE` | Your mail service, **or** configure `SMTP_HOST`, `SMTP_PORT` and `SMTP_SECURE` for an SMTP server. |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Real mail credentials and sender. Production does not use the development test inbox. |
| `SMTP_REJECT_UNAUTHORIZED` | `true`. |
| `DAILY_CHANGE_EMAIL` | Intended status-change recipient for the initial default group. |
| `PAYMENT_REQUEST_EMAIL` | Intended declaratie recipient for the initial default group. |

Migration seeds the default group's recipients only when creating that group; subsequent changes belong in group settings. Use an inbox you control for the developer account.

Install the free [MongoDB Database Tools](https://www.mongodb.com/docs/database-tools/mongodump/) (`mongodump` and `mongorestore`) and [MongoDB Shell](https://www.mongodb.com/docs/mongodb-shell/install/) (`mongosh`) before the maintenance window. Verify they are available:

```powershell
Get-Command mongodump, mongorestore, mongosh
```

Check Atlas network access for your computer and database-user permissions. The backup account must read every `Stamjer` collection; the restore operator must be able to drop/recreate `Stamjer`, restore documents and create its indexes. Use an existing suitably authorized operator account for recovery if the application account lacks those permissions. Read the [rollback procedure](#rollback-procedure) now.

Record the currently deployed revision and its environment settings so you can restore the matching previous application. Keep secrets private.

**Continue when:** local commands and the hosting environment target the correct production cluster, settings are verified, backup/restore tools and permissions are available, and the previous version can be redeployed.

## 3. Pause production and stop every writer

Arrange a maintenance window. Keep public production access blocked through step 11.

**Vercel:** open the production project, then **Settings → General → Pause Project**. Confirm the project name and verify production requests are blocked. See [Vercel's pause/resume instructions](https://vercel.com/docs/projects/managing-projects#pausing-a-project).

**Other hosts:** stop the API process on every server. Press **Ctrl+C** for a terminal process, or stop its service through the existing process manager.

Also stop scheduled jobs, local API processes, preview deployments, old deployments and any other application or script with production database access. Do not make manual Atlas/Shell edits during the backup or migration. Wait for in-flight requests/jobs to finish, and check logs/processes to establish that no writer remains.

Pausing the main website alone does not stop every possible writer. A maintenance page with a reachable `/api` is insufficient. Do not start the new API until step 11; old writers must stay stopped throughout deployment and validation.

**Continue when:** production access is blocked, all application writers are stopped, and in-flight writes have drained.

## 4. Back up the complete production database

With all writers still stopped, take a fresh backup of **every collection in `Stamjer`**, including collection metadata and index definitions. Do not use a users/events-only export. [mongodump](https://www.mongodb.com/docs/database-tools/mongodump/) includes this metadata; if the URI specifies a database, it must agree with `--db=Stamjer`.

In the same PowerShell terminal prepared in step 2:

```powershell
$groupsBackupUri = node --input-type=module -e "import dotenv from 'dotenv'; dotenv.config({ quiet: true }); process.stdout.write(process.env.MONGODB_URI || '')"
if ($LASTEXITCODE -ne 0 -or -not $groupsBackupUri) { throw 'Could not load MONGODB_URI; do not migrate' }
$groupsBackupDirectory = Join-Path $env:USERPROFILE 'Stamjer-backups'
New-Item -ItemType Directory -Force -Path $groupsBackupDirectory | Out-Null
$groupsBackupFile = Join-Path $groupsBackupDirectory ("Stamjer-before-groups-{0}.archive.gz" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
mongodump --uri="$groupsBackupUri" --db=Stamjer --archive="$groupsBackupFile" --gzip
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; do not migrate' }
```

The backup is stored outside the repository in your Windows user profile. Keep it private: it contains member data and credentials. Keep this terminal open; later examples reuse `$groupsBackupUri` and `$groupsBackupFile`.

**Continue when:** the full database dump has completed successfully without errors. Do not run either apply command yet.

## 5. Verify the backup and recovery instructions — hard stop

Check that the archive exists and is nonempty, then record its full path and checksum:

```powershell
$groupsBackupInfo = Get-Item -LiteralPath $groupsBackupFile -ErrorAction Stop
if ($groupsBackupInfo.Length -le 0) { throw 'Backup is empty; do not migrate' }
$groupsBackupInfo | Select-Object FullName, Length, LastWriteTime
Get-FileHash -LiteralPath $groupsBackupFile -Algorithm SHA256
mongorestore --uri="$groupsBackupUri" --archive="$groupsBackupFile" --gzip --nsInclude='Stamjer.*' --dryRun --verbose
if ($LASTEXITCODE -ne 0) { throw 'Backup restore preview failed; do not migrate' }
```

Inspect the dump output for all expected collections and document counts consistent with production. Inspect the restore preview for the corresponding `Stamjer.*` namespaces; its imported-document count can be zero because nothing is restored. Missing/unexpected contents or any error are a stop condition. Save the dump/preview results with the backup time, cluster identity, checksum and previous deployed revision in your private deployment record.

`mongorestore --dryRun` performs no import; it checks the restore plan, not a completed recovery or every restore permission. Read [MongoDB's restore options](https://www.mongodb.com/docs/database-tools/mongorestore/) and the [rollback procedure](#rollback-procedure), and make sure the required tools, archive and operator access are available. No second database or restore rehearsal is required by this flow.

**Hard stop: do not mutate `Stamjer`, apply the migration or bootstrap an account unless steps 3–5 have passed.** If the backup or recovery preparation is incomplete, keep production paused or resume the unchanged previous application and postpone migration.

**Continue when:** the complete backup succeeded, its file and restore preview are checked, and you have recorded and understood how to restore it with the matching previous code.

## 6. Preview the production migration

With all writers still stopped and local `.env` still targeting production:

```powershell
npm run migrate:groups
if ($LASTEXITCODE -ne 0) { throw 'Migration preview failed; do not apply' }
```

This defaults to read-only mode. Do not add `--apply` yet.

**Continue when:** the command completed successfully and produced a report. Inspect it in step 7 before applying anything.

## 7. Inspect the migration report

Check all of the following:

- `mode: "dry-run"`, `applied: false`, and `errors: []`.
- `inspected.groups`, `inspected.users` and `inspected.events` match the intended production data. Compare users/events with the backup counts; an absent/empty groups collection may be expected before the first migration.
- `defaultGroupNeeded` matches whether the default group already exists.
- User/event update counts are plausible for those records. Nonzero updates are expected on the first migration; unexplained zero counts or unexpected totals require investigation.

Record the report and your interpretation. **Do not proceed if there are errors or unexpected counts.** Confirm the cluster, environment overrides and data first; do not force apply. Any necessary data repair also requires the verified backup and continued downtime, followed by another preview.

**Continue when:** the report has no errors, every count is understood, and production remains paused with no writers.

## 8. Apply the production migration

Only after the backup gate and report inspection have passed:

```powershell
npm run migrate:groups -- --apply
if ($LASTEXITCODE -ne 0) { throw 'Migration apply failed; keep production paused' }
```

**Expected:** `mode: "apply"`, `errors: []`, `applied: true`. Migration adds ownership, canonical roles and indexes while preserving passwords, sessions, attendance and history.

An interrupted/failed apply may leave partial changes. Keep all writers stopped and use [If something fails](#if-something-fails); do not deploy or resume the old application to bypass a failure.

**Continue when:** apply succeeded with the expected report. Keep production paused for verification.

## 9. Verify the migration with another dry run

```powershell
npm run migrate:groups
if ($LASTEXITCODE -ne 0) { throw 'Migration verification failed; keep production paused' }
```

The important fields must now be:

```json
{
  "mode": "dry-run",
  "defaultGroupNeeded": false,
  "updates": { "users": 0, "events": 0 },
  "errors": [],
  "applied": false
}
```

`applied: false` in this **last preview** is correct: it is read-only. Confirm the inspected counts still match the expected data, allowing for creation of the default group. Save both the apply and verification reports.

**Continue when:** there are no errors, no default group left to create and zero remaining user/event updates. Otherwise keep production paused and investigate.

## 10. Bootstrap a developer only if needed

If a production developer already exists, **skip bootstrap and use that account**. Otherwise choose an inbox you control that is not already a member account. Replace the placeholder:

```powershell
$env:BOOTSTRAP_DEVELOPER_EMAIL = 'REPLACE_WITH_YOUR_PRODUCTION_DEVELOPER_EMAIL'
$env:BOOTSTRAP_DEVELOPER_FIRST_NAME = 'Developer'
$env:BOOTSTRAP_DEVELOPER_LAST_NAME = 'Account'
npm run bootstrap:developer
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap preview failed; do not apply' }
```

**Expected preview:** `mode: "dry-run"`, `role: "developer"`, `groupId: null`, `applied: false`.

If the preview is correct, apply:

```powershell
npm run bootstrap:developer -- --apply
if ($LASTEXITCODE -ne 0) { throw 'Bootstrap failed; keep production paused' }
```

**Expected:** `applied: true`. This creates the account but sends no email and prints no password. Set the password in step 12. If the email belongs to a member, choose another email; do not repeatedly apply after successful creation.

**Continue when:** a separate production developer account exists and you know its email.

## 11. Deploy the exact locally tested version

Keep production paused. Confirm hosting Production settings still match step 2.

**Vercel:** deploy the exact revision tested in step 1 to the existing project using your usual Git or CLI workflow. If pushing the production branch triggers deployment, push the prepared changes now. Verify the source revision and successful build. `vercel.json` already specifies `npm run build` and output directory `dist`.

**Other hosts:** install that version, run `npm ci` and `npm run build`, and start `npm run api` through your usual process manager. Keep external access blocked until the new API is ready.

Ensure old code cannot serve production or write to its database. Leave unrelated jobs and preview/local writers stopped. Do not add migration/bootstrap apply commands to the hosting build or API startup.

**Continue when:** the correct new version is deployed successfully and ready for immediate production checks. Keep public access paused until step 12.

## 12. Restore access and validate production

On Vercel, select **Settings → General → Resume Project**. This makes production public; start checking immediately. If you already have an operator-only access restriction, retain it until step 14. Such a restriction is optional; this flow does not require another service. On other hosts, enable access to the new API/site for these checks.

Open the production website. If using an existing developer with a working password, log in directly and continue at item 4:

1. Select **Wachtwoord vergeten** and request a code for the developer email.
2. Read the real email, enter the code, and set a password of at least **12 characters**.
3. Log in. You should arrive at **Developer** (`/developer`).
4. Open **Groepen → Stam → Instellingen**. Review the name, calendar name, default location, email recipients and self-attendance setting. Save the intended settings.
5. Open **Audit** and confirm the settings change appears.
6. Log in separately as an existing admin and regular member. Complete the checklist below.

### Production validation checklist

- [ ] Developer login and group management work; newly bootstrapped accounts receive their password-reset email. For an existing developer, test reset delivery using an account/inbox you control if it has not already been checked.
- [ ] Existing member/admin account data, calendar, opkomsten, assignments, attendance/history and streepjes remain correct. Admins see Strepen and Gebruikersbeheer; regular members retain their expected permissions.
- [ ] Intended group settings save successfully and appear in Audit. This checks a real transactional write; no transaction-related HTTP 503 or server errors appear.
- [ ] Database inspection hides credentials and audit records have the expected group scope. If multiple groups already exist, confirm their users/events remain separated without moving real members for testing.
- [ ] Copy the new subscription URL from **Account → Agenda abonnement → Kopieer URL**, open it in a calendar client, and confirm the intended group's events/calendar name. Treat the URL as a secret.
- [ ] The deployed revision/settings are correct and application logs show no unexpected errors during these checks.

Local tests cover test-group creation, archive/restore, moves, previews, rotation and isolation without needing a production copy. Do not make those experiments on real members/groups to satisfy this checklist. Use controlled test records only if additional production checks are needed. If hosting runs multiple API instances, check that the intended saved settings/permissions are visible across them.

**Continue when:** every applicable production check passes. On any failure, immediately pause production and stop writers again as described in step 13.

## 13. Handle validation failures before reopening

If step 12 passed, proceed to step 14. If it failed:

1. Repeat step 3: pause access, stop all writers (including the new API and any re-enabled jobs), and drain in-flight work.
2. Choose **fix forward** or **rollback**. Keep production paused while resolving the failure.
3. For fix forward, correct the issue, repeat the relevant local checks, deploy the corrected revision, and repeat step 12. Keep the original backup.
4. For rollback, follow the [rollback procedure](#rollback-procedure) to restore **both the pre-migration database and the matching previous application version**. Restoring only the code is unsafe. Data changes since the backup, including validation writes and password changes, will be lost.

**Continue when:** the corrected new version passes step 12, or the restored previous database/application pair is verified. After rollback, record the rollout as rolled back and reopen the previous application; do not announce the new calendar workflow or mark this migration complete.

## 14. Fully reopen after checks pass

For a successful new-version deployment, remove any operator-only restriction and re-enable only jobs/services that are compatible with the new code. Ensure old/preview/local deployments cannot resume production writes. If access was paused again, resume it using step 12.

Tell members to replace old anonymous `/api/calendar.ics` subscriptions:

1. Open **Account → Agenda abonnement → Kopieer URL**.
2. Replace the external calendar subscription with that URL.

The URL is a group secret; keep it private. Rotating it later requires members to replace it again.

Retain the backup through rollout acceptance. Record the previous and new deployed revisions, backup path/checksum, migration reports and successful production checks in your private deployment record; update `GROUPS_REMODEL_PLAN.md` without including secrets. Leave compatibility fallbacks in place; removing them is a separate change after persisted migration is verified.

**Deployment is finished when steps 1–12 passed, any failure in step 13 was resolved by a validated fix forward, and step 14 is complete.** A rollback restores service but leaves the remodel deployment unfinished.

## Optional real MongoDB test

This is extra verification, not a requirement for another cluster or a copy of production. If you want to run it on the existing Atlas cluster, do so **after step 5 and before step 6**, while production remains paused.

The harness explicitly uses a fresh randomly named **`stamjer_groups_test_<random UUID>`** database. It seeds fixtures, checks real indexes/migration/transactions/concurrent writes and moves, then drops that test database in cleanup. **It must never read, write, migrate or drop `Stamjer`; the current harness does none of those operations on `Stamjer`, even if the URI includes that database name.**

Its account must have permission to create/read/write/index/drop the temporary test database. If your account is restricted to `Stamjer`, skip this optional test or use an already authorized operator account; no new cluster is needed. The test itself reads only `MONGODB_GROUPS_TEST_URI`, never `.env` or `MONGODB_URI`.

To use the connection already selected in step 4:

```powershell
$env:MONGODB_GROUPS_TEST_URI = $groupsBackupUri
try {
    npm run test:groups:mongo
    if ($LASTEXITCODE -ne 0) { throw 'Real MongoDB test failed; investigate before migration' }
} finally {
    Remove-Item Env:MONGODB_GROUPS_TEST_URI -ErrorAction SilentlyContinue
}
```

For a different authorized account, set that dedicated test variable to its existing-cluster URI instead. Keep credentials private. A skipped result means the test did **not** run. If you elect to run it, inspect any failure before continuing. If interrupted or unable to connect for cleanup, a temporary database may remain; remove only the exact generated `stamjer_groups_test_*` database after confirming its identity, never `Stamjer`.

## If something fails

| Problem | Next action |
| --- | --- |
| Backup/restore preview fails or expected collections are missing | Stop before any apply. Correct the backup/recovery preparation, or resume the unchanged previous application and postpone. |
| Migration lists `errors` or unexpected counts | Keep writers stopped. Verify the production target and listed ownership/identity/reference issues, then repeat the preview after resolving them. Do not force apply. |
| Apply fails or final preview still lists updates | Keep production paused. Investigate partial writes and the database target; fix forward and repeat verification, or restore using the procedure below. |
| Bootstrap says the email exists | Choose a different email for the separate developer. |
| Bootstrap says a developer exists | Use that developer and its password-reset flow. |
| Writes return HTTP 503 about transactions | Check the Atlas connection and transaction support; a standalone MongoDB server cannot support these writes. |
| Reset email does not arrive | Check deployed SMTP settings, sender, logs and spam. The public reset response is generic and does not prove delivery. |
| Deployment fails after migration | Keep production paused and fix the new deployment, or restore both database and previous code. Do not resume old unscoped code against migrated multi-group data. |
| Production validation fails | Follow step 13 immediately. |

## Rollback procedure

Rollback uses the **same existing cluster**. Restore the entire pre-migration `Stamjer` database and its matching previous code, with **all writers stopped** throughout. Restoring the database discards every change since the backup. Optionally preserve a separate post-failure dump for investigation; never overwrite the original backup.

1. Repeat step 3 and verify there are no remaining writers. Locate the recorded pre-migration archive, checksum, cluster identity, previous revision and previous environment settings.
2. Open PowerShell in the repository. Ensure `.env` targets that same production cluster. Load the URI and recorded archive path; replace the placeholder below. If recovery requires a different database-user account, use its authorized URI on that same cluster.

```powershell
$groupsBackupUri = node --input-type=module -e "import dotenv from 'dotenv'; dotenv.config({ quiet: true }); process.stdout.write(process.env.MONGODB_URI || '')"
if ($LASTEXITCODE -ne 0 -or -not $groupsBackupUri) { throw 'Could not load production MONGODB_URI' }
$groupsBackupFile = 'REPLACE_WITH_THE_RECORDED_PRE_MIGRATION_ARCHIVE_PATH'
$groupsBackupInfo = Get-Item -LiteralPath $groupsBackupFile -ErrorAction Stop
if ($groupsBackupInfo.Length -le 0) { throw 'Backup is empty; do not clear the database' }
Get-FileHash -LiteralPath $groupsBackupFile -Algorithm SHA256
mongorestore --uri="$groupsBackupUri" --archive="$groupsBackupFile" --gzip --nsInclude='Stamjer.*' --dryRun --verbose
if ($LASTEXITCODE -ne 0) { throw 'Restore preview failed; do not clear the database' }
```

3. Compare the checksum with the recorded value, inspect the preview, and confirm the cluster before continuing. Stop on any mismatch, missing collections or error. The following command **deletes the current `Stamjer` database** before restoring the archive; execute it only for this verified rollback, with all writers still stopped. It explicitly selects `Stamjer`; other databases remain untouched. See [MongoDB's dropDatabase reference](https://www.mongodb.com/docs/manual/reference/method/db.dropdatabase/).

```powershell
mongosh "$groupsBackupUri" --quiet --eval "const result = db.getSiblingDB('Stamjer').dropDatabase(); if (!result.ok) { throw new Error('Could not clear Stamjer'); }"
if ($LASTEXITCODE -ne 0) { throw 'Database clear failed; keep production paused' }
mongorestore --uri="$groupsBackupUri" --archive="$groupsBackupFile" --gzip --nsInclude='Stamjer.*' --stopOnError
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; keep production paused' }
```

Clearing the database first removes collections added after the backup. `mongorestore --drop` alone drops only collections present in the archive and can leave new migration collections behind. The restore command imports documents, collection metadata and indexes; inspect its summary for errors. See [mongorestore options](https://www.mongodb.com/docs/database-tools/mongorestore/).

4. Verify all expected collections, documents and indexes against the backup/dump record. Account for expired session/reset-code TTL records; member/event/history data must match the backup. On restore errors, keep production paused and repair recovery before reopening.
5. Deploy the **recorded matching previous revision** with its previous production settings, preserving the original `TOKEN_SECRET`. Keep public access blocked and old/new extra writers stopped until it is ready.
6. Restore access for immediate checks of the previous application's member/admin login, account data, calendars and history. Re-pause on failure. Once those checks pass, reopen the previous application and its compatible jobs. Record that rollout was rolled back; any developer account or password changes made after the backup will also have been undone.

## Administration after deployment

- Group admins manage regular users in their own group. Only developers grant admin roles or move members.
- New groups need their own email recipients; configure them before using payment/status email flows.
- Attendance overrides produce streepjes when they differ from participation. Totals are calculated, not directly editable.
- Moves preserve status/password/reset code, archive source history, reset the role to `user` and revoke sessions. Only active users join future destination opkomsten. Grant admin separately if needed.
- Database records are curated and credentials are removed. JSON editing is limited to supported user/event/group fields. History/audit/session/reset records and developer identities are read-only.
- Audit stores actor, group, target, action, timestamp and changed field names, not values or credentials. Transactional business writes roll back if audit fails. Email outcomes are separate actions; automation can have a null actor. Session housekeeping is not a separate business audit event.
