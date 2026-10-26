// How each background shell stands, read from its output file, for the scripts that run outside a
// session (tools/liveness.ts, tools/statusline.ts). The hooks module reads the same files through
// $.fs in hooks/watch.ts; both judge them with model/shells.ts.
import { isOutputPath, runOf, tailStart, type Probe, type ShellRun } from '../model/shells'
import type { Shell } from '../types'

/** The last bytes of a shell's output file and its last change; null when it is gone. */
export async function probe(path: string): Promise<Probe> {
  if (!isOutputPath(path)) return null
  try {
    const file = Bun.file(path)
    if (!(await file.exists())) return null
    return { tail: await file.slice(tailStart(file.size)).text(), mtimeMs: file.lastModified }
  } catch {
    return null
  }
}

export async function runsOf(shells: readonly Shell[]): Promise<ShellRun[]> {
  return Promise.all(shells.map(async shell => runOf(shell, shell.stoppedAt === undefined ? await probe(shell.output) : null)))
}
