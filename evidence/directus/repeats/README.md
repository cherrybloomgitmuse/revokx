# Directus sequential repeat runs
## Recorded results
| Version | Runs | PASS | FAIL | INCONCLUSIVE |
|---|---:|---:|---:|---:|
| 11.4.0 | 5 | 0 | 5 | 0 |
| 11.5.1 | 5 | 5 | 0 | 0 |
All ten runs verified the baseline, account suspension, and restoration of the target account.
The local test suite passed 136 tests before these experiments.
## Procedure
Each version was tested in five sequential runs against its automatically prepared lab.
Each run acquired fresh sessions and preserved the target session across account suspension.
The configured revocation window was 0 ms, observation period 2000 ms, polling interval 100 ms, and request timeout 3000 ms.
The original-version batch ran before the patched-version batch.
## Evidence
Each version directory contains five individual reports and summary.json.
Copies were verified against their source files using file hashes.
Summary reportPath values retain their original local paths. Match their filenames to the reports in the same evidence directory.
Individual reports contain the observations; summaries contain run outcomes and verification flags.
## Exit codes
Individual experiment exit codes: 0 for PASS with verified cleanup, 1 for FAIL, and 2 for an incomplete or operationally unsuccessful result.
Repeat launcher exit code 0 means all requested runs completed and matched the configured expected verdict.
For 11.4.0, that expected verdict was FAIL. Launcher success does not change those findings into PASS.
## Interpretation and limits
The observed outcomes repeated across five sequential runs per version for this document-session access path.
These are local repeatability observations, not a general detection rate or proof that every access path is covered.
Runs reused each version's database; they were not independent fresh-database experiments.
The two batches ran at different times.
durationMs measures the entire runner call, not revocation latency.
Finite polling does not establish behavior between observations or exact revocation latency.
The reports do not embed permission snapshots or image digests.
Earlier evidence remains unchanged.
