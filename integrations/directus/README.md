# Directus integration

## Purpose

REVOKX checks whether a preserved session can read a synthetic document after account suspension.

The experiment uses the shared observation engine, verifies suspension independently, checks an unaffected control, and restores the target account.

Setup automation prepares the lab fixture and verifies baseline access.

## Prerequisites

- Node.js: tested with 24.18.1.
- Docker Desktop running Linux containers, with Docker Compose available.
- PowerShell on Windows.
- Commands below run from the REVOKX repository root.

Install locked project dependencies:

```powershell
npm.cmd ci
```

## Local credentials

For a new checkout without integrations/directus/.env:

```powershell
node .\integrations\directus\create-env.js
```

The generator creates DIRECTUS_SECRET and DIRECTUS_ADMIN_PASSWORD and refuses to overwrite an existing file.

Keep an existing .env when reusing an initialized database.

ADMIN_PASSWORD initializes the first administrator; editing .env does not reset an existing account password.

Do not commit or share .env.

## Instance selection

| Target | Setup command | Experiment command | Compose project | Version |
|---|---|---|---|---|
| Automated original lab | node integrations/directus/setup.js original | node integrations/directus/run.js setup-original | revokx-directus-setup-original | 11.4.0 |
| Automated patched lab | node integrations/directus/setup.js patched | node integrations/directus/run.js setup | revokx-directus-setup | 11.5.1 |

Omitting the setup selection defaults to patched.

The runner's original and patched options retain the earlier manually configured experiment projects.

All HTTP requests use http://127.0.0.1:8055. Only the intended instance should expose this port.

## Stop earlier experiment instances

If the earlier manually configured instances are running, stop them before starting a disposable lab:

```powershell
docker compose -f .\integrations\directus\compose.yaml stop
docker compose -f .\integrations\directus\compose.patched.yaml stop
```

These commands preserve database volumes.

## Patched disposable lab

Generate a local override for separate database and upload volumes. This creates the override on first use and preserves it on subsequent runs.

```powershell
$overridePath = ".\integrations\directus\compose.setup.yaml"
if (-not (Test-Path $overridePath)) {
    $suffix = [guid]::NewGuid().ToString("N")
    @(
        "volumes:"
        "  database:"
        "    name: revokx-setup-fresh-db-$suffix"
        "  uploads:"
        "    name: revokx-setup-fresh-uploads-$suffix"
    ) | Set-Content -Path $overridePath -Encoding ascii
}
$pattern = "/integrations/directus/compose.setup.yaml"
if (@(Get-Content .git/info/exclude) -notcontains $pattern) {
    Add-Content .git/info/exclude $pattern
}
```

The override is local configuration and is not committed. Do not regenerate it when intending to reuse the same database.

Stop the automated original instance if it is running:

```powershell
docker compose -p revokx-directus-setup-original -f .\integrations\directus\compose.yaml stop
```

Validate and start the patched lab:

```powershell
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml config --quiet
if ($LASTEXITCODE -ne 0) { throw "Compose validation failed" }
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml up -d
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml logs --tail 30 directus
```

Wait for the server-started message, then verify:

```powershell
curl.exe -I "http://127.0.0.1:8055/admin"
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml exec -T directus node -p "require('/directus/package.json').version"
```

Expected: HTTP 200 and version 11.5.1.

## Original disposable lab

If the automated patched lab is running, stop it:

```powershell
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml stop
```

Start the original lab using its separate project:

```powershell
docker compose -p revokx-directus-setup-original -f .\integrations\directus\compose.yaml up -d
docker compose -p revokx-directus-setup-original -f .\integrations\directus\compose.yaml logs --tail 30 directus
```

Wait for the server-started message, then verify:

```powershell
curl.exe -I "http://127.0.0.1:8055/admin"
docker compose -p revokx-directus-setup-original -f .\integrations\directus\compose.yaml exec -T directus node -p "require('/directus/package.json').version"
```

Expected: HTTP 200 and version 11.4.0.

The original disposable project uses its own database and upload volumes. Starting an existing project reuses its data; it does not create a fresh database each time.

The HTTP page check alone does not verify fixture permissions.

## Run setup and verify reuse

ADMIN is admin@example.com. On a fresh database, use DIRECTUS_ADMIN_PASSWORD from the local .env.

TARGET and CONTROL use target@example.com and control@example.com.

Choose separate, non-empty passwords for these accounts and retain them locally for subsequent runs. Existing passwords are not reset.

Set $setupSelection to original or patched to match the running disposable instance.

```powershell
$setupSelection = "original"
try {
    foreach ($account in @("ADMIN", "TARGET", "CONTROL")) {
        $securePassword = Read-Host "$account password" -AsSecureString
        $credential = [System.Net.NetworkCredential]::new("", $securePassword)
        [Environment]::SetEnvironmentVariable("REVOKX_${account}_PASSWORD", $credential.Password, "Process")
        Remove-Variable credential, securePassword -ErrorAction SilentlyContinue
    }
    Write-Host "SETUP RUN"
    node .\integrations\directus\setup.js $setupSelection
    if ($LASTEXITCODE -ne 0) { throw "Setup failed; inspect its output" }
    Write-Host "REUSE RUN"
    node .\integrations\directus\setup.js $setupSelection
    if ($LASTEXITCODE -ne 0) { throw "Reuse verification failed; inspect its output" }
}
finally {
    foreach ($account in @("ADMIN", "TARGET", "CONTROL")) {
        [Environment]::SetEnvironmentVariable("REVOKX_${account}_PASSWORD", $null, "Process")
    }
    Remove-Variable credential, securePassword -ErrorAction SilentlyContinue
}
```

## Setup behavior

1. Authenticate the administrator.
2. Create or verify the collection and synthetic record 1.
3. Create or verify the reader policy and restricted read permission.
4. Create or verify the reader role and policy assignment.
5. Create or verify Target and Control accounts.
6. Verify exact document content for both accounts and request denial for anonymous access.

Matching resources are reused. Conflicts stop the affected stage instead of silently overwriting configuration.

Setup is not transactional: completed resources remain if a later stage fails.

The output retains prerequisite results and attempted writes.

A MATCH result requires verified baseline access. It is not a revocation-test verdict.

The setup command does not suspend users.

## Run the suspension experiment

Use setup-original for the automated 11.4.0 lab or setup for the automated 11.5.1 lab.

Enter the credentials belonging to the selected database. Target and Control must initially be Active.

```powershell
$experimentSelection = "setup-original"
try {
    foreach ($account in @("ADMIN", "TARGET", "CONTROL")) {
        $securePassword = Read-Host "$account password" -AsSecureString
        $credential = [System.Net.NetworkCredential]::new("", $securePassword)
        [Environment]::SetEnvironmentVariable("REVOKX_${account}_PASSWORD", $credential.Password, "Process")
        Remove-Variable credential, securePassword -ErrorAction SilentlyContinue
    }
    node .\integrations\directus\run.js $experimentSelection
    Write-Host "Experiment exit code: $LASTEXITCODE"
}
finally {
    foreach ($account in @("ADMIN", "TARGET", "CONTROL")) {
        [Environment]::SetEnvironmentVariable("REVOKX_${account}_PASSWORD", $null, "Process")
    }
    Remove-Variable credential, securePassword -ErrorAction SilentlyContinue
}
```

The experiment suspends the target, probes preserved-session access, checks the control, and attempts to restore the target to Active.

Inspect cleanup results even when a policy violation is detected.

Exit codes:
- 0: observed policy satisfied and cleanup verified.
- 1: observed policy violation.
- 2: inconclusive result or operational failure.

Reports are saved under reports/directus.

## Observed live results

Fresh automated setup and reuse have been verified on both 11.4.0 and 11.5.1.

On each version, the first setup run created the collection, document, policy, permission, role, and users.

Subsequent runs retained the same IDs and reported no setup write attempts.

Both versions verified Target and Control document access and anonymous denial before suspension.

Logins may create sessions even when there are no setup writes.

Setup observations were supplied through terminal output. Setup transcripts have not yet been saved as repository evidence.

The recorded suspension comparison on automatically prepared fixtures found:
- 11.4.0: protected content returned in 12 target samples; control access retained.
- 11.5.1: access denied in 14 target samples; control access retained.
- Both runs verified suspension and successful restoration of the target.

See [automated comparison](../../evidence/directus/AUTOMATED-COMPARISON.md) for reports, timing, and limitations.

## Tests

```powershell
npm.cmd test
```

The recorded local suite passed 131 tests at this checkpoint.

Automated tests use controlled fixtures and mocks; they do not substitute for live Directus verification.

## Stop the labs

```powershell
docker compose -p revokx-directus-setup-original -f .\integrations\directus\compose.yaml stop
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml stop
```

The patched command requires the local override file.

Volumes remain available for reuse.

## Evidence and limitations

Recorded suspension reports are under evidence/directus.

FILTER-CORRECTION.md documents the item-filter correction in the earlier manually configured patched lab.

Only tested document/session paths support the recorded security conclusions.

The automated comparison contains one recorded suspension run per version. It does not establish detection rates or complete coverage.

Version lookup uses the selected Compose project separately from HTTP requests. The launcher does not cryptographically bind that container to the HTTP endpoint.

Saved experiment reports do not embed the Compose project, image digest, or permission snapshot.

Setup time, resource consumption, concurrency, and comparative integration effort have not been measured.

Directus images are digest-pinned; the nginx image is still tag-pinned.