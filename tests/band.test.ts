import { describe, expect, test } from 'claude-code/testing'

import { t, useLanguage } from '../i18n'

import { at, bandLines, briefOf, budgetNotices, compact, contextColour, DETAIL_ROWS, elapsedOf, isAheadOfPace, lineCells, noticesOf, PALETTE, peerWords, quotaColour, rowsOf, size, THEME, type BandLine, type Item } from '../render/band'
import { createBandView } from '../render/band-view'
import { CAP, easedToward, gaugeRuns } from '../render/gauge'
import { peersFrom } from '../model/signals'
import { drawn, STAND_INS, STILL_PARTS } from '../tools/draw'
import { AHEAD_OF_PACE, ALERT_STATUS, ALERTS, bandOf, FILLING, IDLE, MAIN_STORY, MATES, NO_REPO, NOW, RESTED, RUNS, SHARED_CHECKOUT, STATUS, TOLD, TZ, WORKING } from './fixtures'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const WIDTHS = [40, 60, 90, 120, 160, 300]

/** An item's text, a gauge as `[value]`, a spinner as its first frame. */
const itemText = (item: Item | undefined) => (item?.parts ?? []).map(p => (p.kind === 'text' ? p.t : p.kind === 'gauge' ? `[${p.value}]` : '⠋')).join('')
const items = (line: BandLine | undefined) => [...(line?.left ?? []), ...(line?.right ?? [])]
const byKey = (lines: readonly BandLine[], key: string) => lines.flatMap(items).find(i => i.key === key)
const cardText = (item: Item | undefined) => (item?.card ?? []).map(p => p.t).join('')
/** A line's words: the heading's rail and any indent off, each run of spaces as two. */
const words = (text: string) => text.replace(/^▍?\s*/, '').replace(/ {2,}/g, '  ')
/** Whether a line is the title the other sessions sit under. */
const isPeersTitle = (text: string) => text.includes(t('row.peersTitle'))

describe('band lines', () => {
  for (const [name, input] of [
    ['idle', bandOf(STATUS, IDLE)],
    ['working with shells', bandOf(STATUS, WORKING, RUNS)],
    ['alerts with shells', bandOf(ALERT_STATUS, ALERTS, RUNS)],
    ['no repo', bandOf(STATUS, NO_REPO)],
    ['shared checkout', bandOf(AHEAD_OF_PACE, SHARED_CHECKOUT)],
  ] as const) {
    for (const columns of WIDTHS) {
      test(`${name} at ${columns} columns: two lines, the alerts, a row per agent and shell; none outgrows the band`, () => {
        const lines = bandLines(input, columns, 20)
        expect(lines.length).toBeGreaterThan(0)
        expect(lines.length).toBeLessThanOrEqual(3 + DETAIL_ROWS)
        for (const line of lines) expect(lineCells(line)).toBeLessThanOrEqual(columns)
      })
    }
  }

  test('the foot opens with the model pill and its effort, then each budget as a short name, a gauge and its figure', () => {
    const foot = bandLines(bandOf(STATUS, IDLE), 160, 20).at(-1)
    expect(items(foot).map(i => i.key)).toEqual(['model', 'ctx', 'five_hour', 'seven_day', 'session', 'repo', 'panel'])
    expect(itemText(foot?.left[0])).toBe(`${CAP.left} ✳ Opus 5.5 · high ${CAP.right}`)
    expect(itemText(foot?.left[1])).toBe('ctx [34] 34% 340k/1M')
    expect(itemText(foot?.left[2])).toBe('5h [62] 62% ↻ 15m')
    expect(itemText(foot?.left[3])).toBe('7d [9] 9% ↻ 4d')
  })

  test('the foot closes with where: the session while no heading says it, the repo, the branch and its state, and the band buttons', () => {
    const foot = bandLines(bandOf(STATUS, IDLE), 160, 20).at(-1)
    expect(itemText(foot?.right[0])).toBe('session 4d17h')
    expect(itemText(foot?.right[1])).toBe('acme \ue0a0 main ●2 ↑1')
    expect(foot?.right.at(-1)?.press).toEqual({ hotkey: 'p', label: 'panel', action: 'panel' })
    // With a heading above, how the session goes is the heading's to say.
    expect(byKey(bandLines(bandOf(STATUS, TOLD), 160, 20), 'session')).toBeUndefined()
  })

  test('a detached head reads detached; other sessions in the checkout are a grey count with a card', () => {
    const foot = bandLines(bandOf(AHEAD_OF_PACE, SHARED_CHECKOUT), 160, 20).at(-1) ?? { left: [], right: [] }
    expect(itemText(byKey([foot], 'repo'))).toBe('shop \ue0a0 detached')
    const crowd = byKey([foot], 'crowd')
    expect(itemText(crowd)).toBe('+3 here')
    expect(cardText(crowd)).toContain('other sessions')
  })

  test('a turn nobody asked for in words still heads the band: its call, spinning, with its time and actions', () => {
    const [head] = bandLines(bandOf(STATUS, WORKING), 160, 20)
    expect(head?.left[0]?.parts[2]).toEqual({ kind: 'spinner', id: 'main', colour: PALETTE.amber })
    expect(itemText(head?.left[0])).toBe('▍ ⠋ Run the HUD tests')
    expect(itemText(head?.right[0])).toBe('working 3m · 14 actions')
  })

  test('the pull request is a link with its checks; orphan loops add a reap button', () => {
    const lines = bandLines(bandOf(ALERT_STATUS, ALERTS), 300, 20)
    const pr = byKey(lines, 'pr')
    expect(pr?.href).toBe('https://github.com/example/shop/pull/41')
    expect(itemText(pr)).toBe('#41 ✗ 2/9')
    expect(byKey(lines, 'reap')?.press).toEqual({ hotkey: 'r', label: 'reap 6', action: 'reap' })
  })

  test('nothing was asked and nothing runs: the foot and no more', () => {
    expect(bandLines(bandOf(STATUS, IDLE), 160, 20)).toHaveLength(1)
  })

  test('the alerts keep a line of their own; an agent in trouble reads on its row, not twice', () => {
    const alertsOf = (lines: readonly BandLine[]) => lines.find(line => line.left[0]?.key.startsWith('alert-'))
    const alerts = alertsOf(bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 300, 20))
    expect(itemText(alerts?.left[0])).toBe('⚠ CI failing (2 of 9)')
    expect(cardText(alerts?.left[0])).toContain('gh pr checks')
    expect(items(alerts).some(i => i.key.startsWith('alert-stalled'))).toBe(false)
    const narrow = alertsOf(bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 40, 20))
    expect(itemText(narrow?.left.at(-1))).toMatch(/^\+\d+ more$/)
  })

  test('every agent and shell gets a row of its own: who, how it stands and since when, and what it does', () => {
    const lines = bandLines(bandOf(STATUS, WORKING, RUNS), 160, 20).slice(1, -1)
    const texts = lines.map(line => itemText(line.left[0]))
    expect(texts).toContain('⠋ width-audit    working 20s  Bash · Measure the band at 40 columns')
    // The main loop has the heading; it takes no row.
    expect(texts.some(t => /^⠋ main +working/.test(t))).toBe(false)
    expect(texts.some(t => /^⠋ main +shell 14m +Executor · inbox redesign$/.test(t))).toBe(true)
    expect(texts.some(t => /^✗ main +exit 2 2m +Lint the plugin$/.test(t))).toBe(true)
    expect(texts.some(t => t.includes('explore types') && t.includes('thinking'))).toBe(true)
    // One column each: every row's state starts at the same cell.
    expect(new Set(texts.map(t => t.search(/ (working|shell|exit|ended) /))).size).toBe(1)
    // The first row keeps a row of air above it; the rest sit tight under it.
    expect(lines.map(line => line.tight === true)).toEqual(lines.map((_, i) => i > 0))
  })

  test('an answer owed ten minutes, or a turn silent as long, turns its row amber and lifts it above the work', () => {
    const owed = { id: 'a-rev', name: 'reviewer', lastAt: NOW - 15 * MIN, busy: 0, isTeammate: true, phase: 'idle' as const, phaseAt: NOW - 15 * MIN, status: 'idle', sentAt: NOW - 15 * MIN, sentTo: 'team-lead' }
    const silent = { id: 'a-quiet', name: 'quiet one', lastAt: NOW - 12 * MIN, busy: 0, phase: 'turn' as const, phaseAt: NOW - 20 * MIN }
    const shared = { ...WORKING, agents: [...(WORKING.agents ?? []), owed, silent] }
    const rows = rowsOf(bandOf(STATUS, shared, RUNS), shared)
    const byName = (who: string) => rows.find(r => r.who === who)
    expect(byName('reviewer')).toEqual(expect.objectContaining({ state: 'waiting 15m', stateColour: PALETTE.amber, rank: 2 }))
    expect(byName('reviewer')?.what[0]?.t).toBe('waits on team-lead: answer it or close it')
    expect(byName('quiet one')).toEqual(expect.objectContaining({ state: 'silent 12m', stateColour: PALETTE.amber, rank: 2 }))
    expect(rows.findIndex(r => r.who === 'reviewer')).toBeLessThan(rows.findIndex(r => r.who === 'width-audit'))
  })

  test("a workflow's agents at work share one row under its name; one in trouble keeps its own", () => {
    const agent = (id: string, name: string, extra: object) => ({ id, name, lastAt: NOW - 10_000, busy: 1, phase: 'turn' as const, phaseAt: NOW - 2 * MIN, workflow: 'wf_run1', ...extra })
    const shared = {
      ...IDLE,
      workflows: { wf_run1: 'review-changes' },
      agents: [
        agent('w1', 'review:bugs', {}),
        agent('w2', 'review:perf', {}),
        agent('w3', 'verify:a', { busy: 0, phase: 'idle', isTeammate: true, status: 'idle', phaseAt: NOW - 4 * MIN, sentAt: NOW - 4 * MIN, sentTo: 'team-lead' }),
        agent('w4', 'verify:b', { busy: 0, phase: 'idle', isTeammate: true, status: 'idle', phaseAt: NOW - 4 * MIN }),
      ],
    }
    const rows = rowsOf(bandOf(STATUS, shared), shared)
    const flow = rows.find(r => r.kind === 'workflow')
    expect(flow).toEqual(expect.objectContaining({ who: 'review-changes', state: '3 agents 4m' }))
    expect(flow?.what[0]?.t).toBe('2 working, 1 waiting: review:bugs, review:perf')
    // The stalled one is not folded into the workflow's row: it reads loud, first.
    expect(rows[0]).toEqual(expect.objectContaining({ kind: 'agent', who: 'verify:b', state: 'stalled 4m' }))
    expect(rows.filter(r => r.kind === 'agent').map(r => r.who)).toEqual(['verify:b'])
    // Without its name the run id stands in.
    expect(rowsOf(bandOf(STATUS, { ...shared, workflows: undefined }), { ...shared, workflows: undefined }).find(r => r.kind === 'workflow')?.who).toBe('wf_run1')
  })

  test('the same shell launched twice reads once with its count; one whose output stopped changing says since when', () => {
    const watch = { label: 'Vigilar hasta que PROD sirva #3147', state: 'running' as const }
    const runs = [
      { ...watch, startedAt: NOW - 11 * MIN, quietSince: NOW - 11 * MIN },
      { ...watch, startedAt: NOW - 10 * MIN, quietSince: NOW - MIN },
      { label: 'Generar el boceto A', startedAt: NOW - 2 * MIN, state: 'running' as const, quietSince: NOW - 5_000 },
    ]
    const rows = rowsOf(bandOf(STATUS, IDLE, runs), IDLE).filter(r => r.kind === 'shell')
    expect(rows).toHaveLength(2)
    const twice = rows.find(r => r.what[0]?.t === watch.label)
    expect(twice?.state).toBe('shell 10m ×2')
    expect(twice?.what.map(p => p.t).join('')).toBe(`${watch.label} · launched 2 times`)
    const silent = rowsOf(bandOf(STATUS, IDLE, [runs[0]!]), IDLE)[0]
    expect(silent?.what.map(p => p.t).join('')).toBe(`${watch.label} · no output for 11m`)
    expect(silent?.what[1]?.color).toBe(PALETTE.amber)
    // A shell that writes reads plainly.
    expect(rows.find(r => r.what[0]?.t === 'Generar el boceto A')?.what).toHaveLength(1)
  })

  test('each live session elsewhere on the bus gets a row: its callsign, where, and what it says it does', () => {
    const peer = (session: string, intent: string | null, liveness = 'live') => ({ session, harness: 'claude-code', place: 'shop', repo: '/w/shop', branch: null, intent, liveness, lastMs: NOW - 25 * MIN })
    const input = { ...bandOf(STATUS, IDLE), peers: [peer('s1', 'Vesper: wrapping up; #3155 and #3152 left'), peer('s2', null), peer('s3', 'Old: nothing', 'stale')] }
    const texts = bandLines(input, 160, 20).slice(0, -1).map(line => itemText(line.left[0]))
    expect(texts).toEqual(['◆ Vesper          shop 25m  wrapping up; #3155 and #3152 left', '◆ claude-code s2  shop 25m  no stated intent'])
    expect(peerWords(peer('x', 'no name up front'))).toEqual({ name: 'claude-code x', mission: 'no name up front' })
    // A state wider than its column is cut, so what each row does still starts at the same cell.
    const long = { ...input, peers: [{ ...peer('s4', 'Longer: some'), repo: '/w/a-repository-with-a-long-name' }, peer('s1', 'Vesper: short')] }
    const aligned = bandLines(long, 160, 20).slice(0, -1).map(line => itemText(line.left[0]))
    expect(new Set(aligned.map(t => t.search(/ {2}(some|short)$/))).size).toBe(1)
  })

  test('two sessions started the same day never share a name', () => {
    // UUIDv7 ids open with their timestamp: same-day sessions share the first characters.
    const a = '019a2b3c-4d5e-7f00-8123-4567890a1b2c'
    const b = '019a2b3c-4d5e-7f00-8999-fedcba98d7e6'
    const row = (session: string, extra: Record<string, unknown> = {}) => ({ session, root: session, harness: 'codex', lifecycle: 'active', liveness: 'live', cwd: '/w/shop', ...extra })
    // A command that gives no names: the fallback reads the random tail of the id.
    const names = peersFrom(JSON.stringify([row(a), row(b)]), 'me').map(p => peerWords(p).name)
    expect(new Set(names).size).toBe(2)
    expect(names.sort()).toEqual(['codex 1b2c', 'codex d7e6'])
    // A command that names them: its name wins over the one an intent opens with, which still leaves the mission.
    const named = peersFrom(JSON.stringify([row(a, { display_name: 'Vesper', intent: 'Juniper: move the queue' }), row(b, { display_name: ' Juniper ' })]), 'me')
    expect(named.map(peerWords)).toEqual([
      { name: 'Vesper', mission: 'move the queue' },
      { name: 'Juniper', mission: '' },
    ])
    // A blank name is no name.
    expect(peersFrom(JSON.stringify([row(a, { display_name: '  ' })]), 'me').map(p => peerWords(p).name)).toEqual(['codex 1b2c'])
  })

  test("other sessions sit under their own title when they share the band with this session's rows", () => {
    const other = { session: 's1', harness: 'codex', place: 'shop', repo: '/w/shop', branch: null, intent: 'Juniper: cut the release', liveness: 'live', lastMs: NOW - MIN }
    const shell = (label: string, age: number) => ({ label, startedAt: NOW - age * MIN, state: 'running' as const, quietSince: NOW - 5_000 })
    const own = [shell('Wait for PR 3186', 2)]
    const textsOf = (input: Parameters<typeof bandLines>[0], rows: number) => bandLines(input, 160, rows).slice(0, -1).map(line => itemText(line.left[0]))
    const mixed = { ...bandOf(STATUS, IDLE, own), peers: [other] }
    const lines = textsOf(mixed, 20)
    const title = lines.findIndex(isPeersTitle)
    expect(title).toBeGreaterThan(0)
    // The title is a rule across the band.
    expect(lines[title]).toMatch(/^── .* ─+$/)
    expect([...(lines[title] ?? '')].length).toBe(160)
    expect(lines[title + 1]).toStartWith('◆ Juniper')
    expect(lines.slice(0, title).some(line => line.startsWith('◆'))).toBe(false)
    // Only other sessions: nothing to tell apart, so no title.
    expect(textsOf({ ...bandOf(STATUS, IDLE), peers: [other] }, 20).some(isPeersTitle)).toBe(false)
    // Two rows of room: both rows, no title.
    expect(textsOf(mixed, 3)).toHaveLength(2)
    expect(textsOf(mixed, 3).some(isPeersTitle)).toBe(false)
    // Short of room the other session is counted rather than drawn, and its title gives the line back to this session's rows.
    const crowded = { ...bandOf(STATUS, IDLE, [shell('Build the site', 1), shell('Run the e2e suite', 2), shell('Watch the deploy', 3)]), peers: [other] }
    const tight = textsOf(crowded, 4)
    expect(tight).toHaveLength(3)
    expect(tight.some(isPeersTitle)).toBe(false)
    expect(tight.filter(line => line.startsWith('⠋'))).toHaveLength(2)
    expect(tight[2]).toStartWith('+2')
    // The title is the active language's.
    try {
      useLanguage('es')
      expect(isPeersTitle(lines[title] ?? '')).toBe(false)
      expect(textsOf(mixed, 20).some(isPeersTitle)).toBe(true)
    } finally {
      useLanguage('en')
    }
  })

  test('the main loop between calls says the last thing it did', () => {
    const shared = { ...WORKING, turn: { startedAt: NOW - 3 * MIN, actions: 14, denials: 0, tool: null, previous: 'Leer el panel' } }
    const [head] = bandLines(bandOf(STATUS, shared, RUNS), 160, 20)
    expect(itemText(head?.left[0])).toBe('▍ ⠋ thinking · last: Leer el panel')
  })

  test('the most urgent rows come first: a stall, then a failing shell, then the work', () => {
    const rows = rowsOf(bandOf(ALERT_STATUS, ALERTS, RUNS), ALERTS).map(r => r.key)
    expect(rows[0]).toBe('agent-a-types')
    expect(rows[1]).toMatch(/^shell-/)
    expect(rows.indexOf('agent-a-width')).toBeLessThan(rows.findIndex(k => k.startsWith('shell-') && k !== rows[1]))
  })

  test('short of rows, the least urgent go and one row counts them; with none to spare, one row sums them up', () => {
    const lines = bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 160, 5)
    expect(lines).toHaveLength(5)
    // The heading, the alerts, one row, the count of the rest, the foot.
    expect(itemText(lines[2]?.left[0])).toContain('explore types')
    expect(itemText(lines[3]?.left[0])).toMatch(/^\+5 more: 1 agent, 4 shells · p opens the panel$/)
    expect(byKey([lines[4] ?? { left: [], right: [] }], 'ctx')).toBeDefined()
    const one = bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 160, 4)
    expect(itemText(one[2]?.left[0])).toBe('2 agents, 4 shells · p opens the panel')
  })

  test('a narrow band still names every agent, and no row outgrows it', () => {
    for (const columns of [40, 60]) {
      const lines = bandLines(bandOf(STATUS, WORKING, RUNS), columns, 20).slice(1, -1)
      const texts = lines.map(line => itemText(line.left[0]))
      expect(texts.some(t => t.includes('widt'))).toBe(true)
      expect(texts.some(t => t.includes('expl'))).toBe(true)
      for (const line of lines) expect(lineCells(line)).toBeLessThanOrEqual(columns)
    }
  })

  test('the band speaks English by default, and Spanish from its dictionary when chosen', () => {
    const wordsOf = () => bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 300, 20).flatMap(items).map(i => `${itemText(i)} ${cardText(i)}`).join(' ')
    const english = wordsOf()
    for (const spanish of ['sesión', 'trabaj', 'agentes', 'acciones', 'falla', 'denegad', 'parado', 'espera', 'pensando', 'reinicia', ' más', 'principal', 'aquí']) expect(english).not.toContain(spanish)
    try {
      useLanguage('es')
      const spanish = wordsOf()
      for (const word of ['sesión 4d17h', 'trabajando 3m', '14 acciones', 'CI falla (2 de 9)', 'parado', 'principal', 'se reinicia']) expect(spanish).toContain(word)
      for (const word of ['session', 'working', 'actions', 'failing', 'stalled', 'resets']) expect(spanish).not.toContain(word)
      // A dictionary read from disk overrides the built-in words it names, and only those.
      useLanguage('es', { 'band.working': 'currando {time}' })
      expect(wordsOf()).toContain('currando 3m')
      expect(wordsOf()).toContain('14 acciones')
      // An unknown language reads English.
      useLanguage('xx')
      expect(wordsOf()).toBe(english)
    } finally {
      useLanguage('en')
    }
  })

  test('short of rows the last lines go; none at zero; hidden, none', () => {
    expect(bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 160, 1)).toHaveLength(1)
    expect(bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 160, 0)).toEqual([])
    expect(bandLines(bandOf(STATUS, { ...IDLE, mode: 'hidden' }), 160, 20)).toEqual([])
  })
})

describe('band cards', () => {
  test('every budget carries a card: tokens for the context, reset and pace for a window, with its trend', () => {
    const lines = bandLines(bandOf(ALERT_STATUS, { ...ALERTS, history: FILLING }), 300, 20)
    expect(cardText(byKey(lines, 'ctx'))).toBe('920,000 of 1,000,000 tokens · 8% free')
    const five = cardText(byKey(lines, 'five_hour'))
    expect(five).toMatch(/^resets 17:05 · 40% of the window gone, ahead of pace · /)
    expect(five).toMatch(/[▁▂▃▄▅▆▇█]{3}$/)
    expect(cardText(bandLines(bandOf(AHEAD_OF_PACE, SHARED_CHECKOUT), 300, 20).flatMap(items).find(i => i.key === 'seven_day'))).toContain('ahead of pace')
  })

  test('the model and the repo carry cards: the effort and the session, then what is uncommitted and unpushed', () => {
    const lines = bandLines(bandOf(STATUS, IDLE), 300, 20)
    expect(cardText(byKey(lines, 'model'))).toBe('Opus 5.5 · effort high · session 4d17h')
    expect(cardText(byKey(lines, 'repo'))).toBe('2 uncommitted files · 1 to push · 0 to pull · no other session here')
  })
})

describe('band colours', () => {
  test('a gauge takes its budget colour: cyan on course, amber ahead of the clock, red when it fills', () => {
    const gaugeOf = (lines: BandLine[], key: string) => byKey(lines, key)?.parts.find(p => p.kind === 'gauge')
    expect(gaugeOf(bandLines(bandOf(STATUS, IDLE), 300, 20), 'ctx')).toEqual({ kind: 'gauge', id: 'ctx', value: 34, colour: PALETTE.cyan, inner: 10 })
    expect(gaugeOf(bandLines(bandOf(AHEAD_OF_PACE, SHARED_CHECKOUT), 300, 20), 'seven_day')).toEqual(expect.objectContaining({ colour: PALETTE.amber }))
    expect(gaugeOf(bandLines(bandOf(ALERT_STATUS, ALERTS), 300, 20), 'five_hour')).toEqual(expect.objectContaining({ colour: PALETTE.red }))
  })

  test('the thresholds: context amber from 70% and red from 85%; a quota amber from 75% or ahead, red from 90% or filling', () => {
    const week = (percent: number, daysLeft: number) => ({ kind: 'seven_day', percent, resetsAt: NOW + daysLeft * DAY })
    expect([contextColour(69), contextColour(70), contextColour(85)]).toEqual([PALETTE.cyan, PALETTE.amber, PALETTE.red])
    expect(elapsedOf(week(0, 3.5), NOW)).toBe(0.5)
    expect([isAheadOfPace(week(60, 4.5), NOW), isAheadOfPace(week(60, 1), NOW)]).toEqual([true, false])
    expect([quotaColour(week(40, 6.5), NOW, false), quotaColour(week(76, 0.2), NOW, false), quotaColour(week(90, 0.2), NOW, false), quotaColour(week(20, 6), NOW, true)]).toEqual([
      PALETTE.cyan,
      PALETTE.amber,
      PALETTE.red,
      PALETTE.red,
    ])
  })

  test('the pane keeps the theme: no tone fades to dim or subtle', () => {
    for (const props of Object.values(THEME)) {
      expect(props.color).not.toBe('subtle')
      expect('dimColor' in props).toBe(false)
    }
  })
})

describe('band notices', () => {
  test('alerts in the status line\'s words, each with a key that lasts as long as it does', () => {
    expect(noticesOf(ALERTS, NOW).map(n => [n.key, n.long])).toEqual([
      ['ci', 'CI failing (2 of 9)'],
      ['loops', '6 orphan Codex loops → press r'],
      ['stalled:explore types', 'agent stalled 12 min: explore types'],
      ['denials', '3 actions denied this turn'],
    ])
  })

  test('budgets that ask for attention: a context near compaction, a window that fills, one ahead of pace', () => {
    const snapshot = { percent: 92, tokens: 920_000, window: 1_000_000, limits: ALERT_STATUS.limits }
    expect(budgetNotices(snapshot, ALERTS, NOW).map(n => [n.key, n.tone, n.long])).toEqual([
      ['ctx', 'bad', 'context at 92%: compact now'],
      ['fill:five_hour', 'bad', '5h quota full in 40m'],
    ])
    const ahead = { window: 200_000, limits: AHEAD_OF_PACE.limits }
    expect(budgetNotices(ahead, SHARED_CHECKOUT, NOW).map(n => n.long)).toEqual(['7d quota ahead of pace (60%)'])
  })
})

describe('band words', () => {
  test('durations, sizes and times as a status line writes them', () => {
    expect([compact(45_000), compact(12 * MIN), compact(195 * MIN), compact((4 * 24 + 13) * 60 * MIN)]).toEqual(['45s', '12m', '3h15m', '4d13h'])
    expect([size(950), size(49_000), size(1_000_000), size(1_200_000)]).toEqual(['950', '49k', '1M', '1.2M'])
    expect([at(NOW + 2 * 60 * MIN, NOW, TZ), at(NOW + DAY, NOW, TZ), at(NOW + 4 * DAY, NOW, TZ)]).toEqual(['16:05', 'tomorrow 14:05', 'Wed 14:05'])
  })
})

describe('band gauge', () => {
  test('a rounded gauge: caps lit once anything is used and when full, cells lit up to the share', () => {
    expect(gaugeRuns(34, 10, 'C', 'T')).toEqual([{ t: CAP.left, fg: 'C' }, { t: '   ', bg: 'C' }, { t: '       ', bg: 'T' }, { t: CAP.right, fg: 'T' }])
    expect(gaugeRuns(0, 4, 'C', 'T')[0]).toEqual({ t: CAP.left, fg: 'T' })
    expect(gaugeRuns(100, 4, 'C', 'T').at(-1)).toEqual({ t: CAP.right, fg: 'C' })
  })

  test('the animation eases a quarter of the way each frame and lands exactly', () => {
    expect(easedToward(0, 40)).toBe(10)
    expect(easedToward(39.5, 40)).toBe(40)
    expect(easedToward(60, 20)).toBe(50)
  })
})

describe('band view', () => {
  const { Band } = createBandView(STAND_INS, STILL_PARTS)

  test('a row of air above each line but a tight one: the rows of agents and shells sit together', () => {
    const lines = bandLines(bandOf(STATUS, WORKING, RUNS), 160, 20)
    const tree = Band({ lines, columns: 160, pad: 1, gap: 1 }) as unknown as { children: { props: Record<string, unknown> }[] }
    expect(tree.children.map(line => line.props.marginTop)).toEqual(lines.map((line, i) => (i > 0 && line.tight !== true ? 1 : 0)))
  })

  test('each line is drawn as one row no wider than the band; cards take no room', () => {
    for (const columns of WIDTHS) {
      const lines = bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), columns, 20)
      const rows = drawn(Band({ lines, columns }), true)
      expect(rows).toHaveLength(lines.length)
      for (const row of rows) expect([...row].length).toBeLessThanOrEqual(columns)
    }
    const foot = drawn(Band({ lines: bandLines(bandOf(STATUS, IDLE), 160, 20), columns: 160 }), true).at(-1)
    expect(foot).toMatch(/7d .*9% ↻ 4d +session 4d17h {3}acme  main ●2 ↑1 {3}p: panel$/)
  })

  test('a card is drawn hidden under its item, shown by the surface while the pointer is on it', () => {
    const tree = Band({ lines: bandLines(bandOf(STATUS, IDLE), 160, 20), columns: 160, pad: 1, gap: 1 }) as unknown as { props: Record<string, unknown> }
    expect(tree.props).toEqual(expect.objectContaining({ paddingTop: 1, paddingBottom: 1 }))
    const boxes: Record<string, unknown>[] = []
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return
      const n = node as { type: string; props: Record<string, unknown>; children: unknown[] }
      if (n.type === 'Box') boxes.push(n.props)
      for (const child of n.children ?? []) walk(child)
    }
    walk(tree)
    const cards = boxes.filter(props => props.display === 'none')
    expect(cards.length).toBeGreaterThanOrEqual(5)
    for (const card of cards) expect(card).toEqual(expect.objectContaining({ position: 'absolute', top: 1, hover: { display: 'flex' } }))
    expect(boxes.filter(props => props.key === 'ctx')).toHaveLength(1)
  })
})

describe('the heading: what the session is about', () => {
  const textOf = (line: BandLine | undefined) => words(itemText(line?.left[0]))
  const told = (rows = 20, columns = 160) => bandLines({ ...bandOf(STATUS, TOLD, RUNS), mates: MATES }, columns, rows)

  test('at work it reads the goal with how the turn goes, what it does now with the call that runs, and what it has so far', () => {
    const [goal, now, soFar] = told(20, 220)
    expect(textOf(goal)).toBe('⠋ Stop the status line overflowing at 70 columns')
    // Beside how the turn goes, its pulse: the calls of the last minutes, span by span.
    expect(itemText(goal?.right[0])).toBe('▁▂▅▃▁▁▂▆█▅▂▃ working 3m · 14 actions')
    expect(cardText(goal?.left[0])).toBe(`asked: ${MAIN_STORY.asks?.[0]}`)
    expect(textOf(now)).toBe('now  Measuring the line at three widths to confirm the separator miscount  ▸ Run the HUD tests')
    expect(textOf(soFar)).toBe('so far  Found the cut ignores separators; two fixes in place, tests not run yet  9 reads · 4 searches · 2 edits in status.ts, text.ts · 5 commands · 2 agents started')
    expect([goal, now, soFar].map(line => line?.tight === true)).toEqual([false, true, true])
  })

  test('until a model has read the work, the request is the goal and the loop\'s own last words are what it does', () => {
    const { brief: _brief, ...unread } = MAIN_STORY
    const [goal, now] = bandLines(bandOf(STATUS, { ...TOLD, story: unread }), 200, 20)
    expect(textOf(goal)).toBe(`⠋ ${MAIN_STORY.asks?.[0]}`)
    expect(textOf(now)).toBe(`now  ${MAIN_STORY.said}  ▸ Run the HUD tests`)
  })

  test('a reading of the request before this one is of another task: the new request stands until it is read', () => {
    const story = { ...MAIN_STORY, asks: ['Now rename the option'], askedAt: NOW - 5_000 }
    expect(briefOf(story)).toBeUndefined()
    expect(briefOf(MAIN_STORY)).toBe(MAIN_STORY.brief)
    expect(textOf(bandLines(bandOf(STATUS, { ...TOLD, story }), 160, 20)[0])).toBe('⠋ Now rename the option')
  })

  test('with no call running, the thought that streams is the pulse; with no words at all, it stands alone', () => {
    const quiet = { ...TOLD, turn: { startedAt: NOW - 3 * MIN, actions: 14, denials: 0, tool: null } }
    const live = { main: { thinking: 'the separators are counted after the cut' } }
    expect(textOf(bandLines({ ...bandOf(STATUS, quiet), live }, 200, 20)[1])).toBe(`now  ${MAIN_STORY.brief?.now}  ∴ the separators are counted after the cut`)
    const wordless = { ...quiet, story: { asks: MAIN_STORY.asks, askedAt: MAIN_STORY.askedAt } }
    expect(textOf(bandLines({ ...bandOf(STATUS, wordless), live }, 200, 20)[1])).toBe('now  ∴ the separators are counted after the cut')
    expect(textOf(bandLines(bandOf(STATUS, wordless), 200, 20)[1])).toBe('now  thinking')
  })

  test('between turns it reads how the last one ended: the model\'s reading of the end, or the answer\'s own opening until it has one', () => {
    const [goal, result, soFar] = bandLines(bandOf(STATUS, RESTED), 160, 20)
    expect(textOf(goal)).toBe('◆ Stop the status line overflowing at 70 columns')
    expect(itemText(goal?.right[0])).toBe('ended 5m ago')
    expect(textOf(result)).toBe('result  Fixed the separator miscount and added width tests')
    expect(textOf(soFar)).toStartWith('so far  All 248 tests pass; nothing committed')
    // The reading on screen was made before the turn ended: the answer speaks for itself.
    const stale = { ...RESTED, story: { ...RESTED.story, brief: MAIN_STORY.brief && { ...MAIN_STORY.brief, at: NOW - 6 * MIN } } }
    const lines = bandLines(bandOf(STATUS, stale), 160, 20)
    expect(textOf(lines[1])).toBe('result  Fixed: the cut now counts separators. Three new tests cover 40, 70 and 120 columns.')
    expect(lines).toHaveLength(3)
  })

  test('the goal keeps its line: how the turn goes sits beside it only while the whole goal fits', () => {
    expect(itemText(told(20, 100)[0]?.right[0])).toBe('▁▂▅▃▁▁▂▆█▅▂▃ working 3m · 14 actions')
    expect(itemText(told(20, 80)[0]?.right[0])).toBe('working 3m · 14 actions')
    expect(itemText(told(20, 66)[0]?.right[0])).toBe('working 3m')
    const narrow = told(20, 50)[0]
    expect(narrow?.right).toEqual([])
    expect(textOf(narrow)).toBe('⠋ Stop the status line overflowing at 70 columns')
    for (const columns of WIDTHS) for (const line of told(20, columns)) expect(lineCells(line)).toBeLessThanOrEqual(columns)
  })

  test('each agent\'s row says what it is on, in words, with its call as the pulse; with rows to spare, its goal and what it has so far sit under it', () => {
    const texts = told().map(textOf)
    const audit = texts.findIndex(t => t.includes('width-audit'))
    expect(texts[audit]).toBe('⠋ width-audit  working 20s  Running every fixture at 40 columns  ▸ Bash · Measure the band at 40 columns')
    expect(texts[audit + 1]).toBe('╰ Find which band lines overflow at narrow widths · so far: 70 and 120 columns are clean · 3 reads · 1 search · 4 commands')
    // Under the pointer, the task it was given, whole.
    expect(cardText(byKey(told(), 'agent-a-width'))).toStartWith('asked: Measure the band at 40, 70 and 120 columns against every fixture and report which lines overflow. · width-audit · working')
    // One no model has read yet speaks in its own last words, under the task it was given.
    const types = texts.findIndex(t => t.includes('explore types'))
    expect(texts[types]).toBe('⠋ explore types  working 3m  Three readers so far; checking the tools folder next.')
    expect(texts[types + 1]).toBe('╰ List every place the Shared type is read outside the hooks module.')
    // Short of rows the second lines go first, all of them, and then the heading's third line.
    const tight = told(13).map(textOf)
    expect(tight.some(t => t.startsWith('╰'))).toBe(false)
    expect(tight.some(t => t.startsWith('so far'))).toBe(true)
    expect(told(12).map(textOf).some(t => t.startsWith('so far'))).toBe(false)
  })

  test('an agent that stands still says why, then what it was on', () => {
    const idle = { ...(TOLD.agents?.[0] ?? { name: 'x', lastAt: NOW }), busy: 0, isTeammate: true, phase: 'idle' as const, phaseAt: NOW - 4 * MIN, status: 'idle', doing: undefined }
    const shared = { ...TOLD, agents: [idle] }
    const row = rowsOf(bandOf(STATUS, shared), shared).find(r => r.who === 'width-audit')
    expect(row?.what.map(p => p.t).join('')).toBe('idle with nothing to wake it · Find which band lines overflow at narrow widths')
    expect(row?.what[0]?.color).toBe(PALETTE.red)
  })

  test('an agent that reported a moment ago keeps a row with how its report opened', () => {
    expect(told().map(textOf)).toContain('✓ docs-check  reported 40s  The README describes the band as two lines; the options table is current.')
  })

  test('other sessions that run binnacle come last, under their title, each with its goal and what it does or how it ended', () => {
    const texts = told().map(textOf)
    const title = texts.findIndex(isPeersTitle)
    expect(texts.slice(title + 1, title + 3)).toEqual([
      '⠋ acme  working 7m  Sync the docs site with the new options  ▸ Rewriting the options table',
      '◆ shop  ended 4m ago  Make the cart total survive a reload  ✓ Stored in the session; one test still fails',
    ])
    expect(byKey(told(), 'model')).toBeDefined()
    expect(title + 3).toBe(texts.length - 1)
  })

  test('a session the sessions command also lists gets one row: the command names it, its own state file tells its story', () => {
    const peer = { session: 'b1c2d3e4', displayName: 'Vesper', harness: 'claude-code', place: 'acme', repo: '/home/dev/acme', branch: 'main', intent: null, liveness: 'live', lastMs: NOW }
    const other = { ...peer, session: 'zzzz', displayName: 'Juniper', intent: 'cutting the release' }
    const input = { ...bandOf(STATUS, IDLE), mates: MATES, peers: [peer, other] }
    const rows = rowsOf(input, IDLE).filter(r => r.kind === 'peer')
    expect(rows.map(r => r.who)).toEqual(['Vesper', 'shop', 'Juniper'])
    expect(rows[0]?.what.map(p => p.t).join('')).toBe('acme · Sync the docs site with the new options  ▸ Rewriting the options table')
    expect(rows[2]?.what[0]?.t).toBe('cutting the release')
  })

  test('the heading speaks Spanish from its dictionary when chosen', () => {
    try {
      useLanguage('es')
      const [goal, now, soFar] = told(20, 220)
      expect(itemText(goal?.right[0])).toEndWith(' trabajando 3m · 14 acciones')
      expect(textOf(now)).toStartWith('ahora  ')
      expect(textOf(soFar)).toContain('9 lecturas · 4 búsquedas · 2 ediciones en status.ts, text.ts · 5 órdenes · 2 agentes lanzados')
      expect(textOf(bandLines(bandOf(STATUS, RESTED), 160, 20)[1])).toStartWith('resultado  ')
      expect(itemText(bandLines(bandOf(STATUS, RESTED), 160, 20)[0]?.right[0])).toBe('terminó hace 5m')
    } finally {
      useLanguage('en')
    }
  })
})
