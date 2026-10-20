# research — the system as it is

| Document | What it describes |
|---|---|
| [architecture.md](architecture.md) | what exists, the module map, the consumers |
| [module_tests.md](module_tests.md) | the test harness, the flow catalogue, what it does not prove |
| [PLAN_publish_to_github_packages.md](PLAN_publish_to_github_packages.md) | IMPLEMENTED 2026-10-17: why the kit publishes to GitHub Packages with an artifact attestation, what 0.1.1 observed, and its open tail |
| [PLAN_split_the_publish_job.md](PLAN_split_the_publish_job.md) | IMPLEMENTED 2026-10-20: release.yml builds and tests unprivileged, then attests and publishes the one artifact in a job that runs no dependency code; first observed in release run 39481672054 |
| [PLAN_kit_components_storybook.md](PLAN_kit_components_storybook.md) | IMPLEMENTED 2026-10-20: the components entry (Tabs, DataTable, RecommendationCard), their stylesheet, the Storybook, the axe, contrast and layout checks, and the reveal contract as security-reviewed; released as 0.2.0 |
