# GitHub → npm 自动发布

**中文** · [English](en/RELEASING.md) · [文档索引](README.md)

GitHub 仓库：<https://github.com/Wade11s/LayerFS-MCP>。本地 `origin` 使用 `git@github.com:Wade11s/LayerFS-MCP.git`。

`.github/workflows/publish.yml` 在推送 `main` 时运行，也支持从 Actions 手动重跑。只有 `package.json` 中尚未发布、且高于 npm `latest` 的稳定版本会发布，也支持从占位预发布版本升级。检查、测试与打包检查均通过后，使用 npm Trusted Publishing（OIDC）发布公开包并生成 provenance。发布任务使用 GitHub 托管 runner、Node 24、npm 11 和 `id-token: write`，不需要 `NPM_TOKEN`。

已发布的同名同版本不能覆盖；只 push 代码而不修改版本号会跳过发布。工作流不会自动替你提交版本号或生成 Git tag。多个发布任务串行执行；旧版本不会把 `latest` 倒退。预发布版本（如 `0.2.0-beta.1`）不走此稳定版流程。

## 一次性启用

本项目已通过 `0.0.0-stage` 占位包完成 npm 包创建，可由工作流发布首个稳定版本 `0.1.0`。以下首次创建步骤供新包或迁移时参考。先将代码提交并推送到 GitHub，让工作流文件存在于仓库中。空包首次 push 的发布任务会明确提示先完成初始化，普通 CI 仍会独立验证代码。

首次包发布使用有该包权限的 npm 账号，在本机完成登录和验证：

```sh
npm ci
npm test
npm pack --dry-run
npm login
npm publish --access public
```

这会公开发布当前 `0.1.0`，需要本人完成 npm 登录/2FA。上述命令是启用步骤，仓库配置工作不会自动执行它们。如果包名已被其他人注册，应先改用自己拥有的名称或 scope，并同步 README、示例和镜像命名策略，再发布。

包创建后，在 npm 包 Settings → Trusted Publisher 选择 GitHub Actions，填写：

| 字段 | 值 |
| --- | --- |
| Organization or user | `Wade11s` |
| Repository | `LayerFS-MCP` |
| Workflow filename | `publish.yml`（只填文件名） |
| Environment name | 留空；当前工作流没有指定 environment |
| Allowed actions | 允许直接 `npm publish` |

按当前 npm 文档，新建 Trusted Publisher 配置须在两天内成功发布一次。建议配置完成后立即发布下一个版本以验证链路；过期时删除并重新建立配置。只重跑已经手动发布的 `0.1.0` 会被版本检查跳过，不能验证 OIDC 发布。

## 后续发布

在完成首次 Git 提交、工作区干净时：

```sh
npm version patch --no-git-tag-version
git add package.json npm-shrinkwrap.json
git commit -m "Release next patch version"
git push origin main
```

`npm version` 同时更新包版本和 shrinkwrap。功能版本可改用 `minor`，不兼容变更使用 `major`。其他代码修改先正常提交；上例提交版本号后，由 GitHub Actions 发布。没有额外的 npm 命令、Token 配置或手动上传 tarball 步骤。

发布成功后，用户可执行 `npx -y layerfs-mcp@latest serve --backend apple-container --project website`，或用 `bunx`。生产接入建议固定已验证的版本号。

## 失败处理与验证边界

- 测试或 registry 查询失败：停止发布，不把网络错误当成“版本尚未发布”。
- `ENEEDAUTH`：核对 npm Trusted Publisher 中的账号、仓库、工作流文件名、直接发布权限及配置是否过期；不要将 npm 登录验证码或 Token 提交到 Git。
- 版本已存在：正常跳过。若代码变更需要分发，增加版本号再 push。
- 初次设置完成后，在 GitHub Actions 中检查 `Publish npm`，并使用 `npm view layerfs-mcp version` 确认 registry 版本。

本地测试覆盖版本去重、版本递增、拒绝回退、首次包缺失与 registry 故障处理。远端 Actions、npm 权限和 OIDC 链路需要实际启用后的首次发布才能验证。

依据：[npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/)、[npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish)、[npm version](https://docs.npmjs.com/cli/v11/commands/npm-version)。
