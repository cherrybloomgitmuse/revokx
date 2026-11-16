# Item-filter correction and additional run
## Configuration observation
After the initial Directus 11.5.1 experiment, inspection found no item filter on the reader permission.
Readable fields were id, title, and content, but access was not restricted to record 1.
The 11.4.0 item-filter configuration has not yet been independently inspected.
## Correction
The 11.5.1 permission was restricted to id Equals 1.
API inspection confirmed the saved filter.
## Additional automated run
- Version: 11.5.1
- Report timestamp: 2026-11-16T07:04:24.066Z
- Evidence: 11.5.1-account-suspension-id-filter.json
- Baseline and suspension verified: true
- Target: 12 sampled requests denied
- Control: 12 sampled requests returned protected content
- Observation period: 2000 ms
- Configured revocation window: 0 ms
- Target restored to Active: true
- Verdict: PASS
- Exit code: 0
## Limitations
This was not an identical-configuration repeat because the item filter changed.
Previous reports remain unchanged.
Identical permission configuration across versions has not been established.
The report does not embed the filter; it was verified separately through API inspection.
Exact revocation latency, untested access paths, and concurrency remain outside these results.