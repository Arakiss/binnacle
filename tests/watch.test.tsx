import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

/** The options a user who runs every feature would set: a sessions listing, the Codex loop watch, a quiet hint. */
const OPTIONS = { peersCommand: 'sessions --json', watchCodexLoops: true, hideModeHint: true }


const SURFACE = { cwd: '/repo/acme', surface: 'terminal', isInteractive: true } as const

const OUTPUT = '/private/tmp/claude-501/-repo-acme/session-1/tasks/bsim00001.output'

type Status = 'running' | 'waiting' | 'idle' | 'completed' | 'killed'

/** The engine as the watch needs it: a clock, one teammate's listing, a shell's output file, and what was sent. */
function engine(on: On, status: () => Status = () => 'idle') {
  const clock = mock.clock(on, { now: 1_800_000_000_000 })
  const files: Record<string, string> = { [OUTPUT]: 'measuring…\n' }
  const written: Record<string, number> = { [OUTPUT]: clock.now() }
  /** Writes an output file as the shell would, stamping when. */
  const write = (path: string, text: string) => {
    files[path] = text
    written[path] = clock.now()
  }
  const sent: { to: unknown; text: string }[] = []
  const submitted: string[] = []
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: clock.now(), context: { window: 1_000_000 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/repo/acme' }))
  on('session.id', () => ({ value: 'session-1' }))
  on('process.run', () => ({ value: { exitCode: 127, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('agent.list', () => ({ value: [{ id: 'a-sim', teammateId: 'simclasses@team', name: 'simclasses', description: '', type: 'teammate', status: status() }] }))
  on('fs.stat', (_$, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: text.length, mtimeMs: written[e.path] ?? 0, isLink: false } }
  })
  on('fs.read', (_$, e) => ({ value: files[e.path] ?? '' }))
  on('tool.call', { tool: 'Bash' }, (_$, e) => {
    const isBackground = (e as { run_in_background?: boolean }).run_in_background === true
    const text = isBackground ? `Command running in background with ID: bsim00001. Output is being written to: ${OUTPUT}` : ''
    return { result: { stdout: '', stderr: '', interrupted: false }, text } as never
  })
  on('session.send', (_$, e) => {
    sent.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', () => ({ text: '' }))
  on('tool.call', { tool: 'TaskStop' }, () => ({ result: {}, text: 'stopped' }) as never)
  on('ui.toast', () => ({ value: undefined }))
  on('audio.play', () => ({ value: undefined }))
  on('classic.TeammateIdle', () => ({}))
  on('classic.SubagentStop', () => ({}))
  return { clock, write, sent, submitted }
}

const turnEnd = (agentId: string) => ({ answer: '', durationMs: 1000, isAborted: false, turnId: `turn-${agentId}`, agentId, reason: 'answer' }) as never

describe('the idle hook', () => {
  test('a teammate going idle with nothing to wake it is sent back with what to do, once', { options: OPTIONS }, async ($, on) => {
    const { clock } = engine(on)
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a-sim' } as never)
    await clock.advance(1_000)

    const first = await $.classic.TeammateIdle({ teammate_name: 'simclasses', team_name: 'team', agent_id: 'a-sim' })
    expect(first.block).toContain('with nothing to wake you')
    const second = await $.classic.TeammateIdle({ teammate_name: 'simclasses', team_name: 'team', agent_id: 'a-sim' })
    expect(second.block).toBeUndefined()
  })

  test('one that reported to its lead this turn goes idle untouched', { options: OPTIONS }, async ($, on) => {
    const { clock } = engine(on)
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a-sim' } as never)
    await $.session.send({ to: 'team-lead', text: 'hecho', agentId: 'a-sim', origin: { kind: 'model' } } as never)
    await clock.advance(1_000)
    expect((await $.classic.TeammateIdle({ teammate_name: 'simclasses', team_name: 'team', agent_id: 'a-sim' })).block).toBeUndefined()
  })

  test('without an agent id the hook cannot say whose idle it is, and lets it be', { options: OPTIONS }, async ($, on) => {
    engine(on)
    await $.session.start(SURFACE)
    expect((await $.classic.TeammateIdle({ teammate_name: 'simclasses', team_name: 'team' })).block).toBeUndefined()
  })
})

describe('the stop hook', () => {
  test('a subagent ending with its own background shell running is held once', { options: OPTIONS }, async ($, on) => {
    const { clock } = engine(on, () => 'running')
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'bun bench', description: 'Medir clases', run_in_background: true, agentId: 'a-sub' } as never)
    await clock.advance(1_000)
    const stop = { stop_hook_active: false, agent_id: 'a-sub', agent_transcript_path: '', agent_type: 'general-purpose' }
    expect((await $.classic.SubagentStop(stop)).block).toContain('“Medir clases” still running')
    expect((await $.classic.SubagentStop({ ...stop, stop_hook_active: true })).block).toBeUndefined()
  })
})

describe('the watch on the clock', () => {
  test("an idle teammate's shell that ends wakes it with a note, and a stall nobody answers wakes the lead once", { options: OPTIONS }, async ($, on) => {
    const { clock, write, sent, submitted } = engine(on)
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'bun bench', description: 'Medir clases', run_in_background: true, agentId: 'a-sim' } as never)
    await clock.advance(6_000)
    await $.turn.complete(turnEnd('a-sim'))
    await clock.advance(10_000)
    expect(sent).toEqual([])

    write(OUTPUT, 'done\n[exited with code 0]\n')
    await clock.advance(6_000)
    // The engine spells a plugin's `{ agentId }` as the id itself.
    expect(sent).toEqual([{ to: 'a-sim', text: expect.stringContaining('“Medir clases” ended with exit code 0') }])

    // The note went out but no message reached it (the stand-in delivers nothing): the stall stands.
    await clock.advance(40_000)
    expect(submitted).toEqual([expect.stringContaining('binnacle: agent simclasses has been stalled for')])
    await clock.advance(60_000)
    expect(submitted).toHaveLength(1)
    expect(sent).toHaveLength(1)
  })

  test('a teammate the list calls completed the moment its shell ends is still told, and still wakes the lead', { options: OPTIONS }, async ($, on) => {
    // As measured live on 18 Oct: running, then waiting on its own shell, then completed when it ended.
    let status: Status = 'running'
    const { clock, write, sent, submitted } = engine(on, () => status)
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'sleep 20', description: 'Medir clases', run_in_background: true, agentId: 'a-sim' } as never)
    await clock.advance(6_000)
    await $.turn.complete(turnEnd('a-sim'))
    status = 'waiting'
    await clock.advance(10_000)
    write(OUTPUT, '[exited with code 0]\n')
    status = 'completed'
    await clock.advance(6_000)
    expect(sent).toEqual([{ to: 'a-sim', text: expect.stringContaining('ended with exit code 0') }])
    await clock.advance(40_000)
    expect(submitted).toEqual([expect.stringContaining('agent simclasses has been stalled for')])
  })

  test('a teammate the lead stops with TaskStop reads done and never rings, whatever the list says after', { options: OPTIONS }, async ($, on) => {
    let status: Status = 'running'
    const { clock, sent, submitted } = engine(on, () => status)
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a-sim' } as never)
    await clock.advance(6_000)
    await $.turn.complete(turnEnd('a-sim'))
    await $.tool.call({ tool: 'TaskStop', task_id: 'a-sim' } as never)
    status = 'completed'
    await clock.advance(90_000)
    expect(sent).toEqual([])
    expect(submitted).toEqual([])
  })

  test('a teammate the list calls killed reads done and never rings', { options: OPTIONS }, async ($, on) => {
    let status: Status = 'running'
    const { clock, sent, submitted } = engine(on, () => status)
    await $.session.start(SURFACE)
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a-sim' } as never)
    await clock.advance(6_000)
    await $.turn.complete(turnEnd('a-sim'))
    status = 'killed'
    await clock.advance(90_000)
    expect(sent).toEqual([])
    expect(submitted).toEqual([])
  })

  test('/binnacle wake off keeps the lead asleep; binnacle still shows the stall', { options: OPTIONS }, async ($, on) => {
    const { clock, submitted } = engine(on)
    await $.session.start(SURFACE)
    expect((await $.command.run({ command: 'binnacle', args: 'wake off' } as never)).text).toContain('only shows in binnacle')
    await $.tool.call({ tool: 'Bash', command: 'ls', agentId: 'a-sim' } as never)
    await clock.advance(6_000)
    await $.turn.complete(turnEnd('a-sim'))
    await clock.advance(60_000)
    expect(submitted).toEqual([])
  })
})
