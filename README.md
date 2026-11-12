# REVOKX

REVOKX investigates whether permission removal is enforced when previously issued credentials are reused.

The current experiment tests two access mechanisms in a controlled Express application:

- An existing authenticated session.
- A bearer download link issued before team membership removal.

It includes vulnerable and fixed implementations, repeated HTTP probes, legitimate-user controls, automated regression tests, and JSON reports.

A PASS applies only to the configured checks and observations in that run. It does not establish that all possible access paths are secure.

## Current experiment

The checker:

1. Logs in as the owner, target member, and remaining member.
2. Confirms initial membership and access to the protected file.
3. Issues download links for all three users.
4. Confirms that these links return the expected content without cookies.
5. Removes the target member.
6. Independently reads the membership list to confirm removal.
7. Reuses the original sessions and saved links during repeated checks.
8. Checks that legitimate users retain access and the target remains authenticated.

Remaining logged in after team removal is permitted by this scenario. Access to the team's protected content must be denied.

## Vulnerable and fixed behaviour

The vulnerable session route trusts a permission cached before removal. The vulnerable download route trusts a previously issued link without checking the issuing member's current membership.

The fixed implementation checks current membership for both access mechanisms.

| Configured check | Fixed mode | Vulnerable mode |
| --- | --- | --- |
| Target session: file access | Denied | Allowed |
| Target saved link: file access | Denied | Allowed |
| Owner session: file access | Allowed | Allowed |
| Owner saved link: file access | Allowed | Allowed |
| Remaining member session: file access | Allowed | Allowed |
| Remaining member saved link: file access | Allowed | Allowed |
| Target session: authentication | Retained | Retained |
| Overall verdict | PASS | FAIL |

These are seven configured checks, not seven independent endpoints.

## Bearer-link policy

Anyone possessing a valid download link can use it without a login cookie.

Each link is associated with the member who requested it. Under this experiment's fixed policy, removing that member prevents further downloads through their existing links.

Both modes prevent removed members from issuing new links.

Tokens are generated using 32 random bytes. The demo stores SHA-256 hashes of the tokens rather than the raw tokens.

Links exist only within the demo process's in-memory state. Expiration, individual link revocation, and membership re-addition behaviour are not tested.

These are application-issued tokens, not S3 presigned URLs.

## Requirements

- Node.js 24.18.1, used by the verified Windows CI workflow.
- npm.
- Git, if cloning the repository.

Dependencies are recorded in package-lock.json.

## Windows setup

Run in PowerShell:

```powershell
git clone https://github.com/cherrybloomgitmuse/revokx.git
Set-Location revokx
npm.cmd ci
npm.cmd test
```

Repository access is required if it is private.

For an existing checkout, open its folder and run:

```powershell
npm.cmd ci
npm.cmd test
```

## Run the experiments

Fixed implementation:

```powershell
node demo/run-check.js fixed
```

Expected: PASS, with targetAccess and targetLinkAccess both denied.

Vulnerable implementation:

```powershell
node demo/run-check.js vulnerable
```

Expected: FAIL with reason PROTECTED_CONTENT_AFTER_REMOVAL. Both target access mechanisms return protected content.

Each command starts a fresh demo instance on an available loopback port and stops it afterward. A separate server terminal is not required.

The vulnerable command intentionally exits with code 1. This means the checker detected a policy violation.

Tests that correctly reproduce vulnerable behaviour pass because detection is their expected outcome.

## Verdicts and exit codes

| Verdict | Exit code | Meaning |
| --- | --- | --- |
| PASS | 0 | Observed checks satisfied the configured policy |
| FAIL | 1 | A definite policy violation was observed |
| INCONCLUSIVE | 2 | The checker could not establish a reliable result |

Operational failures, including report-writing failures, also produce exit code 2.

The checker compares file identifiers and content against the baseline fixture. Returning the expected protected content establishes access even if the HTTP status indicates an error.

Unexpected responses, request errors, and missing eligible observations do not establish successful revocation.

A confirmed violation is not erased by later inconclusive observations.

## Timing

Default settings:

| Setting | Value |
| --- | --- |
| Allowed revocation window | 0 ms |
| Observation duration | 1000 ms |
| Delay between polling rounds | 100 ms |
| HTTP request timeout | 1500 ms |

These values define the demo's policy, not a universal security requirement.

The reference is recorded after the client receives, parses, and validates the removal response. Reports identify it as CLIENT_VALIDATED_REMOVAL_RESPONSE.

It is not the server's exact permission-change commit time.

Probes run sequentially. Actual gaps include request processing time and the delay between rounds.

Request start times determine deadline eligibility. Requests started before the observation period ends may finish afterward.

The first denied probe does not establish the exact revocation time. Access may change between observations or reappear later.

## Reports

The launcher writes separate JSON files to reports/.

Each report contains:

- Report creation time and demo mode.
- Overall verdict and reason.
- Membership verification result.
- Session and saved-link access summaries.
- Timing settings and reference.
- Per-check verdicts and eligible sample counts.
- Probe start times, end times, and outcomes.

The supplied checker excludes session cookies, CSRF tokens, bearer links, and protected file content from its reports.

The report writer itself is not a general-purpose secret redactor.

Generated reports are excluded from Git.

## Automated tests

The current suite contains 37 tests. A complete local Windows run passed all 37.

Tests cover:

- Authentication, session rotation, and logout.
- Membership removal and legitimate-user controls.
- Vulnerable and fixed file access.
- Bearer downloads without cookies.
- Preserved links after removal.
- Invalid link tokens and unauthorized link creation.
- Checker reuse of links issued before removal.
- Exclusion of captured bearer tokens from checker reports.
- Timing boundaries and inconclusive outcomes.
- Protected content returned with misleading HTTP statuses.
- JSON report persistence and write failures.

Test counts describe the regression suite, not complete security coverage.

## Project structure

| Path | Purpose |
| --- | --- |
| demo/app.js | Express application setup |
| demo/auth.js | Demo login, sessions, and logout |
| demo/team.js | Membership, file access, and bearer links |
| demo/server.js | Manual demo server |
| demo/check.js | Application-specific experiment orchestration |
| demo/run-check.js | Experiment launcher and cleanup |
| src/observe.js | Repeated probing and timing-based verdicts |
| src/report.js | JSON report persistence |
| test/ | Automated regression tests |
| .github/workflows/test.yml | Windows CI workflow |

## Continuous integration

GitHub Actions runs on pushes and pull requests and supports manual execution.

The workflow installs locked dependencies, runs the automated tests, runs the fixed demo, and uploads available reports.

Report artifacts are retained for seven days.

The updated Windows workflow has passed. Its downloaded fixed-demo report was checked to confirm targetLinkAccess was denied.

Required branch checks must be configured separately to block merges.

## Limitations

- The application is synthetic, with known test accounts and in-memory state.
- The experiment covers one protected file through session and bearer-link access.
- Endpoints are configured manually; automatic discovery is not implemented.
- Polling may miss access leaks between observations.
- Untested endpoints, caches, background jobs, and alternative credentials remain outside demonstrated coverage.
- Access/refresh-token flows, invitations, and concurrent requests during removal are not yet tested.
- Exact revocation latency and performance advantages have not been established.
- In-progress transfers and previously downloaded copies are outside scope.
- Application-specific orchestration remains in demo/check.js.
- Cross-application reusability and independent real-world validation have not yet been demonstrated.

The demo binds to loopback. Do not expose the deliberately vulnerable application publicly.

## Planned validation

Integrate with an independently developed application in an authorized local environment.

The objective is to reproduce a permission-revocation failure, verify its correction, and preserve legitimate users' access while reusing the observation engine.

This integration is planned, not implemented.