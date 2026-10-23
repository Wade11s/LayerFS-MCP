# GitHub -> npm automated publishing

[中文](../RELEASING.md) · **English** · [Docs index](README.md)

GitHub repository: <https://github.com/Wade11s/LayerFS-MCP>. The local `origin` is `git@github.com:Wade11s/LayerFS-MCP.git`.

`.github/workflows/publish.yml` runs on every push to `main` and can be re-run manually from Actions. It publishes only a stable version that is not yet on npm and is higher than npm's `latest`, and it can promote a placeholder prerelease. After checks, tests and the packaging check pass, it publishes the public package with npm Trusted Publishing (OIDC) and generates provenance. The publish job uses a GitHub-hosted runner, Node 24, npm 11 and `id-token: write`; no `NPM_TOKEN` is needed.

An already-published version cannot be overwritten; pushing code without bumping the version skips publishing. The workflow does not commit a version bump or create a Git tag for you. Publish jobs are serialized, and an older version never moves `latest` backwards. Prereleases (for example `0.2.0-beta.1`) do not use this stable flow.

## One-time enablement

This project already created the npm package through the `0.0.0-stage` placeholder, so the workflow can publish the first stable `0.1.0`. The steps below are the reference path for a new package or a migration. Commit and push the code first so the workflow file exists in the repository. A publish job on the very first push of an empty package stops with a clear message to finish initialization, while normal CI still verifies the code independently.

The first package publish uses an npm account with rights to the name, logging in and verifying on your own machine:

```sh
npm ci
npm test
npm pack --dry-run
npm login
npm publish --access public
```

That publishes the current `0.1.0` publicly and requires you to complete npm login and 2FA. These commands are the enablement step; repository configuration never runs them. If the name is already taken by someone else, rename to a name or scope you own and update the README, examples and image naming before publishing.

After the package exists, open the package's Settings -> Trusted Publisher, choose GitHub Actions and fill in:

| Field | Value |
| --- | --- |
| Organization or user | `Wade11s` |
| Repository | `LayerFS-MCP` |
| Workflow filename | `publish.yml` (filename only) |
| Environment name | Leave empty; the current workflow sets no environment |
| Allowed actions | Allow direct `npm publish` |

Per current npm documentation, a new Trusted Publisher configuration must publish successfully within two days. Publish the next version right after configuring it to prove the chain works; if it expires, delete and recreate the configuration. Re-running the already-published `0.1.0` is skipped by the version check and cannot validate OIDC publishing.

## Later releases

With the first Git commit done and a clean working tree:

```sh
npm version patch --no-git-tag-version
git add package.json npm-shrinkwrap.json
git commit -m "Release next patch version"
git push origin main
```

`npm version` updates both the package version and the shrinkwrap. Use `minor` for features and `major` for breaking changes. Commit other code changes normally first; the commit above lets GitHub Actions publish. There is no separate npm command, token configuration or manual tarball upload.

After a successful publish, users can run `npx -y layerfs-mcp@latest serve --backend apple-container --project website`, or use `bunx`. Production setups should pin a verified version.

## Failure handling and verification limits

- Tests or the registry query fail: stop publishing and do not treat a network error as "version not yet published".
- `ENEEDAUTH`: check the account, repository, workflow filename, direct-publish permission and whether the Trusted Publisher configuration expired; never commit npm login codes or tokens.
- Version already exists: skipped as expected. If the code change must ship, bump the version and push again.
- After initial setup, check `Publish npm` in GitHub Actions and confirm the registry version with `npm view layerfs-mcp version`.

Local tests cover version deduplication, version increase, rollback refusal, first-package absence and registry failures. Remote Actions, npm permissions and the OIDC chain can only be verified by the first real publish after enablement.

Sources: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/), [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish), [npm version](https://docs.npmjs.com/cli/v11/commands/npm-version).
