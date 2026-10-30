# FIRST Fantasy League development

Read this file before making changes. Use `README.md` and `docs/DEVELOPERS.md` for the build and deployment workflow; league access is documented in `docs/LEAGUES.md`.

## Current FRC setup

- Prepare San Diego FRC on private staging for the **2027 season**. The intended pool is all San Diego Regional participants.
- Use **2026 REBUILT qualification results** for initial OPR-based Pollen prices. Historical prices are not earned 2027 points.
- Clearly distinguish the confirmed 2027 participant list from a provisional 2026 field. Do not invent teams, registrations, match scores, or OPR values.
- FRC drafting proposes 15 Pollen, one to three teams, and whole-number costs. Keep FTC data, rosters, prices, and deployment settings isolated.
- Explain the season, pricing source, scoring rule, and data status on the FRC page.

## Implementation and verification

- Maintain readable modules in `src/` and browser assets in `web/`; never hand-edit generated `dist/` bundles.
- Keep provider credentials in Cloudflare/GitHub secrets. Do not commit tokens or display them in logs or browser responses.
- Enforce membership, administrator privileges, budget, eligibility, and roster ownership on the server. An administrator may switch regions; moderators and players remain assigned to their home league.
- Preserve saved roster prices. Repeated syncs and submissions must not double-count points or duplicate entries.
- Use meaningful local fixtures for calculations, access control, migrations, and submission behavior. Run `npm run format:check`, `npm run check`, and `npm test` before pushing functional changes.
- Check changed browser flows at desktop and mobile sizes. Use clearly identified fixtures; do not submit or alter real participant entries for testing.

## GitHub and releases

- Push completed changes to GitHub, as requested by the owner. Use the existing repository; do not create replacement repositories or forks for routine work.
- The project name is **FIRST Fantasy League**; the requested repository slug is `first-fantasy-league`. A repository rename does not authorize changing Cloudflare hostnames, databases, or secrets.
- Push private testing changes to `staging`. Keep this FRC rollout on staging for review; publish to production only when the user requests that release.
- Report external access or credential blockers accurately, together with what is already working and pushed.
