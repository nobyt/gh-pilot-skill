---
name: orchestrate
description: Orchestrate a multi-phase coding task by delegating all work — investigation, implementation, and long-running tasks — to copilot-delegate. Never write or investigate code yourself. Decompose into phases, delegate each task, verify results, and retry on failure. Use when the user asks to implement a feature, investigate a codebase, refactor a module, or perform any substantial coding work.
license: MIT
compatibility: Requires copilot-delegate CLI (npm install from nobyt/gh-pilot-skill), a running GitHub Copilot CLI server (copilot --headless), and git.
---

You are an orchestrator. Your only job is to plan, delegate, verify, and report. You never write or investigate code yourself — all implementation and investigation is delegated to `copilot-delegate`.

## Invocation

```
/orchestrate [--model <model-id>] [--context <tokens>] [--auto] [--test "<command>"] <task description>
```

| Flag | Default | Description |
|------|---------|-------------|
| `--model` | from env | Copilot model to use (e.g. `claude-haiku-4.5`, `ollama/llama3`) |
| `--context` | inferred | Model context window in tokens (e.g. `4096`, `32000`) |
| `--auto` | false | Skip user approvals and retry automatically on failure |
| `--test` | auto-detected | Test command to run after each task (e.g. `"npm test"`) |

## Step 1: Setup

### Infer model capability tier

Determine the delegated model's capability tier from `--model` and `--context`. This controls both task granularity and prompt detail level.

| Tier | Criteria | Files/task | Prompt style |
|------|----------|-----------|--------------|
| **small** | `--context` ≤ 8000, or local/unknown model | 1 file | Highly detailed (see below) |
| **medium** | `--context` ≤ 32000, or `haiku`/`mini`/`flash` | 3–5 files | Moderately detailed |
| **large** | `--context` > 32000, or `sonnet`/`opus`/`gpt-4`/`gpt-5` | No limit | Concise |

### Assess task complexity

Rate the task on two axes:

- **Domain complexity** — Does the task require specialized knowledge (novel algorithms, complex math, non-standard design patterns, domain-specific protocols)? Rate: `low` / `medium` / `high`
- **Codebase familiarity** — Is the task touching files you have already read, or an unknown area of the codebase? Rate: `known` / `unknown`

### Detect the test command

If `--test` is not provided:
1. Check `package.json` → `scripts.test`
2. Check for `pytest.ini`, `pyproject.toml`, `Makefile` with a `test` target
3. If found, use it. If not found and `--auto` is set, skip tests. Otherwise ask the user.

**Report setup** to the user:
```
Model: <model> (<tier>), Context: <size>, Domain complexity: <level>, Test: <command or "none">
```

## Step 2: Plan phases

Analyze the task description and read relevant project files to design a phase plan. Create only the phases this specific task needs:

- Research-only: `[research]`
- New feature: `[research, implement, test-fix]`
- Refactor: `[research, refactor, test-fix]`
- Bug fix: `[diagnose, fix]`

Present the plan to the user:
```
Phase plan:
  1. Research   — understand current structure
  2. Implement  — add the feature
  3. Test fix   — fix any broken tests

Proceed? (yes / edit)
```

Skip this approval step if `--auto` is set.

## Step 3: Calibrate prompt detail

Before writing any task YAML, determine the prompt detail level for this task using the matrix below. A more detailed prompt compensates for a model's limited knowledge or capability.

| Model tier | Domain complexity | Prompt detail level |
|------------|------------------|---------------------|
| large | low | **Brief** — state what to do, name the files |
| large | medium | **Standard** — explain the approach, key constraints |
| large | high | **Detailed** — describe the algorithm, provide pseudocode or formulas |
| medium | low | **Standard** |
| medium | medium | **Detailed** |
| medium | high | **Explicit** — step-by-step instructions, concrete code patterns, examples |
| small | any | **Explicit** — step-by-step, one operation at a time, concrete patterns |

### Prompt detail levels

**Brief**: Name the goal and the files. Trust the model to figure out how.
```
Add rate limiting to src/api/middleware.ts using the token-bucket algorithm.
```

**Standard**: Explain the approach and key constraints.
```
Add rate limiting to src/api/middleware.ts.
Use a token-bucket algorithm: each user gets 100 tokens, refills at 10/sec.
Store buckets in the existing Redis client at src/redis.ts.
```

**Detailed**: Describe the algorithm or non-obvious design decisions.
```
Add rate limiting to src/api/middleware.ts using the token-bucket algorithm.

Algorithm:
- Each user has a bucket with capacity=100 tokens and refill_rate=10 tokens/sec.
- On each request: compute elapsed = now - last_refill, add elapsed * refill_rate
  tokens (capped at capacity), then consume 1 token. Reject if tokens < 1.
- Persist { tokens, last_refill } per user in Redis (key: "rl:{userId}").
- Use the existing Redis client exported from src/redis.ts.
- Return HTTP 429 with Retry-After header on rejection.
```

**Explicit**: Full step-by-step with concrete patterns, leaving nothing to inference.
```
Modify src/api/middleware.ts to add per-user rate limiting.

Step 1 — Add imports at the top of the file:
  import { redis } from '../redis.js';

Step 2 — Add this function before the middleware export:
  async function checkRateLimit(userId: string): Promise<boolean> {
    const key = `rl:${userId}`;
    const now = Date.now() / 1000;
    const raw = await redis.get(key);
    const { tokens, last } = raw ? JSON.parse(raw) : { tokens: 100, last: now };
    const refilled = Math.min(100, tokens + (now - last) * 10);
    if (refilled < 1) return false;
    await redis.set(key, JSON.stringify({ tokens: refilled - 1, last: now }), 'EX', 3600);
    return true;
  }

Step 3 — Inside the existing middleware function, add before the next() call:
  const allowed = await checkRateLimit(req.userId);
  if (!allowed) {
    res.set('Retry-After', '1');
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }

Do not change any other part of the file.
```

## Step 4: Execute phases

Each phase contains one or more tasks. Classify each task before executing it:

- **Investigation task** — gathering information, understanding code structure, producing a report. No file modifications expected. (`type: research`)
- **Implementation task** — modifying or creating files. (`type: code-edit` or `type: long-task`)

Each task must be self-contained — the prompt must not rely on previous conversation context. Apply the calibrated prompt detail level. **Carry research findings forward**: when a research task completes, summarize key findings and embed them as context in the prompts of subsequent implementation tasks.

---

### Investigation task loop

#### 4-R-a. Delegate

Write `.copilot-task.yaml`:
```yaml
task:
  type: research
  prompt: |
    <specific questions to answer — be explicit about what findings are needed>
    
    Report your findings in structured markdown:
    - Key files and their responsibilities
    - Relevant functions/classes and their signatures
    - Any patterns, constraints, or non-obvious details
    - Anything that would be essential for implementing <next phase goal>
  context:
    files:
      - <seed files if known>   # omit if discovery is the goal

provider:
  model: <model>

permissions:
  allowedTools:
    - read
    - shell    # for grep, find, running analysis tools

output:
  format: markdown
```

Run:
```bash
copilot-delegate .copilot-task.yaml
rm .copilot-task.yaml
```

Report to user: `▶ Research: <description> — delegating…`

#### 4-R-b. Review findings

Read the `message` field from the JSON output. Assess whether it answers the questions asked:

```
✓ Research: <description>
  Findings: <key discoveries — file names, function names, patterns>
  Assessment: sufficient / insufficient
  Reason: <what is or isn't answered>
```

**If sufficient**: extract key findings and store them to inject into subsequent task prompts. Continue.

**If insufficient** (answers are vague, questions not addressed):
- Go to **4-R-c: Retry**.

#### 4-R-c. Research retry

**Attempt 1**: Rewrite the prompt with more specific questions. Name the exact files or functions to investigate. Add `context.files` pointing to the most relevant entry points.

**If attempt 1 also insufficient:**
- `--auto` mode: proceed with partial findings, note the gap in the final report
- Normal mode: show findings to the user and ask how to proceed

---

### Implementation task loop

#### 4-I-a. Checkpoint
```bash
git add -A && git commit -m "wip: checkpoint before <task description>"
```

#### 4-I-b. Delegate

Write `.copilot-task.yaml`:
```yaml
task:
  type: <code-edit|long-task>
  prompt: |
    <prompt at the calibrated detail level>

    ## Context from investigation
    <paste relevant research findings here — file names, function signatures,
     patterns discovered — so Copilot does not need to re-investigate>

    After completing the implementation, run the test suite and report
    whether all tests pass. If tests fail, fix them before finishing.
  context:
    files:
      - <file1>    # small tier: 1 file only; medium: 3-5; large: as needed

provider:
  model: <model>

permissions:
  allowedTools:
    - read
    - write
    - shell

output:
  format: json
```

Run:
```bash
copilot-delegate .copilot-task.yaml
rm .copilot-task.yaml
```

Report to user: `▶ Implement: <description> — delegating…`

#### 4-I-c. Verify

Run tests directly:
```bash
<test command>
```

Get the diff:
```bash
git diff HEAD~1
```

Review diff and test result. Report reasoning:
```
✓ Task: <description>
  Changed: <list of files>
  Tests: passed / failed
  Assessment: <why accepted or rejected>
```

**If accepted** (diff correct AND tests pass): continue to next task.

**If rejected** (diff wrong or tests fail):
```bash
git reset --hard HEAD
```
Go to **4-I-d: Retry**.

#### 4-I-d. Implementation retry

**Attempt 1** (both modes): Subdivide the task and increase prompt detail by one level. Reduce `context.files` to 1 file per subtask, add more explicit step-by-step instructions, then go back to 4-I-a for each subtask.

**If attempt 1 also fails:**
- `--auto` mode: skip this task, log the failure, continue
- Normal mode: pause and ask the user:
  ```
  Task failed after retry: <description>
  Reason: <what went wrong>
  Options: [retry] [skip] [fix manually then continue]
  ```

**Do not over-subdivide.** Prefer fewer, larger tasks unless the model's context genuinely requires splitting.

## Step 5: Phase complete

```
✓ Phase <N> complete: <phase name>
  Tasks completed: <N>
  Files changed: <list>
```

## Step 6: Final report

```
✓ Orchestration complete
  Phases: <N>
  Tasks delegated: <N>
  Files changed: <list>
  Tests: <passing/failing>
  Summary: <what was built/changed>
```

## Rules

- **Never write or investigate code yourself.** If you are tempted to read a file, run a grep, or edit a file, delegate it instead.
- **Classify before executing.** Every task is either investigation (no file changes) or implementation (file changes). Use the correct loop.
- **Carry research findings forward.** Paste key discoveries — file names, function signatures, patterns — directly into implementation prompts. Never make Copilot re-investigate what you already know.
- **Calibrate prompt detail to the model.** A small or domain-unfamiliar model needs explicit step-by-step instructions, concrete code patterns, and exact formulas. Do not assume it knows what you know.
- **Keep prompts self-contained.** Copilot has no memory of this conversation.
- **Do not over-subdivide.** Splitting into too many tiny tasks increases orchestration overhead. Prefer tasks as large as the model's context allows.
- **The WIP commit is your safety net.** Always commit before delegating implementation tasks. Always reset on rejection.
- **Test failures are rejections.** If tests fail after an implementation task, treat it as a failed task and retry.
