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
## Disposable instance
The setup launcher currently expects:
- Compose project: revokx-directus-setup
- Directus version: 11.5.1
- HTTP origin: http://127.0.0.1:8055
Only one lab instance should own host port 8055.
If either experiment instance is currently running, stop it before starting the disposable instance:
```powershell
docker compose -f .\integrations\directus\compose.yaml stop
docker compose -f .\integrations\directus\compose.patched.yaml stop
```
These commands preserve database volumes.
## Generate the local volume override
This block creates fresh named volumes on first use and reuses the existing override on later runs.
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
The override is local configuration and is not committed.
Do not regenerate it when intending to reuse the same database.
## Start and inspect
```powershell
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml config --quiet
if ($LASTEXITCODE -ne 0) { throw "Compose validation failed" }
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml up -d
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml logs --tail 30 directus
```
Wait for the Directus server-started message, then check:
```powershell
curl.exe -I "http://127.0.0.1:8055/admin"
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml exec -T directus node -p "require('/directus/package.json').version"
```
Expected: HTTP 200 and version 11.5.1.
The HTTP page check alone does not verify fixture permissions.
## Run complete setup and verify reuse
ADMIN is admin@example.com. On a fresh database, use DIRECTUS_ADMIN_PASSWORD from the local .env.
TARGET and CONTROL use target@example.com and control@example.com.
Choose separate, non-empty passwords for these accounts and retain them locally for subsequent runs.
Existing passwords are not reset by setup.
```powershell
try {
    foreach ($account in @("ADMIN", "TARGET", "CONTROL")) {
        $securePassword = Read-Host "$account password" -AsSecureString
        $credential = [System.Net.NetworkCredential]::new("", $securePassword)
        [Environment]::SetEnvironmentVariable("REVOKX_${account}_PASSWORD", $credential.Password, "Process")
        Remove-Variable credential, securePassword -ErrorAction SilentlyContinue
    }
    Write-Host "SETUP RUN"
    node .\integrations\directus\setup.js
    if ($LASTEXITCODE -ne 0) { throw "Setup failed; inspect its output" }
    Write-Host "REUSE RUN"
    node .\integrations\directus\setup.js
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
A MATCH result requires verified baseline access.
The setup command does not suspend users.
## Observed live results
Fresh-database setup on Directus 11.5.1 created the collection, document, policy, permission, role, and users.
A subsequent run retained the same IDs and reported no setup write attempts.
Both runs verified Target and Control access and anonymous denial.
Logins may create sessions even when there are no setup writes.
These observations were supplied through terminal output. Setup transcripts have not yet been saved as repository evidence.
## Tests
```powershell
npm.cmd test
```
The recorded local suite passed 124 tests at this checkpoint.
Automated tests use controlled fixtures and mocks; they do not substitute for live Directus verification.
## Stop the disposable instance
```powershell
docker compose -p revokx-directus-setup -f .\integrations\directus\compose.patched.yaml -f .\integrations\directus\compose.setup.yaml stop
```
Volumes remain available for reuse.
## Experiment evidence and limitations
Existing suspension reports and their interpretation are under evidence/directus.
FILTER-CORRECTION.md records the item-filter correction and additional 11.5.1 run.
Fresh automated setup has been verified on 11.5.1, not 11.4.0.
The suspension runner currently selects the original or patched experiment project, not the disposable setup project.
Do not use run.js patched to label an experiment against the disposable instance.
The setup launcher checks the disposable container version separately from its HTTP requests; it does not cryptographically bind that container to the HTTP endpoint.
Only tested document/session paths support the recorded security conclusions.
Setup time, resource consumption, concurrency, and comparative integration effort have not been measured.
Directus images are digest-pinned; the nginx image is still tag-pinned.