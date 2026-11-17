# REVOKX evidence dashboard
## Start
From the repository root, run:
npm run dashboard
Open http://127.0.0.1:3001.
Stop the server with Ctrl+C.
Docker is not required for viewing saved evidence.
## Features
- Default view: sequential Directus repeat runs.
- Version cards show recorded PASS, FAIL, and INCONCLUSIVE counts.
- Select a run to inspect baseline, suspension, cleanup, and access-path results.
- The observation table shows request start and completion times.
- Select All saved Directus runs to include earlier experiments.
- Reload evidence reads the saved files again.
## Data source
The dashboard reads individual JSON reports under evidence/directus recursively.
Repeat summaries are excluded from run counts.
Files under reports/directus are not displayed until deliberately copied into evidence.
The dashboard does not modify evidence, collect credentials, or launch experiments.
## Interpretation
PASS applies to the recorded access paths and observation window.
Counts describe saved experiments, not a general detection rate.
Earlier experiments may have different configurations; consult their accompanying evidence notes.
Observation timestamps do not establish exact revocation latency.
## Manual verification
Verified run selection, evidence-set switching, and reloading.
The repeat view displayed five FAIL results for 11.4.0 and five PASS results for 11.5.1.
