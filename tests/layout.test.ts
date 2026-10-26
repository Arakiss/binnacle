import { describe, expect, test } from 'claude-code/testing'

import * as act from '../model/activity'
import { alertsOf } from '../model/alerts'
import { crowdOf, gitFrom, offsetFrom, peersFrom, prFrom, remember, untilFull } from '../model/signals'
import { duration, tokens, when } from '../render/format'
import { homeShort, isScratch, paneLines, reasonWords } from '../render/pane'
import { statusLines, type Status } from '../render/status'
import { cells, paint, plainText } from '../render/text'
import type { Shared } from '../types'
import { ALERT_STATUS, ALERTS, API_KEY, busyPane, busyShared, emptyPane, IDLE, NO_REPO, NOW, STATUS, TZ, WORKING } from './fixtures'

const WIDTHS = [70, 80, 110, 170, 300]
const text = (lines: ReturnType<typeof statusLines>) => lines.map(plainText)

const FIXTURES: [string, Status, Shared, number][] = [
  ['idle', STATUS, IDLE, 3],
  ['working with agents', STATUS, WORKING, 3],
  ['alerts', ALERT_STATUS, ALERTS, 4],
  ['no repo', STATUS, NO_REPO, 2],
  ['API key cost', API_KEY, IDLE, 3],
]

describe('status line', () => {
  for (const [name, status, shared, rows] of FIXTURES) {
    for (const columns of WIDTHS) {
      test(`${name} at ${columns} columns: ${rows} lines, none past columns - 2`, () => {
        const lines = statusLines(status, shared, NOW, columns, TZ)
        expect(lines).toHaveLength(rows)
        for (const line of lines) {
          expect(cells(line)).toBeLessThanOrEqual(columns - 2)
          expect(plainText(line)).not.toContain('\n')
        }
      })
    }
  }

  test('idle reads as three short lines: the work, the checkout, the budgets', () => {
    expect(text(statusLines(STATUS, IDLE, NOW, 170, TZ))).toEqual([
      '○ Idle · last turn 5 min · 14 actions · Opus 5.5',
      'acme · main · 2 uncommitted · 1 to push',
      'Context 34% of 1M · 5h 62% ↻ 14:20 · week 9%',
    ])
  })

  test('working names the tool, the actions, the agents and the model', () => {
    const [one] = text(statusLines(STATUS, WORKING, NOW, 170, TZ))
    expect(one).toBe('● Working 3 min · Bash · 14 actions · 2 agents · Opus 5.5')
  })

  test('the status line has numbers only, no bars and no group bars', () => {
    for (const line of text(statusLines(ALERT_STATUS, ALERTS, NOW, 300, TZ))) expect(line).not.toMatch(/[━─█░▏│[\]]/)
  })

  test('grey dominates: an idle, clean, roomy session shows no colour beyond the branch and clean', () => {
    const clean = { ...IDLE, git: { ...IDLE.git!, dirty: 0, ahead: 0 } }
    const [one, two, three] = statusLines(STATUS, clean, NOW, 170, TZ).map(paint)
    expect(one).not.toMatch(/\x1b\[3[1-6]m/)
    expect(one).toContain('\x1b[38;5;247mOpus 5.5')
    expect(two).toContain('\x1b[38;5;117mmain')
    expect(two).toContain('\x1b[38;5;114mclean')
    expect(three).not.toMatch(/\x1b\[3[1-6]m/)
  })

  test('a dirty tree is amber; working puts an accent dot before the work', () => {
    const [working, repo] = statusLines(STATUS, WORKING, NOW, 170, TZ).map(paint)
    expect(working?.startsWith('\x1b[38;5;117m● ')).toBe(true)
    expect(repo).toContain('\x1b[38;5;221m2 uncommitted')
  })

  test('a long branch is cut after a word, and a cut line never ends on a separator', () => {
    const long = { ...WORKING, git: { ...WORKING.git!, branch: 'feat/284339-large-reply-intake-with-more-words-and-then-some' } }
    for (const columns of WIDTHS) {
      for (const line of statusLines(STATUS, long, NOW, columns, TZ).map(plainText)) {
        expect(line).not.toMatch(/·\s*$/)
        expect(line).not.toMatch(/\s…/)
      }
    }
    expect(plainText(statusLines(STATUS, long, NOW, 300, TZ)[1] ?? [])).toContain('acme · feat/284339-large-reply-intake-with…')
  })

  test('at narrow widths the least important goes first: the detail, then the model, then the tool', () => {
    const at56 = text(statusLines(STATUS, WORKING, NOW, 56, TZ))
    expect(at56[0]).toBe('● Working 3 min · Bash · 14 actions · 2 agents')
    const at40 = text(statusLines(STATUS, WORKING, NOW, 40, TZ))
    expect(at40[0]).toBe('● Working 3 min · 2 agents')
    const idle44 = text(statusLines(STATUS, IDLE, NOW, 44, TZ))
    expect(idle44[2]).toBe('Context 34% · 5h 62% · week 9%')
  })

  test('a window that fills before it resets reads red whole, with when, at any width', () => {
    for (const columns of WIDTHS) {
      const lines = statusLines(ALERT_STATUS, ALERTS, NOW, columns, TZ)
      expect(plainText(lines[2] ?? [])).toContain('5h 62% · full in 40 min')
      expect(paint(lines[2] ?? [])).toContain('\x1b[38;5;210m · full in 40 min')
      expect(paint(lines[2] ?? [])).toContain('\x1b[38;5;210m5h ')
    }
  })

  test('short of room, when a window fills reads in its largest unit, never a figure cut in half', () => {
    const week = { ...STATUS, limits: [{ kind: 'seven_day', percent: 46, resetsAt: NOW + 5 * 24 * 3_600_000 }] }
    const slow = { ...IDLE, history: { seven_day: [{ t: NOW - 2 * 3_600_000, p: 30 }, { t: NOW - 3_600_000, p: 38 }, { t: NOW, p: 46 }] } }
    expect(plainText(statusLines(week, slow, NOW, 170, TZ)[2] ?? [])).toContain('week 46% · full in 6 h 45 min')
    expect(plainText(statusLines(week, slow, NOW, 42, TZ)[2] ?? [])).toBe('Context 34% · week 46% · full in 6 h')
  })

  test('context past 90% is red and says compact soon where it fits', () => {
    const [, , three] = statusLines(ALERT_STATUS, ALERTS, NOW, 170, TZ)
    expect(paint(three ?? [])).toContain('\x1b[38;5;210m92%')
    expect(plainText(three ?? [])).toContain('Context 92% of 1M · compact soon')
  })

  test('the alert line puts red first and keeps every alert at 170 columns', () => {
    const four = plainText(statusLines(ALERT_STATUS, ALERTS, NOW, 170, TZ)[3] ?? [])
    expect(four.startsWith('⚠ CI failing (2 of 9) · 6 orphan Codex loops → /binnacle reap')).toBe(true)
    expect(four).toContain('agent stalled')
    expect(four).not.toContain('more')
  })

  test('the alert line counts what it leaves out on a narrow terminal', () => {
    expect(plainText(statusLines(ALERT_STATUS, ALERTS, NOW, 70, TZ)[3] ?? [])).toMatch(/and \d more$/)
  })

  test('a clean tree says clean; no repo leaves the checkout line out', () => {
    const clean = { ...IDLE, git: { ...IDLE.git!, dirty: 0, ahead: 0 } }
    expect(plainText(statusLines(STATUS, clean, NOW, 170, TZ)[1] ?? [])).toBe('acme · main · clean')
    expect(text(statusLines(STATUS, NO_REPO, NOW, 170, TZ))[1]).toBe('Context 34% of 1M · 5h 62% ↻ 14:20 · week 9%')
  })

  test('a reset beyond today names the day', () => {
    const tomorrow = { ...STATUS, limits: [{ kind: 'five_hour', percent: 10, resetsAt: NOW + 20 * 3_600_000 }] }
    expect(plainText(statusLines(tomorrow, IDLE, NOW, 170, TZ)[2] ?? [])).toContain('5h 10% ↻ tomorrow 10:05')
  })

  test('an API key shows the cost; a subscription never does', () => {
    expect(plainText(statusLines(API_KEY, IDLE, NOW, 170, TZ)[2] ?? [])).toContain('cost $1.23')
    expect(plainText(statusLines({ ...STATUS, usd: 9 }, IDLE, NOW, 170, TZ)[2] ?? [])).not.toContain('cost')
  })

  test('/binnacle line hidden draws nothing; compact drops the detail at any width', () => {
    expect(statusLines(STATUS, { ...IDLE, mode: 'hidden' }, NOW, 300, TZ)).toEqual([])
    const compact = text(statusLines(STATUS, { ...IDLE, mode: 'compact' }, NOW, 300, TZ))
    expect(compact[0]).toBe('○ Idle · 14 actions · Opus 5.5')
    expect(compact[2]).toBe('Context 34% · 5h 62% · week 9%')
  })

  test('the state file the mod writes stays under 8 KB and draws the same alerts', () => {
    const shared = busyShared()
    expect(JSON.stringify(shared).length).toBeLessThan(8 * 1024)
    const four = plainText(statusLines(STATUS, shared, NOW, 300, TZ)[3] ?? [])
    expect(four).toContain('CI failing (2 of 9)')
    expect(four).toContain('1 action denied this turn')
    expect(four).toContain('agent silent 12 min: explore types')
  })
})

const LEFT = ['TURN ACTIVITY', 'AGENTS AND SHELLS', 'PR AND CI']
const RIGHT = ['OTHER SESSIONS', 'USAGE', 'FILES AND SKILLS']

/** The pane's rows as text, the frame's sides taken off. */
const body = (lines: string[]) => lines.slice(1, -1).map(line => line.slice(2, -2))

/** Where each heading starts: its row and its column, or null when it is not drawn. */
function headings(lines: string[], names: string[]): ({ row: number; column: number } | null)[] {
  return names.map(name => {
    const row = lines.findIndex(line => line.includes(`${name} ─`))
    return row === -1 ? null : { row, column: [...(lines[row] ?? '').slice(0, (lines[row] ?? '').indexOf(`${name} ─`))].length }
  })
}

describe('pane', () => {
  for (const columns of WIDTHS) {
    test(`busy session at ${columns} columns: a closed rounded frame, every row exactly as wide`, () => {
      const lines = paneLines(busyPane(), columns).map(plainText)
      for (const line of lines) expect([...line].length).toBe(columns)
      expect(lines[0]).toMatch(/^╭─ binnacle · status ─+╮$/)
      expect(lines.at(-1)).toMatch(/^╰─+╯$/)
      for (const line of lines.slice(1, -1)) expect(line).toMatch(/^│ .* │$/)
    })

    test(`empty session at ${columns} columns: every section says it is empty`, () => {
      const lines = paneLines(emptyPane(), columns).map(plainText)
      for (const line of lines) expect([...line].length).toBe(columns)
      const all = body(lines).join('\n')
      for (const h of [...LEFT, ...RIGHT]) expect(all).toContain(h)
      expect(all).not.toContain('ALERTS')
      for (const empty of ['no agent and no shell this session', 'no calls yet', 'no refusal and no error this session', 'no file edited this session', 'no skill loaded this session', 'no measures yet', 'the session is not in a git repository', 'no other session active', 'no message received or sent']) {
        expect(all).toContain(empty)
      }
    })
  }

  test('from 100 columns the sections sit in two columns, the session left and its surroundings right', () => {
    const lines = body(paneLines(busyPane(), 160).map(plainText))
    const left = headings(lines, LEFT)
    const right = headings(lines, ['ALERTS', ...RIGHT])
    expect(left.every(h => h?.column === 0)).toBe(true)
    expect(right.every(h => h !== null && h.column > 60)).toBe(true)
    expect(right[0]?.row).toBe(0)
    expect(lines.slice(0, 3).every(line => line.includes(' │ '))).toBe(true)
  })

  test('under 100 columns the pane is one column, alerts first, then the sections in order', () => {
    const lines = body(paneLines(busyPane(), 99).map(plainText))
    const found = headings(lines, ['ALERTS', ...LEFT, ...RIGHT])
    expect(found.every(h => h?.column === 0)).toBe(true)
    const rows = found.map(h => h?.row ?? -1)
    expect([...rows].sort((a, b) => a - b)).toEqual(rows)
  })

  test('headings are accent blue, the frame too, and the column rule dim', () => {
    const painted = paneLines(busyPane(), 160).map(paint)
    expect(painted[0]?.startsWith('\x1b[38;5;117m╭─ ')).toBe(true)
    expect(painted.join('\n')).toContain('\x1b[38;5;117mTURN ACTIVITY')
    expect(painted[1]).toContain('\x1b[38;5;247m │ ')
  })

  test('usage draws block bars and, for a window with readings, a sparkline', () => {
    const lines = paneLines(busyPane(), 120).map(plainText)
    const five = lines.findIndex(line => line.includes('5h 62% · full in 40 min'))
    expect(five).toBeGreaterThan(0)
    expect(lines[five + 1]).toMatch(/█+[▏▎▍▌▋▊▉]?░+\s+▁▃▅/)
    const painted = paneLines(busyPane(), 120).map(paint)
    expect(painted[five + 1]).toContain('\x1b[38;5;210m█')
    expect(painted.join('\n')).toContain('\x1b[38;5;117m█')
  })

  test('agents and shells share a section: running shells first, then the ended with how and when', () => {
    const all = body(paneLines(busyPane(), 120).map(plainText)).map(line => line.trimEnd())
    const at = (text: string) => all.findIndex(line => line.includes(text))
    expect(at('⧗ Wait for PR 2303 to reach production · 6 min')).toBeGreaterThan(at('● width-audit'))
    expect(at('⧗ Executor · inbox redesign · 14 min')).toBe(at('⧗ Wait for PR 2303') + 1)
    expect(at('✓ Render the mockups · ended · 14:04')).toBe(at('⧗ Executor') + 1)
    expect(at('✗ Lint the plugin · exit 2 · 14:03')).toBe(at('✓ Render the mockups') + 1)
  })

  test('a narrow column keeps agent names and action targets readable', () => {
    const all = body(paneLines(busyPane(), 120).map(plainText)).join('\n')
    expect(all).toMatch(/● explore types .*2 actions silent 12 min/)
    expect(all).toMatch(/● Vesper +acme +Syncing/)
    expect(all).toMatch(/main\s+Bash\s+bun test src\s+ok/)
  })

  test('the busy pane says what runs, who did what and why it was refused', () => {
    const all = body(paneLines(busyPane(), 160).map(plainText)).join('\n')
    expect(all).toContain('● Working since 14:02 · 3 min')
    expect(all).toContain('claude plugin validate .')
    expect(all).toContain('4 model requests · 8 actions this turn')
    expect(all).toMatch(/width-audit general-purpose\s+background\s+14:03\s+3 actions working 1 min/)
    expect(all).toMatch(/explore types Explore\s+foreground\s+13:50\s+2 actions silent 12 min/)
    expect(all).toContain('and 1 ended over 10 min ago')
    expect(all).toMatch(/rm -rf \S+\s+40 ms denied: policy/)
    expect(all).toContain('— policy: rm -rf of an absolute path')
    expect(all).toContain('— error: failed to push some refs')
    expect(all).toMatch(/src\/render\/status\.ts\s+2 edits/)
    expect(all).toContain('code.claude.com')
    expect(all).toContain('13:45 automatic (820k → 61k)')
    expect(all).toContain('PR #41 · changes requested')
    expect(all).toContain('✗ CI 7 passing · 2 failing · 0 pending')
    expect(all).toContain('from another session: Can you review PR 41 before five?')
    expect(all).toMatch(/● Vesper +acme +Syncing the docs site/)
    expect(all).toMatch(/○ codex 4a1b +shop, silent/)
    expect(all).toContain('→ /binnacle reap ends them')
  })
})

describe('reducers', () => {
  const start = { id: 'x', tool: 'Bash', target: 'ls', at: 1000 }

  test('a refusal tool.check gave turns the errored result into a denial with its reason', () => {
    let a = act.turnStarted(act.EMPTY, 't', 0)
    a = act.callStarted(a, start)
    a = act.checkDenied(a, 'x', 'Bash(rm:*) is denied\nmore')
    a = act.callEnded(a, { ...start, endedAt: 1500, ran: { isError: true, text: 'whatever' } })
    expect(a.calls[0]).toEqual(expect.objectContaining({ outcome: 'denied', reason: 'Bash(rm:*) is denied', ms: 500 }))
    expect(a.deniedTotal).toBe(1)
    expect(a.turn?.denials).toBe(1)
    expect(a.checks).toEqual({})
  })

  test('a plugin deny is a denial, an error without a refusal is an error', () => {
    const denied = act.callEnded(act.callStarted(act.EMPTY, start), { ...start, endedAt: 1100, ran: { deny: 'no' } })
    expect(denied.denials).toHaveLength(1)
    const failed = act.callEnded(act.callStarted(act.EMPTY, start), { ...start, endedAt: 1100, ran: { isError: true, text: 'exit 1' } })
    expect(failed.errors[0]?.reason).toBe('exit 1')
    expect(failed.deniedTotal).toBe(0)
  })

  test('an agent call before its spawn settles keeps the count once the spawn names it', () => {
    let a = act.callStarted(act.EMPTY, { ...start, agentId: 'ag' })
    a = act.agentSpawned(a, { id: 'ag', name: 'scout', type: 'Explore', isBackground: true, at: 900 })
    expect(a.agents).toEqual([expect.objectContaining({ id: 'ag', name: 'scout', actions: 1, busy: 1, startedAt: 900 })])
    a = act.agentTurnEnded(a, 'ag', 5000)
    expect(act.activeAgents(a)).toHaveLength(0)
  })

  test('reconciling ends an agent the live list dropped, after the listing grace', () => {
    const a = act.callStarted(act.EMPTY, { ...start, agentId: 'a86a4926' })
    expect(act.activeAgents(act.agentsReconciled(a, [], 1000 + act.LISTING_GRACE_MS - 1))).toHaveLength(1)
    const ended = act.agentsReconciled(a, [], 1000 + act.LISTING_GRACE_MS)
    expect(act.activeAgents(ended)).toEqual([])
    expect(ended.agents[0]).toEqual(expect.objectContaining({ busy: 0, endedAt: 1000 + act.LISTING_GRACE_MS }))
  })

  test('reconciling names a listed agent and ends it once it rests; idle is no rest', () => {
    const a = act.callStarted(act.EMPTY, { ...start, agentId: 'ag' })
    const listed = (status: string) => [{ id: 'ag', description: 'Audit widths', type: 'general-purpose', status }]
    const running = act.agentsReconciled(a, listed('running'), 999_999)
    expect(act.activeAgents(running)).toEqual([expect.objectContaining({ name: 'Audit widths' })])
    for (const status of ['completed', 'failed', 'killed']) {
      expect(act.activeAgents(act.agentsReconciled(a, listed(status), 2000))).toEqual([])
    }
    expect(act.activeAgents(act.agentsReconciled(a, listed('idle'), 2000))).toEqual([expect.objectContaining({ status: 'idle' })])
  })

  test('without a live list an agent expires after an hour of silence, not before', () => {
    const a = act.callStarted(act.EMPTY, { ...start, agentId: 'ag' })
    expect(act.activeAgents(act.agentsReconciled(a, null, 1000 + act.UNLISTED_EXPIRY_MS - 1))).toHaveLength(1)
    expect(act.activeAgents(act.agentsReconciled(a, null, 1000 + act.UNLISTED_EXPIRY_MS))).toEqual([])
  })

  test('lists stay bounded', () => {
    let a = act.EMPTY
    for (let i = 0; i < 200; i += 1) {
      const call = { id: `c${i}`, tool: 'Edit', target: `f${i}`, at: i }
      a = act.callEnded(act.callStarted(a, call), { ...call, endedAt: i + 1, ran: {}, file: `f${i}` })
    }
    expect(a.calls).toHaveLength(act.LIMITS.calls)
    expect(a.files).toHaveLength(act.LIMITS.files)
    expect(a.files[0]?.path).toBe('f199')
  })

  test('a call ended twice or started twice counts once', () => {
    let a = act.turnStarted(act.EMPTY, 't', 0)
    a = act.callStarted(act.callStarted(a, start), start)
    expect(a.calls).toHaveLength(1)
    expect(a.turn?.actions).toBe(1)
  })

  test('summaries name what each tool acts on', () => {
    const cwd = '/repo'
    expect(act.summarize('Bash', { command: 'git status\n  --short' }, cwd)).toBe('git status')
    expect(act.summarize('Edit', { file_path: '/repo/src/a.ts' }, cwd)).toBe('src/a.ts')
    expect(act.summarize('Agent', { description: 'Audit widths' }, cwd)).toBe('Audit widths')
    expect(act.summarize('Skill', { skill: 'plugin-authoring' }, cwd)).toBe('plugin-authoring')
    expect(act.summarize('WebFetch', { url: 'https://example.com/x?y' }, cwd)).toBe('example.com')
    expect(act.summarize('Grep', { pattern: 'todo', path: '/repo/src' }, cwd)).toBe('todo in src')
  })
})

describe('signals and words', () => {
  test('git status, PR, peers, offset', () => {
    const git = gitFrom('# branch.head main\n# branch.ab +2 -1\n1 .M x\n? y\n', '/r/acme')
    expect(git).toEqual({ root: '/r/acme', repo: 'acme', branch: 'main', dirty: 2, ahead: 2, behind: 1 })
    expect(prFrom('{"number":41,"reviewDecision":"APPROVED"}')).toEqual({ number: 41, review: 'APPROVED' })
    expect(prFrom('no pull requests found')).toBeNull()
    const peers = peersFrom(
      JSON.stringify([
        { session: 'me', root: 'me', lifecycle: 'active', liveness: 'live', repo: '/r' },
        { session: 'kid', root: 'me', lifecycle: 'active', liveness: 'live', repo: '/r' },
        { session: 'old', root: 'old', lifecycle: 'active', liveness: 'stale', repo: '/r', last_ms: 9 },
        { session: 'other', root: 'other', lifecycle: 'active', liveness: 'live', repo: '/r', cwd: '/r', last_ms: 1 },
        { session: 'done', root: 'done', lifecycle: 'complete', liveness: 'live', repo: '/r' },
      ]),
      'me',
    )
    expect(peers.map(p => p.session)).toEqual(['other', 'old'])
    expect(crowdOf(peers, '/r')).toBe(1)
    expect(offsetFrom('+0200\n')).toBe(120)
    expect(offsetFrom('-0530')).toBe(-330)
  })

  test('a window filling 20 points an hour from 40% is full in three hours', () => {
    const hour = 3_600_000
    let samples = remember([], 0, 20)
    samples = remember(samples, hour / 2, 30)
    samples = remember(samples, hour, 40)
    expect(untilFull(samples)).toBe(3 * hour)
    expect(untilFull(remember(remember([], 0, 40), hour, 40))).toBeNull()
  })

  test('times and sizes read as people say them', () => {
    expect(duration(40_000)).toBe('40 s')
    expect(duration(3 * 60_000)).toBe('3 min')
    expect(duration(130 * 60_000)).toBe('2 h 10 min')
    expect(tokens(340_000)).toBe('340k')
    expect(tokens(1_000_000)).toBe('1M')
    expect(tokens(1_200_000)).toBe('1.2M')
    expect(when(NOW + 15 * 60_000, NOW, TZ)).toBe('at 14:20')
    expect(when(NOW + 24 * 3_600_000, NOW, TZ)).toBe('tomorrow at 14:05')
    expect(when(NOW + 4 * 24 * 3_600_000, NOW, TZ)).toBe('on Wednesday at 14:05')
  })

  test('alerts carry a fix each and red comes before yellow', () => {
    const list = alertsOf({ now: NOW, ci: { pass: 1, fail: 1, pending: 0 }, crowd: 2, turnDenials: 1, loops: 0, agents: [] })
    expect(list.map(a => a.tone)).toEqual(['bad', 'warn', 'warn'])
    for (const alert of list) expect(alert.fix.length).toBeGreaterThan(0)
  })
})

describe('pane words', () => {
  test('a home folder reads as ~, the session\'s own scratch files are told apart, a refusal loses the engine\'s prefix', () => {
    expect(homeShort('/Users/ana/code/app/render/band.ts')).toBe('~/code/app/render/band.ts')
    expect(homeShort('/home/ana/src/a.ts')).toBe('~/src/a.ts')
    expect(homeShort('/opt/repo/a.ts')).toBe('/opt/repo/a.ts')
    expect(isScratch('/private/tmp/claude-501/-Users-ana-repo/0b99-session/scratchpad/rows.ts')).toBe(true)
    expect(isScratch('/private/tmp/claude-501/-Users-ana-repo/0b99-session/tasks/b1.output')).toBe(true)
    expect(isScratch('/Users/ana/repo/scratchpad/notes.md')).toBe(false)
    expect(reasonWords('PreToolUse:Bash hook error: Bash chain denied: 3 commands in one call')).toBe('hook: Bash chain denied: 3 commands in one call')
    expect(reasonWords('Exit code 1')).toBe('exited with code 1')
    expect(reasonWords('File does not exist.')).toBe('File does not exist.')
  })
})
