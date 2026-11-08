# Notes for agents working on htmlboard

## Publishing a release to npm

A version that npm doesn't have yet is published as soon as it reaches `main`. On every push,
`.github/workflows/publish.yml` runs the tests and then publishes if `package.json` has a new version.
It uses npm's trusted publishing (OIDC), so there is no token. npm trusts that file by name: renaming
it means changing the Trusted Publisher in the package's settings on npmjs.com.

1. Start from a clean `main` that is up to date with `origin/main`, and run the tests: `npm test`.
2. Check what goes in the package (no `.env`, no `test/` or `design/`): `npm pack --dry-run`.
3. Bump the version. New features bump the minor version, fixes the patch version:
   `npm version minor` (or `patch`). It commits "x.y.z" and tags `vx.y.z`, like the earlier releases.
   Bump only when the work is ready to go out, because the next push to `main` publishes it.
4. Push the commit and its tag, which publishes: `git push origin main --follow-tags`.
5. Follow the run until it ends: `gh run list --workflow publish.yml --limit 1` gives its id, then
   `gh run watch --exit-status <id>`. If it failed, the version didn't go out: fix the cause and push,
   or `gh run rerun <id>`, and the same version is published.
6. Check the release. The registry can take a few minutes to list a new version:
   `npm view htmlboard version --prefer-online`, then `npx -y --prefer-online htmlboard@x.y.z --version`
   in another folder. Without `--prefer-online`, npm may answer from its cache that the version doesn't exist.
