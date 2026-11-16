# Suspension experiment after automated setup
## Environment and preparation
- Directus version: 11.5.1.
- Compose project: revokx-directus-setup.
- Separate database and upload volumes selected through a local override.
- Setup created the synthetic collection, record, restricted reader policy, role, and Target/Control users.
- A second setup run retained the same IDs and reported no setup write attempts.
- Both setup runs verified Target/Control document access and anonymous denial.
Setup observations were captured in terminal output, not saved setup-report files.
## Experiment
Command: node integrations/directus/run.js setup
Evidence: 11.5.1-automated-setup-suspension.json
Report timestamp: 2026-11-16T16:12:10.434Z
- Event: account suspension.
- Resource: revokx_documents, record 1.
- Preserved access mechanism: session cookie issued before suspension.
- Configured revocation window: 0 ms.
- Observation period: 2000 ms.
- Baseline verified: true.
- Suspension independently verified: true.
- Target: 14 sampled requests denied.
- Control: 14 sampled requests returned protected content.
- Cleanup: target restored to Active.
- Verdict: PASS.
- Exit code: 0.
## Timing and coverage
The first target probe started approximately 29.61 ms after the client validated the suspension response. This is not an exact revocation-latency measurement.
The final control request started within the observation period and completed at approximately 2010.00 ms. The observer limits request start times, not completion times.
Results cover the sampled document/session requests, not every possible access path or the intervals between samples.
## Evidence limits
The saved report records application version and observations. It does not embed the Compose project, image digest, or permission snapshot.
The setup-instance selection was recorded in launcher output and is documented here.
This run demonstrates the setup-to-experiment workflow on 11.5.1. An equivalent automatically prepared 11.4.0 comparison remains pending.
No setup-time improvement, detection rate, or performance advantage is claimed.