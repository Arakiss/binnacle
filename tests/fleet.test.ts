import { describe, expect, test } from 'claude-code/testing'

import { FRESH_MS, isSame, mateFrom, MATES_MAX, matesShown, RECENT_MS, sessionOf } from '../model/fleet'
import type { Mate, Shared } from '../types'
import { GIT, MAIN_STORY, MATES, NOW, RESTED, TOLD } from './fixtures'

const MIN = 60_000

describe('the other sessions that run binnacle', () => {
  test('a state file is named after its session; any other file is none', () => {
    expect(sessionOf('0199-abcd.json')).toBe('0199-abcd')
    expect(sessionOf('notes.txt')).toBeNull()
  })

  test('a session at work is read from its state file: where, since when, its goal and what it does now', () => {
    expect(mateFrom('s-1', JSON.stringify(TOLD), NOW - 5000)).toEqual({
      session: 's-1',
      seenAt: NOW - 5000,
      agents: 2,
      goal: MAIN_STORY.brief?.goal,
      repo: GIT.repo,
      branch: GIT.branch,
      turnStartedAt: TOLD.turn?.startedAt,
      now: MAIN_STORY.brief?.now,
    })
  })

  test('between turns it tells how the last one ended; before any reading, its request and its own words stand in', () => {
    expect(mateFrom('s-1', JSON.stringify(RESTED), NOW)).toEqual(expect.objectContaining({ endedAt: RESTED.last?.endedAt, outcome: 'All 248 tests pass; nothing committed' }))
    const unread: Shared = { ...TOLD, story: { asks: ['Fix the overflow'], askedAt: NOW, said: 'Reading the cut.' } }
    expect(mateFrom('s-1', JSON.stringify(unread), NOW)).toEqual(expect.objectContaining({ goal: 'Fix the overflow', now: 'Reading the cut.' }))
  })

  test('a file that does not read, or a session that tells no story, is no row', () => {
    expect(mateFrom('s-1', '{', NOW)).toBeNull()
    expect(mateFrom('s-1', 'null', NOW)).toBeNull()
    expect(mateFrom('s-1', JSON.stringify({ git: GIT, turn: null }), NOW)).toBeNull()
  })

  test('the ones worth a row: at work first, then those that ended a turn lately; a stale file is a session gone', () => {
    const mate = (session: string, over: Partial<Mate>): Mate => ({ session, seenAt: NOW, agents: 0, goal: 'g', ...over })
    const shown = matesShown(
      [
        mate('rested', { endedAt: NOW - 2 * MIN }),
        mate('working', { turnStartedAt: NOW - MIN }),
        mate('longer', { turnStartedAt: NOW - 9 * MIN }),
        mate('gone', { turnStartedAt: NOW - MIN, seenAt: NOW - FRESH_MS - 1 }),
        mate('long idle', { endedAt: NOW - RECENT_MS - 1 }),
        mate('never ran', {}),
      ],
      NOW,
    )
    expect(shown.map(m => m.session)).toEqual(['longer', 'working', 'rested'])
    expect(matesShown(Array.from({ length: 9 }, (_, i) => mate(`s${i}`, { turnStartedAt: NOW - i })), NOW)).toHaveLength(MATES_MAX)
    expect(matesShown(MATES, NOW)).toHaveLength(2)
  })

  test('a peer the sessions command lists is the same session when one id opens the other', () => {
    const peer = (session: string) => ({ session, harness: 'claude-code', place: '', repo: '', branch: null, intent: null, liveness: 'live', lastMs: NOW })
    const mate: Mate = { session: 'b1c2d3e4-0000', seenAt: NOW, agents: 0 }
    expect(isSame(peer('b1c2d3e4'), mate)).toBe(true)
    expect(isSame(peer('b1c2d3e4-0000-ffff'), mate)).toBe(true)
    expect(isSame(peer('c9d8'), mate)).toBe(false)
    // A few characters are a word, not an id.
    expect(isSame(peer('b1c2'), mate)).toBe(false)
    expect(isSame(peer(''), mate)).toBe(false)
  })
})
