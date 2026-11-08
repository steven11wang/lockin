# Agent Reach (optional dev tooling)

[Agent Reach](https://github.com/Panniantong/Agent-Reach) is a CLI that lets an AI agent
search and read sites it can't normally reach (Bilibili, V2EX, GitHub, YouTube, web pages, ...).
It is **not** part of the Focus Dial app or its build; this is only a setup note for contributors.

## Install

> The PyPI package named `agent-reach` is **not** this project. Install from GitHub only.

```bash
git clone --depth 1 https://github.com/Panniantong/Agent-Reach /tmp/agent-reach-src
python3 -m venv ~/.venvs/agent-reach
~/.venvs/agent-reach/bin/pip install /tmp/agent-reach-src
```

Or use the project's official agent-driven install:
`https://raw.githubusercontent.com/Panniantong/Agent-Reach/main/docs/install.md`

## Use

```bash
agent-reach channels                          # list channels and their actions (JSON)
agent-reach bilibili search "大模型"           # agent-reach <channel> <action> [args]
agent-reach read https://www.v2ex.com/t/123   # pick the channel from the URL
agent-reach doctor                            # check which backends still need setup
```

## Notes

- Read-only: it searches and reads, never posts.
- Some channels need extra backends (e.g. `bili` for Bilibili) or a login; run `agent-reach doctor`.
- In sandboxed/CI environments with a restricted network, calls may fail with a 403 tunnel error.
