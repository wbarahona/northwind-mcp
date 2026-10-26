# Quick start

From a fresh clone to a running chat, in four steps. Everything runs in Docker on your machine;
setup needs only Node. More detail and other options: [Install the chat](../README.md#install-the-chat).

## You need

- **Docker:** Docker Desktop on macOS and Windows, Docker Desktop or Docker Engine on Linux.
  On Windows, do everything inside WSL2.
- **Node 24** (https://nodejs.org/, or nvm).
- About **15 GB of free disk** and **16 GB of memory** (8 GB works, but close other apps).

## 1. Clone

```sh
git clone https://github.com/wbarahona/northwind-mcp.git
cd northwind-mcp
```

## 2. Check your machine

```sh
node scripts/stack/cli.mjs doctor
```

Fix anything marked ✗. Items marked ! are worth knowing but don't block setup.

## 3. Set up and start everything

```sh
node scripts/stack/cli.mjs setup
```

Setup asks where to run the model and suggests one for your machine:

| Your machine             | Model server                           |
| ------------------------ | -------------------------------------- |
| A Mac with Apple silicon | Docker Model Runner (fast, on the GPU) |
| An NVIDIA GPU            | Ollama with the GPU                    |
| Anything else            | Ollama on the CPU (slow, but works)    |

The first run takes 5–20 minutes, mostly downloading the model (Qwen3 4B, about 2.5 GB). It is
safe to run again if something fails.

## 4. Open the chat

Go to http://localhost:5173 and wait until the status says **Model ready**. The first answer is
slower while the model loads.

Try the suggested questions, and open **How I got this** under an answer to see the MCP tool
calls behind it.

## Day to day

| To                | Run                                           |
| ----------------- | --------------------------------------------- |
| Stop the chat     | `docker compose --profile '*' down`           |
| Start it again    | `docker compose --profile stack up -d --wait` |
| Remove everything | `docker compose --profile '*' down -v`        |

## If something goes wrong

- **"Model server offline":** the model server is off or still loading. Check
  `docker compose logs agent` and run `node scripts/stack/cli.mjs doctor`.
- **"Port … is in use":** something else holds 5173, 3000 or 27017. Stop it, or move the stack
  with `AGENT_PORT`, `API_PORT` or `MONGO_PORT` in `.env`.
- **429 Too Many Requests while downloading images:** Docker Hub limits some networks. Point
  `NODE_IMAGE` and `MONGO_IMAGE` at another registry (examples in `.env.example`) and run setup
  again.

## Optional: use the MCP server from Claude Code

With the stack running:

```sh
corepack enable
pnpm install
pnpm build
claude
```

Start `claude` from the repo folder and approve the `northwind` server. It reads its API key
from the `.env` that setup wrote. Unlike the chat, it can also place and change orders; see
[What the assistant can change](../apps/mcp/README.md#what-the-assistant-can-change).
