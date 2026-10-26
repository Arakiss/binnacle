// Pure readers of what binnacle's commands print. The commands run in hooks/register.tsx:
// the engine follows $ only into functions of the module that holds the hooks.

import { t } from '../i18n'
import type { Ci, Git, Meter, Peer, Pr, Reading, Sample } from '../types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

function parse<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** `git status --porcelain=v2 --branch` and the checkout's top folder. */
export function gitFrom(status: string, root: string): Git {
  let branch = 'HEAD'
  let ahead = 0
  let behind = 0
  let dirty = 0
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice(14)
    else if (line.startsWith('# branch.ab ')) {
      const [a, b] = line.slice(12).split(' ')
      ahead = Math.abs(Number(a)) || 0
      behind = Math.abs(Number(b)) || 0
    } else if (line !== '' && !line.startsWith('#')) dirty += 1
  }
  return { root, repo: root.split('/').pop() ?? '', branch, dirty, ahead, behind }
}

type Check = { bucket?: string }

/** The checks of the pull request the current branch opened; null when there is none. */
export function ciFrom(checksJson: string): Ci | null {
  const checks = parse<Check[]>(checksJson)
  if (!Array.isArray(checks) || checks.length === 0) return null

  const count = (...buckets: string[]) => checks.filter(c => buckets.includes(c.bucket ?? '')).length
  return { pass: count('pass'), fail: count('fail', 'cancel'), pending: count('pending') }
}

/** `gh pr view --json number,reviewDecision`; null when the branch has no pull request. */
export function prFrom(viewJson: string): Pr | null {
  const pr = parse<{ number?: unknown; reviewDecision?: unknown; url?: unknown }>(viewJson)
  if (pr === null || typeof pr.number !== 'number') return null
  return { number: pr.number, review: typeof pr.reviewDecision === 'string' ? pr.reviewDecision : '', ...(typeof pr.url === 'string' ? { url: pr.url } : {}) }
}

/**
 * One session as the `peersCommand` option's command prints it: a JSON array of these. Only
 * `session` is required; a row whose `lifecycle` is present and not `active` is left out, and
 * `liveness: "live"` marks the ones at work. A `display_name` is the session's name; without one,
 * an `intent` that opens with a capitalised name and a colon ("Vesper: fixing the importer") reads
 * as that session's name and mission.
 */
type Row = {
  session?: string
  display_name?: string
  harness?: string
  cwd?: string
  repo?: string
  branch?: string | null
  root?: string
  intent?: string | null
  liveness?: string
  lifecycle?: string
  last_ms?: number
}

/** Other active sessions, newest first; this session and its own descendants left out. */
export function peersFrom(lsJson: string, self: string, max = 12): Peer[] {
  const rows = parse<Row[]>(lsJson)
  if (!Array.isArray(rows)) return []
  return rows
    .filter(r => (r.lifecycle === undefined || r.lifecycle === 'active') && r.session !== self && r.root !== self && typeof r.session === 'string')
    .sort((a, b) => (a.liveness === 'live' ? 0 : 1) - (b.liveness === 'live' ? 0 : 1) || (b.last_ms ?? 0) - (a.last_ms ?? 0))
    .slice(0, max)
    .map(r => ({
      session: r.session ?? '',
      ...(typeof r.display_name === 'string' && r.display_name.trim() !== '' ? { displayName: r.display_name.trim() } : {}),
      harness: r.harness ?? '',
      place: (r.cwd ?? '').split('/').pop() ?? '',
      repo: r.repo ?? '',
      branch: r.branch ?? null,
      intent: r.intent ?? null,
      liveness: r.liveness ?? '',
      lastMs: r.last_ms ?? 0,
    }))
}

/**
 * A session's name and mission. The name the peers command gives comes first, so binnacle agrees
 * with whatever else shows that list; then the name an intent may open with ("Vesper: …"); last,
 * the harness and the id's LAST four characters: a UUIDv7 opens with its timestamp, so the first
 * four are the same for every session started the same day.
 */
export function peerWords(peer: Peer): { name: string; mission: string } {
  const intent = (peer.intent ?? '').trim()
  const named = /^(\p{Lu}[\p{L}-]{1,15}):\s*(.*)$/su.exec(intent)
  const mission = named?.[1] !== undefined ? (named[2] ?? '') : intent
  const name = peer.displayName ?? named?.[1] ?? `${peer.harness || t('peer.session')} ${peer.session.slice(-4)}`
  return { name, mission }
}

/** Live sessions writing in this very checkout. */
export function crowdOf(peers: readonly Peer[], root: string | undefined): number {
  if (root === undefined) return 0
  return peers.filter(p => p.liveness === 'live' && p.repo === root).length
}

// Zentty's Codex wrapper can re-exec itself forever once whatever launched `codex app-server` dies
// and leaves it to launchd; each turn of that loop spawns shells, and the spawn storm drains kernel
// memory. Read only with the `watchCodexLoops` option on.
const LOOPING = /zentty-agent-wrapper app-server|bin\/codex\/codex app-server|zentty launch codex app-server/

export function loopsFrom(psText: string): number[] {
  return psText.split('\n').flatMap(line => {
    const [pid, ppid, ...command] = line.trim().split(/\s+/)
    return ppid === '1' && LOOPING.test(command.join(' ')) ? [Number(pid)] : []
  })
}

/** `date +%z` ("+0200") as minutes east of UTC; null when it does not read. */
export function offsetFrom(text: string): number | null {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (m === null) return null
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

// Keep the readings of the last three hours, one per move or every five minutes.
export function remember(samples: Sample[], t: number, p: number): Sample[] {
  const last = samples.at(-1)
  const kept = samples.filter(s => t - s.t < 3 * HOUR)
  if (last !== undefined && last.p === p && t - last.t < 5 * MINUTE) return kept
  return [...kept, { t, p }].slice(-40)
}

/**
 * Points a window gained per hour over the last hour of readings: from the oldest reading in the
 * hour before the newest to the newest. Null with less than ten minutes between them.
 */
export function paceOf(samples: readonly Sample[]): number | null {
  const last = samples.at(-1)
  if (last === undefined) return null
  const first = samples.find(s => last.t - s.t <= HOUR)
  if (first === undefined || last.t - first.t < 10 * MINUTE) return null
  return ((last.p - first.p) / (last.t - first.t)) * HOUR
}

// Milliseconds until the window fills at the pace of the last hour; null when it is not filling.
export function untilFull(samples: Sample[]): number | null {
  const last = samples.at(-1)
  const pace = paceOf(samples)
  if (last === undefined || pace === null || pace <= 0) return null
  return ((100 - last.p) / pace) * HOUR
}

/**
 * Each window's last reading after the engine reported `limits` at `now`. While the figures stand
 * still, the time of the reading moves at most once a minute, so the state file is not rewritten on
 * every measure. A window the engine stopped reporting keeps its last reading and its time; an
 * empty report (no reading yet, or no subscription) changes nothing.
 */
export function observed(before: Readonly<Record<string, Reading>>, limits: readonly Meter[], now: number): Record<string, Reading> {
  const read = limits
    .filter(l => Number.isFinite(l.percent))
    .map(l => ({ kind: l.kind, percent: l.percent, resetsAt: l.resetsAt !== undefined && Number.isFinite(l.resetsAt) ? l.resetsAt : undefined }))
  const isNews = read.some(l => {
    const known = before[l.kind]
    return known === undefined || known.percent !== l.percent || known.resetsAt !== l.resetsAt || now - known.seenAt >= MINUTE
  })
  if (!isNews) return before
  const next = { ...before }
  for (const l of read) next[l.kind] = { percent: l.percent, ...(l.resetsAt === undefined ? {} : { resetsAt: l.resetsAt }), seenAt: now }
  return next
}

/** Only what `untilFull` reads, for the status line's file. */
export function recent(history: Record<string, Sample[]>, now: number): Record<string, Sample[]> {
  return Object.fromEntries(Object.entries(history).map(([kind, samples]) => [kind, samples.filter(s => now - s.t <= HOUR + 5 * MINUTE)]))
}
