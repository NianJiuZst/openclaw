import { afterEach, expect, it, vi } from "vitest";
import * as exec from "../process/exec.js";
import * as windowsCommand from "../process/windows-command.js";
import { resolveGitPath } from "./git-path.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  ["darwin", "/c/Users/operator/repo"],
  ["linux", "/work/repo"],
  ["win32", "C:\\c\\Users\\operator\\repo"],
  ["win32", "D:/repo"],
  ["win32", "//server/share/repo"],
  ["win32", "\\\\server\\share\\repo"],
  ["win32", "../repo/.git"],
  ["win32", ".git"],
])("preserves %s native or relative path %s", async (platform, value) => {
  vi.stubGlobal("process", { ...process, platform });
  const convert = vi.spyOn(exec, "runUtf8CommandWithTimeout");
  await expect(resolveGitPath(value)).resolves.toBe(value);
  expect(convert).not.toHaveBeenCalled();
});

it.each([
  ["/c/Users/operator/repo", "C:\\Users\\operator\\repo"],
  ["/cygdrive/d/repo", "D:\\repo"],
  ["/projects/测试 repo ", "E:\\mounted\\测试 repo "],
])("uses the selected Git installation's mount mapping for %s", async (value, nativePath) => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  const resolve = vi.spyOn(windowsCommand, "resolveSafeChildProcessInvocation").mockReturnValue({
    command: "D:\\MSYS installation\\usr\\bin\\git.exe",
    args: [],
    usesWindowsExitCodeShim: false,
    windowsHide: true,
  });
  const convert = vi.spyOn(exec, "runUtf8CommandWithTimeout").mockResolvedValue({
    stdout: `${nativePath}\r\n`,
    stderr: "",
    code: 0,
    signal: null,
    killed: false,
    termination: "exit",
  });
  const options = { env: { Path: "D:\\MSYS installation\\usr\\bin" }, cwd: "D:\\launcher" };
  await expect(resolveGitPath(value, options)).resolves.toBe(nativePath);
  expect(resolve).toHaveBeenCalledWith(expect.objectContaining({ cwd: options.cwd }));
  expect(convert).toHaveBeenCalledWith(
    ["D:\\MSYS installation\\usr\\bin\\cygpath.exe", "-w", "-C", "UTF8", "--", value],
    { ...options, timeoutMs: 10_000 },
  );
  convert.mockResolvedValueOnce({
    stdout: "",
    stderr: "cygpath: invalid path",
    code: 1,
    signal: null,
    killed: false,
    termination: "exit",
  });
  await expect(resolveGitPath(value, options)).rejects.toThrow("cygpath: invalid path");
});

it("does not look for a converter next to cmd.exe for a Git wrapper", async () => {
  vi.stubGlobal("process", { ...process, platform: "win32" });
  vi.spyOn(windowsCommand, "resolveSafeChildProcessInvocation").mockReturnValue({
    command: "C:\\Windows\\System32\\cmd.exe",
    args: [],
    usesWindowsExitCodeShim: true,
    windowsHide: true,
  });
  await expect(resolveGitPath("/c/repo")).rejects.toThrow("Put git.exe on PATH directly");
});
