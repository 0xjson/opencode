import { InstanceBootstrap } from "../project/bootstrap"
import { Instance } from "../project/instance"

function getLaunchDirectory(requestedDir?: string): string {
  // If OPENCODE_LAUNCH_DIR is set (e.g., from opencode-team wrapper), use it
  // This allows running opencode from source while preserving the original cwd
  if (process.env.OPENCODE_LAUNCH_DIR) {
    return process.env.OPENCODE_LAUNCH_DIR
  }
  return requestedDir ?? process.cwd()
}

export async function bootstrap<T>(directory: string, cb: () => Promise<T>) {
  return Instance.provide({
    directory: getLaunchDirectory(directory),
    init: InstanceBootstrap,
    fn: async () => {
      try {
        const result = await cb()
        return result
      } finally {
        await Instance.dispose()
      }
    },
  })
}
