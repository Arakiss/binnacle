import { describe, expect, test } from 'claude-code/testing'

import * as act from '../model/activity'
import { shareOf } from '../model/shared'
import * as st from '../model/story'
import { NOW } from './fixtures'

const MIN = 60_000

describe('reading a model\'s text', () => {
  test('the last words are the last line a person would read: no code, no table, no markup', () => {
    const text = ['## Plan', '', 'The cut happens too early.', '', '```ts', 'const x = 1', '```', '| a | b |', '- **Next**: measure it at `70` columns.'].join('\n')
    expect(st.lastWords(text)).toBe('Next: measure it at 70 columns.')
    expect(st.lastWords('```\nonly code\n```')).toBe('')
    expect(st.lastWords('x'.repeat(400)).length).toBe(st.LIMITS.said)
  })

  test('an answer opens with its first line; a short one takes the next along', () => {
    expect(st.opening('Fixed: the cut now counts separators.\n\nDetails follow.')).toBe('Fixed: the cut now counts separators.')
    expect(st.opening('Done.\n\nThree tests cover the widths.')).toBe('Done. Three tests cover the widths.')
    expect(st.opening('[the report](https://example.com/r) is ready')).toBe('the report is ready')
  })

  test('a request is the person\'s words or a task; a notice the engine wrote is not', () => {
    expect(st.isAsk('fix the overflow')).toBe(true)
    expect(st.isAsk('  ')).toBe(false)
    expect(st.isAsk('<task-notification>shell ended</task-notification>')).toBe(false)
  })

  test('the tail of a text still being written is its newest sentence, or its newest words', () => {
    expect(st.tail('First I read the file. Now I am checking how the separators are counted')).toBe('Now I am checking how the separators are counted')
    const long = st.tail(`${'word '.repeat(60)}the end of it`, 40)
    expect(long.startsWith('…')).toBe(true)
    expect(long.endsWith('the end of it')).toBe(true)
    expect([...long].length).toBeLessThanOrEqual(40)
  })
})

describe('the story of a loop', () => {
  test('the main loop keeps its last requests, the newest last, and never the same one twice', () => {
    let a = act.EMPTY
    for (const ask of ['one', 'two', 'two', 'three', 'four']) a = st.asked(a, undefined, ask, NOW)
    expect(a.story?.asks).toEqual(['two', 'three', 'four'])
    expect(st.asked(a, undefined, '<system-reminder>x</system-reminder>', NOW)).toBe(a)
    expect(st.asked(act.EMPTY, undefined, `a\n  long   one ${'x'.repeat(900)}`, NOW).story?.asks?.[0]?.length).toBe(st.LIMITS.ask)
  })

  test('an agent\'s story is its own, and one told before its spawn settles is kept when it does', () => {
    let a = st.asked(act.EMPTY, 'a-1', 'Measure the band at 40 columns', NOW)
    a = act.agentSpawned(a, { id: 'a-1', name: 'width-audit', type: 'general-purpose', isBackground: true, at: NOW })
    a = st.said(a, 'a-1', 'Three fixtures overflow.\n\nChecking the fourth.', NOW + 1000)
    const run = a.agents.find(r => r.id === 'a-1')
    expect(run?.name).toBe('width-audit')
    expect(run?.story).toEqual({ asks: ['Measure the band at 40 columns'], askedAt: NOW, said: 'Checking the fourth.', saidAt: NOW + 1000 })
    expect(a.story).toBeUndefined()
  })

  test('the trail counts calls by what they do and names the files edited last; a new turn starts it over', () => {
    let a = st.asked(act.EMPTY, undefined, 'go', NOW)
    for (const [tool, file] of [['Read'], ['Grep'], ['Edit', 'a.ts'], ['Edit', 'b.ts'], ['Edit', 'a.ts'], ['Bash'], ['Agent'], ['WebFetch'], ['mcp__x__y']] as const) a = st.called(a, undefined, tool, NOW, file)
    expect(a.story?.trail).toEqual({ read: 1, search: 1, edit: 3, run: 1, web: 1, agent: 1, other: 1, files: ['a.ts', 'b.ts'] })
    expect(st.stepsOf(a.story?.trail)).toBe(9)
    const next = st.turnBegan(a)
    expect(next.story?.trail).toBeUndefined()
    expect(next.story?.asks).toEqual(['go'])
  })

  test('a reading is stamped and lands on the main loop and on each agent it names; one that went is left alone', () => {
    let a = st.asked(act.EMPTY, undefined, 'go', NOW)
    a = act.agentSpawned(a, { id: 'a-1', name: 'one', type: 'x', isBackground: true, at: NOW })
    const words = { goal: 'g', now: 'n', done: 'd' }
    a = st.briefed(a, { main: words, agents: { 'a-1': words, gone: words } }, NOW + 5)
    expect(a.story?.brief).toEqual({ ...words, at: NOW + 5 })
    expect(a.agents.map(r => [r.id, r.story?.brief?.at])).toEqual([['a-1', NOW + 5]])
  })

  test('an agent that reported stays in sight three minutes, with how its report opened', () => {
    let a = act.agentSpawned(act.EMPTY, { id: 'a-1', name: 'docs-check', type: 'Explore', isBackground: true, at: NOW - 5 * MIN })
    a = st.concluded(act.agentTurnEnded(a, 'a-1', NOW - MIN, true), 'a-1', 'The README is current.\n\nMore below.', NOW - MIN)
    // One that ended without a report is not a result to show.
    a = act.agentTurnEnded(act.agentSpawned(a, { id: 'a-2', name: 'silent', type: 'Explore', isBackground: true, at: NOW - 5 * MIN }), 'a-2', NOW - MIN)
    expect(st.finishedOf(a, NOW)).toEqual([{ id: 'a-1', name: 'docs-check', endedAt: NOW - MIN, outcome: 'The README is current.' }])
    expect(st.finishedOf(a, NOW + st.FINISHED_MS)).toEqual([])
    expect(shareOf({ now: NOW, mode: 'full', activity: a, git: null, ci: null, peers: [], loops: 0, history: {} }).finished).toHaveLength(1)
  })

  test('the state file carries each story slim: the newest request alone, and no beat unless it is the session\'s own', () => {
    let a = act.EMPTY
    for (const ask of ['one', 'two']) a = st.asked(a, undefined, ask, NOW)
    const values = { now: NOW, mode: 'full' as const, activity: a, git: null, ci: null, peers: [], loops: 0, history: {} }
    expect(shareOf(values).story).toEqual({ asks: ['two'], askedAt: NOW })
    expect(shareOf(values).beat).toBeUndefined()
    expect(shareOf({ ...values, beats: true }).beat).toBe(Math.floor(NOW / 30_000))
    expect(shareOf({ ...values, activity: act.EMPTY }).story).toBeUndefined()
  })
})
