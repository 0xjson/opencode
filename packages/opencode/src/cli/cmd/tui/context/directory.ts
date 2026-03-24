import { createMemo } from "solid-js"
import { useSync } from "./sync"
import { Global } from "@/global"

function getLaunchDirectory(): string {
  // If OPENCODE_LAUNCH_DIR is set (e.g., from opencode-team wrapper), use it
  if (process.env.OPENCODE_LAUNCH_DIR) {
    return process.env.OPENCODE_LAUNCH_DIR
  }
  return process.cwd()
}

export function useDirectory() {
  const sync = useSync()
  return createMemo(() => {
    const directory = sync.data.path.directory || getLaunchDirectory()
    const result = directory.replace(Global.Path.home, "~")
    if (sync.data.vcs?.branch) return result + ":" + sync.data.vcs.branch
    return result
  })
}
