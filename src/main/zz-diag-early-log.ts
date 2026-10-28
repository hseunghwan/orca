// DIAG ONLY (do not merge): append early-terminal I/O events to $ORCA_DIAG_EARLY_LOG.
import { appendFileSync } from 'node:fs'

const started = Date.now()
let lines = 0

export function diagEarly(tag: string, data: string): void {
  const path = process.env.ORCA_DIAG_EARLY_LOG
  if (!path || lines > 400) {
    return
  }
  lines += 1
  try {
    appendFileSync(
      path,
      `${Date.now() - started} pid=${process.pid} ${tag} ${JSON.stringify(data.slice(0, 160))}\n`
    )
  } catch {
    // diag only
  }
}
