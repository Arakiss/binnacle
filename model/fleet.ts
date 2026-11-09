// The other sessions that run binnacle. Each session writes its facts to ./state/<session>.json
// and rewrites the file twice a minute while it lives, so the folder is a roster nobody has to
// keep: a fresh file is a live session, and its story says what that session is about. Pure: the
// hooks module lists the folder and reads the fresh files; this reads what they say.

import type { Mate, Peer, Shared } from '../types'

/** A state file this long unwritten belongs to a session that is gone (it beats every 30 s). */
export const FRESH_MS = 100_000

/** An idle session stays in sight this long after its last turn ended. */
export const RECENT_MS = 15 * 60_000

/** The most other sessions the band rows. */
export const MATES_MAX = 4

/** The session a state file is named after, or null for any other file. */
export const sessionOf = (name: string): string | null => /^(.+)\.json$/.exec(name)?.[1] ?? null

/** What a state file says of its session; null when it does not read or tells no story. */
export function mateFrom(session: string, text: string, seenAt: number): Mate | null {
  let shared: Shared
  try {
    shared = JSON.parse(text) as Shared
  } catch {
    return null
  }
  if (typeof shared !== 'object' || shared === null) return null
  const story = shared.story
  const goal = story?.brief?.goal || story?.asks?.at(-1)
  if (goal === undefined || goal === '') return null
  const isWorking = shared.turn !== null && shared.turn !== undefined
  const now = story?.brief?.now || story?.said
  const outcome = story?.brief?.done || story?.outcome
  return {
    session,
    seenAt,
    agents: shared.agents?.length ?? 0,
    goal,
    ...(shared.git ? { repo: shared.git.repo, branch: shared.git.branch } : {}),
    ...(isWorking ? { turnStartedAt: shared.turn?.startedAt } : {}),
    ...(shared.last ? { endedAt: shared.last.endedAt } : {}),
    ...(isWorking && now ? { now } : {}),
    ...(!isWorking && outcome ? { outcome } : {}),
  }
}

/** The sessions worth a row at `now`: at work first (longest first), then the ones that ended a turn lately. */
export function matesShown(mates: readonly Mate[], now: number): Mate[] {
  const live = mates.filter(m => now - m.seenAt <= FRESH_MS)
  const working = live.filter(m => m.turnStartedAt !== undefined).sort((x, y) => (x.turnStartedAt ?? 0) - (y.turnStartedAt ?? 0))
  const rested = live.filter(m => m.turnStartedAt === undefined && m.endedAt !== undefined && now - m.endedAt <= RECENT_MS).sort((x, y) => (y.endedAt ?? 0) - (x.endedAt ?? 0))
  return [...working, ...rested].slice(0, MATES_MAX)
}

/** The fewest characters of an id that name a session: a shorter one is a word, not an id. */
const ID_MIN = 8

/** Whether a peer the sessions command listed is the session `mate`: the same id, or one a prefix of the other. */
export function isSame(peer: Peer, mate: Mate): boolean {
  if (peer.session === mate.session) return peer.session !== ''
  return Math.min(peer.session.length, mate.session.length) >= ID_MIN && (mate.session.startsWith(peer.session) || peer.session.startsWith(mate.session))
}
