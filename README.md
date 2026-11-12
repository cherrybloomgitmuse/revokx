# REVOKX
REVOKX tests whether a removed team member can still retrieve protected content using an existing authenticated session.

The current implementation includes a controlled Express application, vulnerable and fixed authorization behaviour, repeated access checks, automated tests, and JSON reports.

Remaining logged in after team removal is permitted in this scenario. Access to the team's protected file must be denied.

## Current experiment

The checker:

1. Logs in as the owner, target member, and remaining member.
2. Confirms initial membership and access to the same protected file.
3. Removes the target using the owner's credentials.
4. Independently checks the membership list to confirm removal.
5. Reuses the existing sessions to repeatedly check access.
6. Checks that the owner and remaining member retain file access.
7. Checks that the removed member remains authenticated.

The vulnerable implementation caches team access in the session and continues trusting that cached permission after removal.

The fixed implementation checks current membership when handling file requests.

## Requirements

- Node.js 24.18.1 — the version used in the verified Windows CI workflow.
- npm.
- Git, if cloning the repository.

The application uses Express and express-session. Dependencies are recorded in package-lock.json.

## Setup on Windows

Run in PowerShell:

```powershell
git clone https://github.com/cherrybloomgitmuse/revokx.git
Set-Location revokx
npm.cmd ci
npm.cmd test
```

Access to the repository is required if it is private.

If the project already exists on your computer, open its folder and run:

```powershell
npm.cmd ci
npm.cmd test
```

## Run the experiments

```powershell
node demo/run-check.js fixed
```

Expected result: PASS.

```powershell
node demo/run-check.js vulnerable
```

Expected result: FAIL with reason PROTECTED_CONTENT_AFTER_REMOVAL.

Each command starts an isolated demo instance on an available loopback port and stops it afterward. A separately running demo server is not required.

| Check | Fixed | Vulnerable |
| --- | --- | --- |
| Removed member's file access | Denied | Allowed |
| Owner's file access | Allowed | Allowed |
| Remaining member's file access | Allowed | Allowed |
| Removed member's authentication | Retained | Retained |
| Overall verdict | PASS | FAIL |

The vulnerable experiment intentionally exits with code 1. This indicates a detected policy violation.

Automated tests that successfully reproduce this vulnerability still pass: their expected result is detection of the failure.

## Verdicts and exit codes

| Verdict | Exit code | Meaning |
| --- | --- | --- |
| PASS | 0 | Observed checks satisfied the configured policy |
| FAIL | 1 | A definite policy violation was observed |
| INCONCLUSIVE | 2 | The checker could not establish a reliable result |

The launcher also exits with code 2 for operational failures, such as failure to save a report.

The checker compares returned file identifiers and content with the baseline fixture. Receiving an HTTP error does not automatically prove that protected content was withheld.

Unexpected responses and request errors are treated as inconclusive. A confirmed violation is not erased by later inconclusive observations.

## Timing policy

The default experiment uses:

| Setting | Value |
| --- | --- |
| Allowed revocation window | 0 ms |
| Observation duration | 1000 ms |
| Delay between polling rounds | 100 ms |
| HTTP request timeout | 1500 ms |

These values define this experiment's policy; they are not universal security requirements.

The timing reference is recorded after the client receives, parses, and validates the removal response. It is reported as CLIENT_VALIDATED_REMOVAL_RESPONSE.

This is not a measurement of the server's exact permission-change commit time.

Checks run sequentially. The polling delay is added between rounds, so actual gaps include request processing time.

A request's start time determines whether it is eligible for the revocation deadline check. Requests started before the observation period ends may finish afterward.

## Reports

The demo launcher saves JSON reports in reports/.

Reports include:

- Demo mode and report creation time.
- Overall verdict and reason.
- Membership verification result.
- Target and control outcomes.
- Timing settings and reference.
- Per-path verdicts.
- Individual probe start times, end times, and outcomes.

The supplied checker does not include session cookies, CSRF tokens, or protected file content in its report.

The report writer is not a general-purpose secret redactor.

Generated reports are excluded from Git.

## Project structure

| Path | Purpose |
| --- | --- |
| demo/app.js | Express application setup |
| demo/auth.js | Demo login, sessions, and logout |
| demo/team.js | Membership and protected file routes |
| demo/server.js | Manual demo server |
| demo/check.js | Demo-specific setup, removal, and response checks |
| demo/run-check.js | Experiment launcher and cleanup |
| src/observe.js | Repeated probing and timing-based verdicts |
| src/report.js | JSON report persistence |
| test/ | Automated regression tests |
| .github/workflows/test.yml | Windows CI workflow |

## Continuous integration

GitHub Actions runs on pushes and pull requests and can also be started manually.

The workflow:

1. Installs locked dependencies.
2. Runs the automated tests.
3. Runs the fixed demo.
4. Uploads available JSON reports.

Report artifacts are retained for seven days.

The Windows workflow has completed successfully, and its saved fixed-demo report has been manually checked.

A passing workflow does not automatically block merges. Required branch checks must be configured separately.

## Limitations

- This is a controlled, synthetic application with in-memory state and known test accounts.
- The current experiment covers session-based access to one protected file route.
- It does not yet test refresh tokens, saved download links, invitations, or concurrent requests during removal.
- The checker does not discover endpoints automatically.
- Polling can miss access leaks between observations.
- PASS applies only to the configured paths and observations in that run.
- The experiment does not measure exact revocation latency.
- In-progress transfers and previously downloaded copies are outside scope.
- Demo orchestration is application-specific. Cross-application reuse has not yet been demonstrated.
- No independent application vulnerability or performance advantage has been validated.

The demo binds to loopback. Do not expose the intentionally vulnerable application publicly.

## Planned next validation

Integrate the observer with an independently developed application in an authorized local environment.

The objective is to demonstrate a reproducible permission-revocation failure, verify its correction, and preserve legitimate access without rewriting the observation engine.

This integration is planned, not implemented.