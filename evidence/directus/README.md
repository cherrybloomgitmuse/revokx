# Directus account-suspension experiment
## Scope
REVOKX tested access to synthetic record `1` in `revokx_documents` using a session cookie issued before account suspension.
The target and an unaffected control user could read the same document before suspension. Anonymous access was denied.
## Method
1. Log in as the administrator, target, and control.
2. Verify the users and document-access baseline.
3. Suspend the target through the administrator API.
4. Independently read the target's status to verify suspension.
5. Replay the preserved target and control sessions using the shared `observeAccess` engine.
6. Restore the target to Active and verify restoration.
The client did not refresh the preserved session cookies.
Protected document content was compared with the baseline. Recognized error-only responses were classified as denied; unexpected responses remained inconclusive.
## Configuration
- Local Docker deployment with separate databases for the two versions.
- Synthetic data only.
- Document endpoint: `/items/revokx_documents/1?fields=id,title,content`.
- Event: account suspension.
- Configured revocation window: 0 ms.
- Observation period: 2000 ms.
- Poll interval: 100 ms between sequential probe rounds.
- Request timeout: 3000 ms.
- Timing reference: client consumption and validation of the suspension response.
The zero-millisecond window is the experiment's configured policy, not a universal application guarantee.
## Observed results
| Version | Target samples | Control samples | Verdict | Cleanup |
|---|---|---|---|---|
| 11.4.0 | 11 allowed | 10 allowed | FAIL | Target restored |
| 11.5.1 | 14 denied | 14 allowed | PASS | Target restored |
Baseline and suspension verification succeeded in both runs.
The recorded runs occurred on 2026-11-16. Exact UTC timestamps and observations are retained in the JSON reports.
## Evidence
- `11.4.0-account-suspension.json`
- `11.5.1-account-suspension.json`
These are unchanged copies of the generated reports.
## Interpretation and limitations
The 11.4.0 run demonstrated protected-content access through the tested session after verified suspension.
The 11.5.1 run satisfied the configured policy for the sampled requests while retaining the control user's document access.
These results cover one document endpoint and session-cookie access. They do not establish complete revocation across other endpoints, tokens, links, caches, or background operations.
Requests were sequential, not concurrent. Access between samples was not observed.
The first patched target probe started about 42.91 ms after the timing reference. This is not an exact revocation-latency measurement.
Only one automated run per version is recorded here. Detection rates, false-positive rates, and performance advantages have not been established.
## Version notes
Directus 11.5.0 failed to start in this SQLite setup because its image lacked the required native binding. The successful comparison used 11.5.1.
The launcher selects the Compose file explicitly and reads the running Directus version. Version selection does not determine the test verdict.