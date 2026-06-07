---
name: copilot-delegate
description: Delegate a code-edit, research, or long-task to GitHub Copilot CLI via the copilot-delegate CLI. Use when the user asks to offload a task to Copilot, wants to use a different LLM, or wants to reduce token usage for a large task.
---

Delegate the user's task to GitHub Copilot CLI using the `copilot-delegate` command.

## Steps

1. **Understand the task** from the user's request and determine the task type:
   - `code-edit` — modifying or creating source files
   - `research` — investigating code, finding patterns, generating reports
   - `long-task` — repetitive operations across many files

2. **Identify context files** that Copilot will need. Read relevant files with the Read tool to confirm they exist. Only include files directly needed for the task.

3. **Choose permissions** based on task type:
   - `code-edit`: `[read, write]`
   - `research`: `[read, shell]`
   - `long-task`: `[read, write, shell]`

4. **Choose the model**. If the user specified a model, use it. Otherwise omit `provider.model` to use the default from the environment.

5. **Generate the task YAML** and write it to `.copilot-task.yaml` in the current working directory:

```yaml
task:
  type: <code-edit|research|long-task>
  prompt: |
    <clear, self-contained description of what Copilot should do>
  context:
    files:
      - <relative/path/to/file.ts>

provider:
  model: <model-name>   # omit to use COPILOT_DEFAULT_MODEL

permissions:
  allowedTools:
    - read
    - write   # include only what the task needs

output:
  format: json
```

6. **Run the command**:
```bash
copilot-delegate .copilot-task.yaml
```

7. **Parse the JSON output** and report results to the user:
   - On success: summarize `message` and list `editedFiles`
   - On error: show `error` and suggest how to fix it

8. **Clean up**: remove `.copilot-task.yaml` after the task completes.

## Notes

- The Copilot CLI server must be running before invoking this skill. If the command fails with a connection error, tell the user to run: `copilot --headless --port 3000 --allow-all --add-dir <project-root>`
- Do not include sensitive data (API keys, tokens) in the YAML file — they are read from the environment
- The prompt in the YAML must be self-contained: Copilot has no memory of the current Claude Code conversation
