# Documentation

[中文](../README.md) · **English** · [Project README](../../README.en.md)

## Find a page by goal

| I want to… | Page |
| --- | --- |
| Get running and connect a first agent | [Quickstart](QUICKSTART.md) |
| Look up tool names, arguments, results, pagination | [MCP API](API.md) |
| Manage images, projects, HTTP and lifecycle from the CLI | [Unified CLI](CLI.md) |
| Set environment variables, project settings, access control | [Configuration](CONFIGURATION.md) |
| Choose between Apple, Docker and native Linux | [Backends](BACKENDS.md) |
| Understand the Apple backend's architecture and permissions | [Apple Container](APPLE-CONTAINER.md) |
| Understand checkpoints, branches, merges, concurrency | [How it works](HOW-IT-WORKS.md) |
| Run tests and see what has been verified | [Testing](TESTING.md) |
| Diagnose a failed start, import conflict or refused connection | [Troubleshooting](TROUBLESHOOTING.md) |
| Publish to npm, configure Trusted Publisher | [Releasing](RELEASING.md) |

## Suggested order

1. Read [Quickstart](QUICKSTART.md) to install the CLI, start a project, and connect an agent.
2. Read [MCP API](API.md) and [How it works](HOW-IT-WORKS.md) to learn what the agent does with these tools.
3. Read [Configuration](CONFIGURATION.md) and [Backends](BACKENDS.md) to tighten permissions and pick the backend.
4. Read [Troubleshooting](TROUBLESHOOTING.md) when something breaks.

## Conventions

- Chinese pages live in `docs/`, English pages in `docs/en/`, with matching filenames and a language switch at the top.
- Commands pin the published `0.1.0`. Write the version explicitly rather than relying on `latest` for verified behavior.
- A tool name is the upstream method with `.` replaced by `_` and a `layerfs_` prefix: `fs.read` → `layerfs_fs_read`.
- Claims about security, durability and client compatibility are limited to what was actually run in this repository. See [Testing](TESTING.md).
