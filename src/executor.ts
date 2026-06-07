import { CopilotClient, RuntimeConnection, approveAll } from "@github/copilot-sdk";
import type { PermissionHandler, PermissionRequest } from "@github/copilot-sdk";
import { readContextFiles } from "./config.js";
import type { TaskConfig, TaskResult, PermissionKind } from "./types.js";

function buildPermissionHandler(allowedKinds: PermissionKind[]): PermissionHandler {
  if (allowedKinds.length === 0) {
    return approveAll;
  }
  return (request: PermissionRequest, _invocation: { sessionId: string }) => {
    if (allowedKinds.includes(request.kind as PermissionKind)) {
      return { kind: "approve-once" as const };
    }
    return { kind: "reject" as const };
  };
}

function buildPrompt(config: TaskConfig, contextContent: string): string {
  if (!contextContent) {
    return config.task.prompt;
  }
  return `${config.task.prompt}\n\n## Context Files\n\n${contextContent}`;
}

export async function executeTask(config: TaskConfig): Promise<TaskResult> {
  const serverUrl = process.env.COPILOT_SERVER_URL ?? "http://localhost:3000";
  const model = config.provider?.model ?? process.env.COPILOT_DEFAULT_MODEL ?? "auto";
  const allowedKinds = config.permissions?.allowedTools ?? [];

  const contextContent =
    config.task.context?.files && config.task.context.files.length > 0
      ? await readContextFiles(config.task.context.files)
      : "";

  const prompt = buildPrompt(config, contextContent);
  const editedFiles: string[] = [];

  const client = new CopilotClient({
    connection: RuntimeConnection.forUri(serverUrl),
  });

  await client.start();

  try {
    await using session = await client.createSession({
      model,
      onPermissionRequest: buildPermissionHandler(allowedKinds),
    });

    session.on((event) => {
      if (event.type === "permission.requested") {
        const req = event.data.permissionRequest;
        if (req.kind === "write" && !editedFiles.includes(req.fileName)) {
          editedFiles.push(req.fileName);
        }
      }
    });

    const result = await session.sendAndWait(prompt);

    return {
      status: "success",
      message: result?.data.content ?? "",
      editedFiles,
      model,
    };
  } finally {
    await client.stop();
  }
}
