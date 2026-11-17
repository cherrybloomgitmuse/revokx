# Directus comparison using automated fixtures
## Scope
The same fixture-creation logic prepared separate Directus 11.4.0 and 11.5.1 databases.
Each fixture contained synthetic record 1, a reader policy restricted to that record, a reader role, and Target/Control users.
Setup verified the configured resources and actual baseline access.
Repeated setup retained resource IDs and reported no setup write attempts.
Setup observations were supplied through terminal output; persistent setup transcripts and complete environment snapshots are not included.
## Experiment
- Event: account suspension.
- Resource: revokx_documents, record 1.
- Access mechanism: session cookie issued before suspension.
- Revocation window: 0 ms.
- Observation period: 2000 ms.
- Poll interval: 100 ms between sequential probe rounds.
- Request timeout: 3000 ms.
- Timing reference: client-validated suspension response.
The same checker and shared observation engine were used for both versions.
## Results
| Observation | Directus 11.4.0 | Directus 11.5.1 |
|---|---|---|
| Baseline verified | Yes | Yes |
| Suspension independently verified | Yes | Yes |
| Target samples | 12 allowed | 14 denied |
| Control samples | 12 allowed | 14 allowed |
| Target restored to Active | Yes | Yes |
| Verdict | FAIL | PASS |
| Exit code | 1 | 0 |
## Evidence
- 11.4.0-automated-setup-suspension.json
- 11.5.1-automated-setup-suspension.json
11.4.0 report timestamp: 2026-11-17T03:42:23.579Z.
11.5.1 report timestamp: 2026-11-16T16:12:10.434Z.
## Interpretation
The tested preserved session returned protected content after verified suspension in 11.4.0.
In 11.5.1, every sampled target request was denied while the control retained document access.
These observations demonstrate a behavior difference for this configured scenario.
## Limitations
- One recorded suspension run per version on automatically prepared fixtures.
- The runs occurred at different times and had different sample counts.
- Sampling was sequential, not concurrent.
- Untested endpoints, tokens, links, caches, and background operations are outside coverage.
- Exact revocation latency was not measured.
- No detection-rate, false-positive-rate, or performance advantage is established.
- Version labels and project selection were checked separately from HTTP requests.
- Reports do not embed image digests, Compose projects, or permission snapshots.
- Matching fixture logic does not establish that every environment setting was identical.
Earlier manually prepared runs remain separate evidence. See FILTER-CORRECTION.md for the earlier item-filter discrepancy.