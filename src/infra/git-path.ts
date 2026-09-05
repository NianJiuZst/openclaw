import path from "node:path";
import { createCommandError } from "../process/command-error.js";
import { resolveCommandEnv } from "../process/exec-spawn.js";
import { runUtf8CommandWithTimeout, type CommandOptions } from "../process/exec.js";
import { resolveSafeChildProcessInvocation } from "../process/windows-command.js";

/** Convert a Git filesystem-path field before native filesystem access. */
export async function resolveGitPath(
  value: string,
  options: Pick<CommandOptions, "baseEnv" | "env" | "cwd" | "timeoutMs" | "signal"> = {},
): Promise<string> {
  if (process.platform !== "win32" || !value.startsWith("/") || value.startsWith("//")) {
    return value;
  }
  // MSYS/Cygwin mounts belong to the selected Git installation. A drive-letter
  // rewrite misses custom mounts; a PATH lookup can select another cygpath.
  const invocation = resolveSafeChildProcessInvocation({
    argv: ["git"],
    cwd: options.cwd,
    env: resolveCommandEnv({ argv: ["git"], baseEnv: options.baseEnv, env: options.env }),
  });
  if (invocation.usesWindowsExitCodeShim) {
    throw new Error(
      "Cannot convert Git paths through a command wrapper. Put git.exe on PATH directly.",
    );
  }
  const converter = path.win32.join(path.win32.dirname(invocation.command), "cygpath.exe");
  const result = await runUtf8CommandWithTimeout([converter, "-w", "-C", "UTF8", "--", value], {
    ...options,
    timeoutMs: options.timeoutMs ?? 10_000,
  });
  if (result.code !== 0) {
    throw createCommandError("cygpath", result, { timeoutMs: options.timeoutMs ?? 10_000 });
  }
  // Remove only the converter's line ending, preserving porcelain path spaces.
  return result.stdout.replace(/\r?\n$/, "");
}
