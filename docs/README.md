# 文档索引

**中文** · [English](en/README.md)

## 按目标查找

| 我想… | 页面 |
| --- | --- |
| 从零跑通、接入第一个 Agent | [快速上手](QUICKSTART.md) |
| 查工具名、参数、返回结构和分页 | [MCP API](API.md) |
| 用 CLI 管理镜像、项目、HTTP、生命周期 | [统一 CLI](CLI.md) |
| 设置环境变量、项目配置、只读与权限 | [配置](CONFIGURATION.md) |
| 选择 Apple / Docker / 原生 Linux 后端 | [后端](BACKENDS.md) |
| 了解 Apple 后端的架构与权限模型 | [Apple Container](APPLE-CONTAINER.md) |
| 理解检查点、分支、合并、并发约定 | [工作方式](HOW-IT-WORKS.md) |
| 跑测试、查看已验证的范围 | [测试与验证](TESTING.md) |
| 排查启动失败、导入冲突、连不上 | [故障排查](TROUBLESHOOTING.md) |
| 发布到 npm、配置 Trusted Publisher | [发布指南](RELEASING.md) |

## 建议阅读顺序

1. [快速上手](QUICKSTART.md)：装好、跑起来、接上 Agent。
2. [MCP API](API.md) 与 [工作方式](HOW-IT-WORKS.md)：知道 Agent 会怎么用这些工具。
3. [配置](CONFIGURATION.md) 与 [后端](BACKENDS.md)：按部署环境收紧权限、选对后端。
4. [故障排查](TROUBLESHOOTING.md)：出问题时先看这里。

## 文档约定

- 中文页面在 `docs/`，英文页面在 `docs/en/`，文件名一一对应；页面顶部有语言切换入口。
- 所有命令以已发布的 `0.1.0` 为准；版本号出现在命令里时应显式写出，不要用 `latest` 描述已验证行为。
- 工具名 = 上游方法名把 `.` 换成 `_` 并加 `layerfs_` 前缀，例如 `fs.read` → `layerfs_fs_read`。
- 涉及安全、持久性和客户端兼容性的结论，只写仓库中实际执行过的验证，见 [测试与验证](TESTING.md)。
