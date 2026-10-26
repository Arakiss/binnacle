import { describe, expect, test } from 'claude-code/testing'

import { t, useLanguage } from '../i18n'

import { at, bandLines, budgetNotices, compact, contextColour, DETAIL_ROWS, elapsedOf, isAheadOfPace, lineCells, noticesOf, PALETTE, peerWords, quotaColour, rowsOf, size, THEME, type BandLine, type Item } from '../render/band'
import { createBandView } from '../render/band-view'
import { CAP, easedToward, gaugeRuns } from '../render/gauge'
import { peersFrom } from '../model/signals'
import { drawn, STAND_INS, STILL_PARTS } from '../tools/draw'
import { AHEAD_OF_PACE, ALERT_STATUS, ALERTS, bandOf, FILLING, IDLE, NO_REPO, NOW, RUNS, SHARED_CHECKOUT, STATUS, TZ, WORKING } from './fixtures'

const MIN = 60_000
const DAY = 24 * 60 * MIN
const WIDTHS = [40, 60, 90, 120, 160, 300]

/** An item's text, a gauge as `[value]`, a spinner as its first frame. */
const itemText = (item: Item | undefined) => (item?.parts ?? []).map(p => (p.kind === 'text' ? p.t : p.kind === 'gauge' ? `[${p.value}]` : '◐')).join('')
const items = (line: BandLine | undefined) => [...(line?.left ?? []), ...(line?.right ?? [])]
const byKey = (lines: readonly BandLine[], key: string) => lines.flatMap(items).find(i => i.key === key)
const cardText = (item: Item | undefined) => (item?.card ?? []).map(p => p.t).join('')

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

  test('line one is the model pill with its effort, then each budget as a short name, a gauge and its figure', () => {
    const [budgets] = bandLines(bandOf(STATUS, IDLE), 160, 20)
    expect(items(budgets).map(i => i.key)).toEqual(['model', 'ctx', 'five_hour', 'seven_day'])
    expect(itemText(budgets?.left[0])).toBe(`${CAP.left} ✳ Opus 5.5 · high ${CAP.right}`)
    expect(itemText(budgets?.left[1])).toBe('ctx [34] 34% 340k/1M')
    expect(itemText(budgets?.left[2])).toBe('5h [62] 62% ↻ 15m')
    expect(itemText(budgets?.left[3])).toBe('7d [9] 9% ↻ 4d')
  })

  test('line two is where: the repo, the branch and its state, the session, and the band buttons on the right', () => {
    const [, where] = bandLines(bandOf(STATUS, IDLE), 160, 20)
    expect(itemText(where?.left[0])).toBe('acme  main ●2 ↑1')
    expect(itemText(where?.left[1])).toBe('session 4d17h')
    expect(where?.right.map(i => i.press)).toEqual([{ hotkey: 'p', label: 'panel', action: 'panel' }])
  })

  test('a detached head reads detached; other sessions in the checkout are a grey count with a card', () => {
    const [, where] = bandLines(bandOf(AHEAD_OF_PACE, SHARED_CHECKOUT), 160, 20)
    expect(itemText(where?.left[0])).toBe('shop  detached')
    const crowd = byKey([where ?? { left: [], right: [] }], 'crowd')
    expect(itemText(crowd)).toBe('+3 here')
    expect(cardText(crowd)).toContain('other sessions')
  })

  test('while a turn runs the session spins, with its time and actions', () => {
    const lines = bandLines(bandOf(STATUS, WORKING), 160, 20)
    const session = byKey(lines, 'session')
    expect(session?.parts[0]).toEqual({ kind: 'spinner', id: 'session', colour: PALETTE.amber })
    expect(itemText(session)).toBe('◐ working 3m · 14 actions · 2 agents')
  })

  test('the pull request is a link with its checks; orphan loops add a reap button', () => {
    const lines = bandLines(bandOf(ALERT_STATUS, ALERTS), 300, 20)
    const pr = byKey(lines, 'pr')
    expect(pr?.href).toBe('https://github.com/example/shop/pull/41')
    expect(itemText(pr)).toBe('#41 ✗ 2/9')
    expect(byKey(lines, 'reap')?.press).toEqual({ hotkey: 'r', label: 'reap 6', action: 'reap' })
  })

  test('nothing asks and nothing runs: two lines and no more', () => {
    expect(bandLines(bandOf(STATUS, IDLE), 160, 20)).toHaveLength(2)
  })

  test('the alerts keep a line of their own; an agent in trouble reads on its row, not twice', () => {
    const [, , alerts] = bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 300, 20)
    expect(itemText(alerts?.left[0])).toBe('⚠ CI failing (2 of 9)')
    expect(cardText(alerts?.left[0])).toContain('gh pr checks')
    expect(items(alerts).some(i => i.key.startsWith('alert-stalled'))).toBe(false)
    const [, , narrow] = bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 40, 20)
    expect(itemText(narrow?.left.at(-1))).toMatch(/^\+\d+ more$/)
  })

  test('every agent and shell gets a row of its own: who, how it stands and since when, and what it does', () => {
    const lines = bandLines(bandOf(STATUS, WORKING, RUNS), 160, 20).slice(2)
    const texts = lines.map(line => itemText(line.left[0]))
    expect(texts).toContain('◐ width-audit    working 20s  Bash · Measure the band at 40 columns')
    expect(texts).toContain('◐ main           working 3m   Run the HUD tests')
    expect(texts.some(t => /^◐ main +shell 14m +Executor · inbox redesign$/.test(t))).toBe(true)
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
    const texts = bandLines(input, 160, 20).slice(2).map(line => itemText(line.left[0]))
    expect(texts).toEqual(['◆ Vesper          shop 25m  wrapping up; #3155 and #3152 left', '◆ claude-code s2  shop 25m  no stated intent'])
    expect(peerWords(peer('x', 'no name up front'))).toEqual({ name: 'claude-code x', mission: 'no name up front' })
    // A state wider than its column is cut, so what each row does still starts at the same cell.
    const long = { ...input, peers: [{ ...peer('s4', 'Longer: some'), repo: '/w/a-repository-with-a-long-name' }, peer('s1', 'Vesper: short')] }
    const aligned = bandLines(long, 160, 20).slice(2).map(line => itemText(line.left[0]))
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
    const textsOf = (input: Parameters<typeof bandLines>[0], rows: number) => bandLines(input, 160, rows).slice(2).map(line => itemText(line.left[0]))
    const mixed = { ...bandOf(STATUS, IDLE, own), peers: [other] }
    const lines = textsOf(mixed, 20)
    const title = lines.indexOf(t('row.peersTitle'))
    expect(title).toBeGreaterThan(0)
    expect(lines[title + 1]).toStartWith('◆ Juniper')
    expect(lines.slice(0, title).some(line => line.startsWith('◆'))).toBe(false)
    // Only other sessions: nothing to tell apart, so no title.
    expect(textsOf({ ...bandOf(STATUS, IDLE), peers: [other] }, 20)).not.toContain(t('row.peersTitle'))
    // Two rows of room: both rows, no title.
    expect(textsOf(mixed, 4)).toHaveLength(2)
    expect(textsOf(mixed, 4)).not.toContain(t('row.peersTitle'))
    // Short of room the other session is counted rather than drawn, and its title gives the line back to this session's rows.
    const crowded = { ...bandOf(STATUS, IDLE, [shell('Build the site', 1), shell('Run the e2e suite', 2), shell('Watch the deploy', 3)]), peers: [other] }
    const tight = textsOf(crowded, 5)
    expect(tight).toHaveLength(3)
    expect(tight).not.toContain(t('row.peersTitle'))
    expect(tight.filter(line => line.startsWith('◐'))).toHaveLength(2)
    expect(tight[2]).toStartWith('+2')
    // The title is the active language's.
    try {
      useLanguage('es')
      expect(t('row.peersTitle')).not.toBe(lines[title])
      expect(textsOf(mixed, 20)).toContain(t('row.peersTitle'))
    } finally {
      useLanguage('en')
    }
  })

  test('the main loop between calls says the last thing it did', () => {
    const shared = { ...WORKING, turn: { startedAt: NOW - 3 * MIN, actions: 14, denials: 0, tool: null, previous: 'Leer el panel' } }
    const main = rowsOf(bandOf(STATUS, shared, RUNS), shared).find(r => r.kind === 'main')
    expect(main?.what[0]?.t).toBe('thinking · last: Leer el panel')
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
    expect(itemText(lines[3]?.left[0])).toContain('explore types')
    expect(itemText(lines[4]?.left[0])).toMatch(/^\+6 more: 1 agent, 4 shells, main · p opens the panel$/)
    const one = bandLines(bandOf(ALERT_STATUS, ALERTS, RUNS), 160, 4)
    expect(itemText(one[3]?.left[0])).toBe('2 agents, 4 shells, main · p opens the panel')
  })

  test('a narrow band still names every agent, and no row outgrows it', () => {
    for (const columns of [40, 60]) {
      const lines = bandLines(bandOf(STATUS, WORKING, RUNS), columns, 20).slice(2)
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
    const [, where] = drawn(Band({ lines: bandLines(bandOf(STATUS, IDLE), 160, 20), columns: 160 }), true)
    expect(where).toMatch(/^acme  main ●2 ↑1 {3}session 4d17h +p: panel$/)
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
