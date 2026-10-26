import { describe, expect, mock, test, type TestBody } from 'claude-code/testing'
import type { On } from 'claude-code'

import { t, useLanguage } from '../i18n'
import { DICTIONARIES } from '../i18n/dictionaries'
import { drawn as layOut } from '../tools/draw'

/** The options a user who runs every feature would set: a sessions listing, the Codex loop watch, a quiet hint. */
const OPTIONS = { peersCommand: 'sessions --json', watchCodexLoops: true, hideModeHint: true }

const STATUS = [
  '# branch.oid 0123456789abcdef',
  '# branch.head main',
  '# branch.ab +2 -0',
  '1 .M N... 100644 100644 100644 aaaa bbbb src/a.ts',
  '? new.ts',
  '',
].join('\n')

const ran = (stdout: string, exitCode = 0) => ({
  value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
})

/** What `$.agent.list()` answers now; a throw stands for a list the engine cannot give. */
type Listing = () => { id: string; description: string; type: string; status: 'running' | 'idle' | 'completed' }[]

function engine(on: On, removed: string[] = [], spawned: string[][] = [], listing: Listing = () => []) {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  // The engine's own hint line, drawn as its text.
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="hint">{e.props.hint}</Text>
  })
  // The engine's own band, drawn when the mod passes: a survey, or the band switched off.
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine-band">{e.props.hasSurvey ? 'survey' : 'engine'}</Text>
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => {
    const now = clock.now()
    return {
      value: {
        startedAt: now - 3_600_000,
        context: { window: 1_000_000, tokens: 340_000, percent: 34 },
        rateLimits: [
          { kind: 'five_hour', percentUsed: 62, resetsAt: new Date(now + 7_200_000).toISOString() },
          { kind: 'seven_day', percentUsed: 9 },
        ],
        cost: { usd: 1.2 },
      },
    }
  })
  on('session.cwd', () => ({ value: '/repo/acme' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('agent.list', () => ({ value: listing() }))
  const panes: { id: string; title: string }[] = []
  on('ui.panes', () => ({ value: panes.map(p => ({ ...p, isShown: true, isFocused: false, isPlaced: true })) }))
  on('ui.open', (_$, e) => {
    panes.push({ id: e.id, title: e.title ?? e.id })
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_$, e) => {
    panes.splice(panes.findIndex(p => p.id === e.id), 1)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    const [command, first] = e.argv
    spawned.push([...e.argv])
    if (command === 'git') return first === 'status' ? ran(STATUS) : ran('/repo/acme\n')
    if (command === 'date') return ran('+0200\n')
    if (command === 'ps') {
      return ran(
        [
          '2251 1 bash /Applications/Zentty.app/Contents/Resources/bin/codex/../shared/zentty-agent-wrapper app-server --listen stdio://',
          '40759 1 /Applications/Zentty.app/Contents/Resources/bin/shared/zentty launch codex app-server --listen stdio://',
          '78011 2669 /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex app-server --listen stdio://',
        ].join('\n'),
      )
    }
    if (command === 'kill') return ran('')
    if (command === '/bin/rm') {
      removed.push(...e.argv.slice(3))
      return ran('')
    }
    if (command === 'gh' && first === 'pr' && e.argv[2] === 'checks') {
      return ran(JSON.stringify([{ bucket: 'pass' }, { bucket: 'fail' }, { bucket: 'pending' }, { bucket: 'skipping' }]), 1)
    }
    if (command === 'gh' && first === 'pr' && e.argv[2] === 'view') return ran('{"number":41,"reviewDecision":"CHANGES_REQUESTED"}')
    if (command === 'sessions') {
      return ran(
        JSON.stringify([
          { session: 'session-1', root: 'session-1', repo: '/repo/acme', liveness: 'live', lifecycle: 'active' },
          { session: 'child', root: 'session-1', repo: '/repo/acme', liveness: 'live', lifecycle: 'active' },
          { session: 'other', root: 'other', repo: '/repo/acme', cwd: '/repo/acme', harness: 'codex', liveness: 'live', lifecycle: 'active' },
          { session: 'elsewhere', root: 'elsewhere', repo: '/repo/other', liveness: 'live', lifecycle: 'active' },
        ]),
      )
    }
    return ran('', 127)
  })
  return clock
}

const SURFACE = { cwd: '/repo/acme', surface: 'terminal', isInteractive: true } as const

const COMPOSER = {
  origin: { kind: 'composer' },
  presentation: { isFullscreen: false, columns: 140 },
} as const

/** The last state the mod published for the status line. */
function published(on: On) {
  const files: Record<string, string> = {}
  on('fs.write', (_$, e) => {
    files[e.path] = e.text
    return { value: undefined }
  })
  return () => {
    const entry = Object.entries(files).find(([path]) => path.endsWith('/state/session-1.json'))
    return entry === undefined ? undefined : (JSON.parse(entry[1]) as Record<string, unknown>)
  }
}

const PANE_PROPS = {
  title: 'binnacle',
  isFocused: false,
  bodyColumns: 90,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const

test('the footer drops the permission-mode line and keeps what changes', { options: OPTIONS }, async ($, on) => {
  engine(on)
  await $.session.start(SURFACE)

  const hint = (text: string, isWorking: boolean) =>
    ({ component: 'PromptHint', props: { isDraft: false, isWorking, hint: text } }) as const

  const idle = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...hint('⏵⏵ auto mode on (shift+tab to cycle) · ← for agents', false) })
  expect(await idle.find({ type: 'Text', text: /mode on|for agents|shift\+tab/ })).toBeUndefined()
  await idle.unmount()

  const busy = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...hint('esc to interrupt · ▸▸ bypass permissions on (shift+tab to cycle)', true) })
  expect(await busy.find({ type: 'Text', text: 'esc to interrupt' })).toBeDefined()
  expect(await busy.find({ type: 'Text', text: /bypass/ })).toBeUndefined()
  await busy.unmount()
})

test('the mod publishes git, CI, crowd and loops for the status line, and nothing of mani', { options: OPTIONS }, async ($, on) => {
  const state = published(on)
  const spawned: string[][] = []
  const clock = engine(on, [], spawned)
  await $.session.start(SURFACE)
  await clock.advance(2_000)

  expect(state()).toEqual(
    expect.objectContaining({
      mode: 'full',
      git: expect.objectContaining({ repo: 'acme', branch: 'main', ahead: 2, dirty: 2 }),
      crowd: 1,
      ci: { pass: 1, fail: 1, pending: 1 },
      loops: 2,
      agents: [],
    }),
  )
  expect(spawned.some(argv => argv.join(' ').includes('mani'))).toBe(false)
  expect(JSON.stringify(state()).length).toBeLessThan(8 * 1024)
})

test('a turn with tool calls reaches the status line and the pane', { options: OPTIONS }, async ($, on) => {
  const state = published(on)
  const clock = engine(on)
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'done' }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ isError: true, result: 'no such file', text: 'File does not exist.' }) as never)
  await $.session.start(SURFACE)

  await $.turn.start({ text: 'go', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await $.tool.call({ tool: 'Bash', command: 'git log --oneline -3', description: 'Show the latest commits' } as never)
  await $.tool.call({ tool: 'Edit', file_path: '/repo/acme/src/a.ts', old_string: 'a', new_string: 'b' } as never)
  await clock.advance(2_000)

  expect(state()).toEqual(expect.objectContaining({ turn: expect.objectContaining({ actions: 3, denials: 0 }) }))

  const pane = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'Pane', requestId: 'binnacle', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: 'recent calls' })).toBeDefined()
  // With no agent at work the who column goes; a call reads in its own words when it gave them.
  expect(await pane.find({ type: 'Text', text: /\d\s+Bash\s+git status/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Bash\s+Show the latest commits/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\d\s+main\s+Bash/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Edit src\/a\.ts — File does not exist\./ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /1 error this session/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /PR #41 · changes requested/ })).toBeDefined()
  await pane.unmount()

  await $.turn.complete({ reason: 'answer', isAborted: false, turnId: 'turn-1' } as never)
  await clock.advance(2_000)
  expect(state()).toEqual(expect.objectContaining({ turn: null, last: expect.objectContaining({ actions: 3 }) }))
})

test('a background Bash call is published as a shell, and stopping it marks it ended', { options: OPTIONS }, async ($, on) => {
  const state = published(on)
  const clock = engine(on)
  const output = '/private/tmp/claude-501/-repo-acme/session-1/tasks/b7k1u74au.output'
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const isBackground = (e as { run_in_background?: boolean }).run_in_background === true
    const text = isBackground ? `Command running in background with ID: b7k1u74au. Output is being written to: ${output}` : ''
    return { result: { stdout: '', stderr: '', interrupted: false }, text } as never
  })
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: {}, text: 'stopped' }) as never)
  await $.session.start(SURFACE)
  const startedAt = clock.now()

  await $.tool.call({ tool: 'Bash', command: 'bun run dev', description: 'Dev server', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git status' } as never)
  await clock.advance(2_000)
  expect(state()?.shells).toEqual([{ id: 'b7k1u74au', label: 'Dev server', startedAt, output }])

  await $.tool.call({ tool: 'TaskStop', task_id: 'b7k1u74au' } as never)
  await clock.advance(2_000)
  expect(state()?.shells).toEqual([{ id: 'b7k1u74au', label: 'Dev server', startedAt, output, stoppedAt: startedAt + 2_000 }])
})

test('the pane reads how each background shell stands from its output file', { options: OPTIONS }, async ($, on) => {
  const clock = engine(on)
  const output = '/private/tmp/claude-501/-repo-acme/session-1/tasks/b7k1u74au.output'
  const lint = '/private/tmp/claude-501/-repo-acme/session-1/tasks/c2lint000.output'
  const files: Record<string, string> = { [output]: 'listening on :3000\n', [lint]: 'boom\n[exited with code 2]\n' }
  on('fs.stat', (_$, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: text.length, mtimeMs: clock.now(), isLink: false } }
  })
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const id = (e as { description?: string }).description === 'Lint' ? 'c2lint000' : 'b7k1u74au'
    const text = `Command running in background with ID: ${id}. Output is being written to: ${id === 'c2lint000' ? lint : output}`
    return { result: { stdout: '', stderr: '', interrupted: false }, text } as never
  })
  await $.session.start(SURFACE)
  await $.tool.call({ tool: 'Bash', command: 'bun run dev', description: 'Dev server', run_in_background: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'bun run lint', description: 'Lint', run_in_background: true } as never)
  await clock.advance(2_000)

  const pane = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'Pane', requestId: 'binnacle', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: 'AGENTS AND SHELLS' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /⧗ Dev server · 2 s/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /✗ Lint · exit 2/ })).toBeDefined()
  await pane.unmount()
})

/** An agent's tool call whose turn.complete never comes, as a stopped teammate's subagent leaves it. */
async function orphanCall($: Parameters<TestBody>[0], agentId: string) {
  await $.tool.call({ tool: 'Bash', command: 'ls', agentId } as never)
}

const pulses = (state: () => Record<string, unknown> | undefined) => (state()?.agents ?? []) as { name: string }[]

describe('agents the live list no longer holds', () => {
  test('an agent absent from the live list stops counting and never reads as stalled', { options: OPTIONS }, async ($, on) => {
    const state = published(on)
    const clock = engine(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }) as never)
    await $.session.start(SURFACE)

    await orphanCall($, 'a86a4926-dead')
    await clock.advance(2_000)
    expect(pulses(state)).toHaveLength(1)

    await clock.advance(40_000)
    expect(pulses(state)).toEqual([])
  })

  test('a listed running agent stays active and takes its name from the list', { options: OPTIONS }, async ($, on) => {
    const state = published(on)
    const clock = engine(on, [], [], () => [{ id: 'a-live', description: 'Audit widths', type: 'general-purpose', status: 'running' }])
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }) as never)
    await $.session.start(SURFACE)

    await orphanCall($, 'a-live')
    await clock.advance(42_000)
    expect(pulses(state)).toEqual([expect.objectContaining({ name: 'Audit widths' })])
  })

  test('a listed agent that completed or went idle stops counting', { options: OPTIONS }, async ($, on) => {
    const state = published(on)
    let status: 'running' | 'completed' = 'running'
    const clock = engine(on, [], [], () => [{ id: 'a-done', description: 'scout', type: 'Explore', status }])
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }) as never)
    await $.session.start(SURFACE)

    await orphanCall($, 'a-done')
    await clock.advance(6_000)
    expect(pulses(state)).toHaveLength(1)
    status = 'completed'
    await clock.advance(6_000)
    expect(pulses(state)).toEqual([])
  })

  test('without a live list, an agent silent for an hour expires', { options: OPTIONS }, async ($, on) => {
    const state = published(on)
    const clock = engine(on, [], [], () => {
      throw new Error('no agent list here')
    })
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: '' }) as never)
    await $.session.start(SURFACE)

    await orphanCall($, 'a86a4926-dead')
    await clock.advance(59 * 60_000)
    expect(pulses(state)).toHaveLength(1)
    await clock.advance(2 * 60_000)
    expect(pulses(state)).toEqual([])
  })
})

test('/binnacle opens and closes the pane; /binnacle line sets the status line', { options: OPTIONS }, async ($, on) => {
  const state = published(on)
  engine(on)
  await $.session.start(SURFACE)

  expect(await $.command.run({ command: 'binnacle', args: '', ...COMPOSER })).toEqual(expect.objectContaining({ text: 'pane open; /binnacle closes it' }))
  expect(await $.command.run({ command: 'binnacle', args: '', ...COMPOSER })).toEqual(expect.objectContaining({ text: 'pane closed' }))

  expect(await $.command.run({ command: 'binnacle', args: 'line compact', ...COMPOSER })).toEqual(expect.objectContaining({ text: 'status line compact' }))
  expect(state()).toEqual(expect.objectContaining({ mode: 'compact' }))
  await $.command.run({ command: 'binnacle', args: 'hidden', ...COMPOSER })
  expect(state()).toEqual(expect.objectContaining({ mode: 'hidden' }))
  await $.command.run({ command: 'binnacle', args: 'line full', ...COMPOSER })
  expect(state()).toEqual(expect.objectContaining({ mode: 'full' }))

  const help = await $.command.run({ command: 'binnacle', args: 'theme brave', ...COMPOSER })
  expect(help).toEqual(expect.objectContaining({ text: expect.stringContaining('/binnacle line full|compact|hidden') }))
})

test('/binnacle reap ends the orphaned codex loops it reads', { options: OPTIONS }, async ($, on) => {
  engine(on)
  await $.session.start(SURFACE)
  const reaped = await $.command.run({ command: 'binnacle', args: 'reap', ...COMPOSER })
  // The mocked ps keeps listing them, so the HUD says they are still there.
  expect(reaped).toEqual(expect.objectContaining({ text: 'kill exited with 0; 2 Codex loops left' }))
})

test('the pane draws on the terminal with every section, empty ones said so', { options: OPTIONS }, async ($, on) => {
  const clock = engine(on)
  await $.session.start(SURFACE)
  await clock.advance(2_000)
  const pane = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'Pane', requestId: 'binnacle', props: { ...PANE_PROPS, bodyColumns: 70 } })
  for (const heading of ['binnacle · status', 'ALERTS', 'TURN ACTIVITY', 'AGENTS AND SHELLS', 'PR AND CI', 'OTHER SESSIONS', 'USAGE', 'FILES AND SKILLS']) {
    expect(await pane.find({ type: 'Text', text: heading })).toBeDefined()
  }
  expect(await pane.find({ type: 'Text', text: 'no agent and no shell this session' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /CI failing \(1 of 3\)/ })).toBeDefined()
  await pane.unmount()
})

test('language es speaks Spanish everywhere, and a dictionary on disk overrides the words it names', { options: { ...OPTIONS, language: 'es' } }, async ($, on) => {
  const state = published(on)
  const clock = engine(on)
  on('fs.read', (_$, e) => (e.path.endsWith('/i18n/es.json') ? { value: JSON.stringify({ 'pane.section.usage': 'GASTO' }) } : { deny: 'no such file' }))
  await $.session.start(SURFACE)
  await clock.advance(2_000)
  expect(state()).toEqual(expect.objectContaining({ language: 'es' }))
  const pane = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'Pane', requestId: 'binnacle', props: { ...PANE_PROPS, bodyColumns: 70 } })
  for (const heading of ['binnacle · panel de estado', 'ALERTAS', 'ACTIVIDAD DEL TURNO', 'AGENTES Y SHELLS', 'GASTO']) {
    expect(await pane.find({ type: 'Text', text: heading })).toBeDefined()
  }
  expect(await pane.find({ type: 'Text', text: 'USAGE' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /CI falla \(1 de 3\)/ })).toBeDefined()
  await pane.unmount()
  expect(await $.command.run({ command: 'binnacle', args: '', ...COMPOSER })).toEqual(expect.objectContaining({ text: 'panel abierto; /binnacle lo cierra' }))
})

test("the command takes the active language's words, and English ones still", { options: { ...OPTIONS, language: 'es' } }, async ($, on) => {
  const state = published(on)
  engine(on)
  await $.session.start(SURFACE)
  const run = (args: string) => $.command.run({ command: 'binnacle', args, ...COMPOSER })
  // What the user types and what the command answers, both from the Spanish dictionary.
  const words = (key: string) => (DICTIONARIES.es?.[key] ?? '').split('|')
  const first = (key: string) => words(key)[0] ?? ''
  const said = (() => {
    try {
      useLanguage('es')
      return { compact: t('command.line', { mode: t('mode.compact') }), bandOn: t('command.bandOn'), bandOff: t('command.bandOff'), wakeOn: t('command.wakeOn'), wakeOff: t('command.wakeOff'), help: t('command.help') }
    } finally {
      useLanguage('en')
    }
  })()

  // Every spelling the dictionary gives counts: "línea" and "linea".
  for (const line of words('command.word.line')) {
    expect(await run(`${line} ${first('command.word.compact')}`)).toEqual(expect.objectContaining({ text: said.compact }))
    expect(state()).toEqual(expect.objectContaining({ mode: 'compact' }))
    await run(`${line} ${first('command.word.full')}`)
    expect(state()).toEqual(expect.objectContaining({ mode: 'full' }))
  }
  await run(first('command.word.hidden'))
  expect(state()).toEqual(expect.objectContaining({ mode: 'hidden' }))

  const band = first('command.word.band')
  expect(await run(`${band} ${first('command.word.off')}`)).toEqual(expect.objectContaining({ text: said.bandOff }))
  for (const yes of words('command.word.on')) expect(await run(`${band} ${yes}`)).toEqual(expect.objectContaining({ text: said.bandOn }))
  const wake = first('command.word.wake')
  expect(await run(`${wake} ${first('command.word.off')}`)).toEqual(expect.objectContaining({ text: said.wakeOff }))
  expect(await run(wake)).toEqual(expect.objectContaining({ text: said.wakeOn }))

  // English works whatever the language.
  expect(await run('line compact')).toEqual(expect.objectContaining({ text: said.compact }))
  expect(await run('wake off')).toEqual(expect.objectContaining({ text: said.wakeOff }))
  expect(await run('band yes')).toEqual(expect.objectContaining({ text: said.bandOn }))
  // A word of neither gets the help, in the active language.
  expect(await run(`${band} maybe`)).toEqual(expect.objectContaining({ text: said.help }))
})

test("an English session does not take another language's command words",{ options: OPTIONS }, async ($, on) => {
  const state = published(on)
  engine(on)
  await $.session.start(SURFACE)
  const word = (key: string) => (DICTIONARIES.es?.[key] ?? '').split('|')[0] ?? ''
  expect(await $.command.run({ command: 'binnacle', args: `${word('command.word.line')} ${word('command.word.compact')}`, ...COMPOSER })).toEqual(expect.objectContaining({ text: t('command.help') }))
  expect(state()?.mode ?? 'full').toBe('full')
})

test('with no options the other sessions are never listed and no Codex loop is looked for', async ($, on) => {
  const spawned: string[][] = []
  const clock = engine(on, [], spawned)
  await $.session.start(SURFACE)
  await clock.advance(70_000)
  expect(spawned.some(argv => argv[0] === 'sessions' || argv[0] === 'ps')).toBe(false)
  expect(spawned.some(argv => argv[0] === 'git')).toBe(true)
})

test('session.start removes state files untouched for a week and nothing else', { options: OPTIONS }, async ($, on) => {
  const day = 86_400_000
  const now = 1_800_000_000_000
  const entry = (name: string, kind: 'file' | 'dir' | 'other', age: number, isLink = false) => ({
    name,
    kind,
    size: 10,
    mtimeMs: kind === 'file' ? now - age : 0,
    isLink,
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.list', () => ({
    value: [
      entry('dead.json', 'file', 8 * day),
      entry('live.json', 'file', day),
      entry('notes.txt', 'file', 30 * day),
      entry('link.json', 'other', 30 * day, true),
      entry('nested', 'dir', 30 * day),
    ],
  }))
  const removed: string[] = []
  const clock = engine(on, removed)
  await $.session.start(SURFACE)
  await clock.advance(250)

  expect(removed).toHaveLength(1)
  expect(removed[0]).toMatch(/\/state\/dead\.json$/)
})

const band = (props: { bodyColumns?: number; maxRows?: number; hasSurvey?: boolean; isWorking?: boolean } = {}) =>
  ({
    plugin: 'binnacle',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: {
      hasSurvey: props.hasSurvey ?? false,
      isWorking: props.isWorking ?? false,
      maxRows: props.maxRows ?? 12,
      bodyColumns: props.bodyColumns ?? 160,
      scroll: { offset: 0, bodyRows: (props.maxRows ?? 12) - 1 },
      view: {},
    },
  }) as const

type Drawn = { type: string; props: Record<string, unknown>; children: unknown[] }

/** The band's rows as a terminal lays them out, without colour; none when the engine drew its own. */
async function rows(drawn: { drawn: () => Promise<unknown> }) {
  const tree = (await drawn.drawn()) as Drawn
  return tree.type === 'Box' ? layOut(tree, true) : []
}

describe('the band above the prompt', () => {
  test('it draws the budgets, where, the failing CI, and a row for the other live session', { options: OPTIONS }, async ($, on) => {
    const clock = engine(on)
    await $.session.start(SURFACE)
    await clock.advance(2_000)

    const drawn = await $.ui.mount(band())
    const [budgets, where, alert, ...rest] = await rows(drawn)
    for (const part of ['✳ Opus 5.5', 'ctx', '34% 340k/1M', '5h', '62% ↻ 2h', '7d', '9%']) expect(budgets).toContain(part)
    expect(where).toMatch(/^acme \ue0a0 main ●2 ↑2 {3}#41 ✗ \d\/\d {3}session 1h {3}\+1 here +r: reap 2 {3}p: panel$/)
    expect(alert).toMatch(/^⚠ CI failing/)
    // Each live session elsewhere on the bus gets a row: its name, where it works, what it says it does.
    expect(rest).toHaveLength(2)
    expect(rest[0]).toMatch(/^◆ codex ther +acme \S+ +no stated intent/)
    expect(rest[1]).toMatch(/^◆ session here +other \S+ +no stated intent/)

    // The model's pill is ink on lavender, the branch blue, the gauges animated surface modules; nothing fades.
    expect((await drawn.find({ type: 'Text', text: / ✳ Opus 5\.5 / }))?.props).toEqual(expect.objectContaining({ color: '#1a1b26', backgroundColor: '#bb9af7', bold: true }))
    expect((await drawn.find({ type: 'Text', text: /^main$/ }))?.props.color).toBe('#7aa2f7')
    expect((await drawn.findAll({ type: 'Client' })).length).toBeGreaterThanOrEqual(3)
    const runs = await drawn.findAll({ type: 'Text' })
    expect(runs.some(t => t.props.dimColor === true || t.props.color === 'subtle')).toBe(false)
    await drawn.unmount()
  })

  test('short of width the band keeps every budget; no row outgrows it, none is empty', { options: OPTIONS }, async ($, on) => {
    const clock = engine(on)
    await $.session.start(SURFACE)
    await clock.advance(2_000)

    for (const columns of [90, 50]) {
      const drawn = await $.ui.mount(band({ bodyColumns: columns }))
      const lines = await rows(drawn)
      expect(lines.length).toBeGreaterThanOrEqual(2)
      for (const line of lines) {
        expect([...line].length).toBeLessThanOrEqual(columns)
        expect(line.trim()).not.toBe('')
      }
      for (const budget of [/ctx .*34%/, /5h .*62%/]) expect(lines.filter(line => budget.test(line))).toHaveLength(1)
      await drawn.unmount()
    }
  })

  test('a survey takes the band, and the band never takes more rows than it is given', { options: OPTIONS }, async ($, on) => {
    const clock = engine(on)
    await $.session.start(SURFACE)
    await clock.advance(2_000)

    const survey = await $.ui.mount(band({ hasSurvey: true }))
    expect(await survey.find({ type: 'Text', text: 'survey' })).toBeDefined()
    expect(await rows(survey)).toEqual([])
    await survey.unmount()

    const tight = await $.ui.mount(band({ maxRows: 1 }))
    expect(await rows(tight)).toHaveLength(1)
    expect(((await tight.drawn()) as Drawn).props.paddingTop).toBe(0)
    await tight.unmount()

    // With room to spare, an empty row above the band and one below it.
    const roomy = await $.ui.mount(band())
    expect(((await roomy.drawn()) as Drawn).props).toEqual(expect.objectContaining({ paddingTop: 1, paddingBottom: 1 }))
    await roomy.unmount()
  })

  test('a turn the engine says ended reads as waiting, even before the record catches up', { options: OPTIONS }, async ($, on) => {
    const clock = engine(on)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }))
    await $.session.start(SURFACE)
    await $.turn.start({ text: 'go', turnId: 'turn-1' })
    await clock.advance(2_000)

    const busy = await $.ui.mount(band({ isWorking: true }))
    expect((await rows(busy))[1]).toMatch(/◐ working 2s/)
    await busy.unmount()

    const idle = await $.ui.mount(band({ isWorking: false }))
    expect((await rows(idle))[1]).toMatch(/ {3}session 1h/)
    await idle.unmount()
  })

  test('a background shell gets a row, and the footer then drops the engine\'s shell count', { options: OPTIONS }, async ($, on) => {
    const clock = engine(on)
    const output = '/private/tmp/claude-501/-repo-acme/session-1/tasks/b7k1u74au.output'
    on('fs.stat', () => ({ value: { kind: 'file', size: 4, mtimeMs: clock.now(), isLink: false } }))
    on('fs.read', () => ({ value: 'up\n' }))
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: `Command running in background with ID: b7k1u74au. Output is being written to: ${output}` }) as never)
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'bun run dev', description: 'Dev server', run_in_background: true } as never)
    await clock.advance(2_000)

    const drawn = await $.ui.mount(band())
    expect((await rows(drawn)).some(line => /◐ main +shell 2s +Dev server/.test(line))).toBe(true)
    await drawn.unmount()

    const hint = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'PromptHint', props: { isDraft: false, isWorking: false, hint: '? for shortcuts · 1 active shell' } })
    expect(await hint.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
    expect(await hint.find({ type: 'Text', text: /shell/ })).toBeUndefined()
    await hint.unmount()
  })

  test('until the band draws, binnacle pins its status line; while it draws, the line is cleared; band off pins it again', { options: OPTIONS }, async ($, on) => {
    published(on)
    const pinned: (string | undefined)[] = []
    on('ui.status', (_$, e) => {
      pinned.push(e.text)
      return { value: undefined }
    })
    const clock = engine(on)
    await $.session.start(SURFACE)
    await clock.advance(6_000)
    expect(pinned.at(-1)).toMatch(/^○ Idle · .*Opus 5\.5.* {3}acme · main · 2 uncommitted · 2 to push {3}Context 34% of 1M/)
    expect(pinned.at(-1)).not.toContain('\n')

    const drawn = await $.ui.mount(band())
    await drawn.unmount()
    await clock.advance(6_000)
    expect(pinned.at(-1)).toBeUndefined()

    expect(await $.command.run({ command: 'binnacle', args: 'band off', ...COMPOSER })).toEqual(
      expect.objectContaining({ text: 'no band; the status line draws it again' }),
    )
    expect(pinned.at(-1)).toMatch(/^○ Idle/)
    await $.command.run({ command: 'binnacle', args: 'line hidden', ...COMPOSER })
    expect(pinned.at(-1)).toBeUndefined()
    await $.command.run({ command: 'binnacle', args: 'line full', ...COMPOSER })
    const off = await $.ui.mount(band())
    expect(await off.find({ type: 'Text', text: 'engine' })).toBeDefined()
    await off.unmount()

    await $.command.run({ command: 'binnacle', args: 'band on', ...COMPOSER })
    const back = await $.ui.mount(band())
    expect((await rows(back))[1]).toMatch(/session 1h/)
    await back.unmount()
  })

  test('with pinStatusLine off nothing is pinned, and the state tells tools/statusline.ts while the band draws', { options: { ...OPTIONS, pinStatusLine: false } }, async ($, on) => {
    const state = published(on)
    const pinned: (string | undefined)[] = []
    on('ui.status', (_$, e) => {
      pinned.push(e.text)
      return { value: undefined }
    })
    const clock = engine(on)
    await $.session.start(SURFACE)
    await clock.advance(6_000)
    expect(state()?.band).toBeUndefined()

    const drawn = await $.ui.mount(band())
    await drawn.unmount()
    await clock.advance(2_000)
    expect(state()?.band).toBe(true)

    await $.command.run({ command: 'binnacle', args: 'band off', ...COMPOSER })
    expect(state()?.band).toBeUndefined()
    await clock.advance(6_000)
    expect(pinned.filter(text => text !== undefined)).toEqual([])
  })
})
