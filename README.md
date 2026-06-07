# copilot-delegate

A CLI tool that lets any AI coding assistant delegate tasks to [GitHub Copilot CLI](https://github.com/features/copilot/cli) via the [`@github/copilot-sdk`](https://github.com/github/copilot-sdk).

Works with Claude Code, GitHub Copilot, Codex CLI, Gemini CLI, and any other agent that can run shell commands.

[日本語版 README](./README.ja.md)

## Why

Long AI coding sessions accumulate conversation context, driving up token costs on every request. By offloading heavy tasks (file editing, codebase research, bulk refactors) to a separate Copilot process, the calling agent only receives a compact JSON result — keeping its context window small and its costs low.

```
Agent session context  ──── delegates ────▶  Copilot CLI server
   ↑ ~100 tokens                                (separate process)
   └──────── JSON result ────────────────────────┘
```

## Architecture

```
copilot-delegate <task.yaml>
        │
        │  RuntimeConnection.forUri()  (JSON-RPC over TCP)
        ▼
copilot --headless --port 3000   (persistent server)
        │
        ▼
Any LLM via BYOK  (Anthropic, OpenAI, Azure, local models, …)
```

The Copilot CLI server runs once as a background process and maintains session history across invocations. Each `copilot-delegate` invocation creates a fresh session with no context from previous runs, outputs JSON, and exits. Use `resumeSession` in the SDK if you want to carry context across calls.

## Prerequisites

- Node.js 20+
- GitHub Copilot CLI (`npm install -g @github/copilot-cli` or via your package manager)
- A GitHub Copilot subscription **or** BYOK API keys

## Installation

```bash
git clone https://github.com/your-org/copilot-delegate
cd copilot-delegate
npm install
npm run build
npm link          # makes `copilot-delegate` available globally
```

## Usage

### 1. Start the Copilot CLI server

Run this once in a terminal (or as a background service):

```bash
copilot --headless --port 3000 --allow-all --add-dir /path/to/your/project
```

| Flag | Purpose |
|------|---------|
| `--headless` | Start in server mode (no interactive UI) |
| `--port 3000` | Listen on TCP port 3000 |
| `--allow-all` | Auto-approve all tool requests without prompting |
| `--add-dir` | Grant file access to the specified directory |

### 2. Configure the environment

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

```dotenv
COPILOT_SERVER_URL=http://localhost:3000
COPILOT_DEFAULT_MODEL=auto
COPILOT_GITHUB_TOKEN=ghp_...   # or GH_TOKEN / GITHUB_TOKEN
```

### 3. Write a task file

```yaml
# task.yaml
task:
  type: code-edit          # code-edit | research | long-task
  prompt: |
    Update the JWT verification in src/auth.ts to support RS256.
    Currently it only supports HS256.
  context:
    files:
      - src/auth.ts        # files passed verbatim in the prompt

provider:
  model: claude-haiku-4.5  # omit to use COPILOT_DEFAULT_MODEL

permissions:
  allowedTools:
    - read                 # shell | read | write | mcp | url | memory | hook
    - write

output:
  format: json             # json | markdown | raw
```

### 4. Run the command

```bash
copilot-delegate task.yaml
```

**Output (JSON):**

```json
{
  "status": "success",
  "message": "Updated JWT verification to use RS256 with public-key validation.",
  "editedFiles": ["src/auth.ts"],
  "model": "claude-haiku-4.5"
}
```

Use `--raw` to get plain text output instead of JSON:

```bash
copilot-delegate task.yaml --raw
```

## Agent integration

The CLI outputs JSON to stdout, so any agent that can run shell commands and parse JSON can use it. Below are integration examples for common agents.

### Claude Code

Install the included Agent Skill:

```bash
mkdir -p ~/.claude/skills/copilot-delegate
cp skill/SKILL.md ~/.claude/skills/copilot-delegate/SKILL.md
```

Then invoke it in a session:

```
/copilot-delegate
```

Claude analyzes the request, writes a task YAML, calls `copilot-delegate`, parses the JSON, and reports back — without bloating the conversation context.

### GitHub Copilot CLI (custom agent / extension)

Call `copilot-delegate` from a shell tool or custom agent handler:

```bash
copilot-delegate task.yaml
```

Parse the JSON output and feed the `message` back into your agent's response.

### Codex CLI

Use Codex's shell execution capability to run the command and read stdout:

```bash
result=$(copilot-delegate task.yaml)
echo "$result" | jq '.message'
```

### Gemini CLI

Invoke via a shell tool call and pass the JSON result to the next prompt step.

### General pattern

Any agent following this pattern works:

1. Generate `task.yaml` based on the user's request
2. Run `copilot-delegate task.yaml`
3. Parse `{ status, message, editedFiles, model }` from stdout
4. Surface `message` and `editedFiles` to the user

## Task file reference

### `task`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `code-edit \| research \| long-task` | yes | Task category (informational; affects default permission suggestions) |
| `prompt` | string | yes | Self-contained instruction for Copilot. Must not rely on the calling agent's conversation history. |
| `context.files` | string[] | no | Relative paths to files included verbatim in the prompt |

### `provider`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `model` | string | `COPILOT_DEFAULT_MODEL` env | Model ID (`auto`, `claude-haiku-4.5`, `gpt-5-mini`, or BYOK model) |

### `permissions`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `allowedTools` | PermissionKind[] | `[]` (approve all) | Restrict which tool kinds Copilot may use. Empty array means `approveAll`. |

Available permission kinds: `shell`, `read`, `write`, `mcp`, `url`, `memory`, `hook`

### `output`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `format` | `json \| markdown \| raw` | — | Controls how the AI formats its response. The CLI always outputs JSON unless `--raw` is passed. |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_SERVER_URL` | `http://localhost:3000` | URL of the running Copilot CLI server |
| `COPILOT_DEFAULT_MODEL` | `auto` | Default model when `provider.model` is omitted |
| `COPILOT_GITHUB_TOKEN` | — | GitHub token for authentication |
| `GH_TOKEN` / `GITHUB_TOKEN` | — | Alternative GitHub token variable names |

## BYOK (Bring Your Own Key)

To use models without a GitHub Copilot subscription, configure the Copilot CLI server with your own API keys. See the [BYOK documentation](https://github.com/github/copilot-sdk/blob/main/docs/auth/byok.md) for details.

## Available models

Query the running server for available models:

```bash
node -e "
import('@github/copilot-sdk').then(async ({ CopilotClient, RuntimeConnection }) => {
  const c = new CopilotClient({ connection: RuntimeConnection.forUri('http://localhost:3000') });
  await c.start();
  const models = await c.listModels();
  console.log(models.map(m => m.id));
  await c.stop();
});
"
```

## Examples

See the [`examples/`](./examples) directory:

- [`code-edit.yaml`](./examples/code-edit.yaml) — Modify source files with write permissions
- [`research.yaml`](./examples/research.yaml) — Investigate the codebase and produce a report
- [`long-task.yaml`](./examples/long-task.yaml) — Bulk replacement across many files

## License

MIT
