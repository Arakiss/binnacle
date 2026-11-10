import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bashRow, resultView } from '../render/bash-row'

/** The engine's own rows, drawn as their text. */
function engine(on: On) {
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="native">{`${e.props.tool}(${(e.props.input as { command?: string }).command ?? ''})`}</Text>
  })
  on('ui.render', { component: 'ToolResult' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="native-result">native result</Text>
  })
}

const row = (input: object, isExpanded = false) =>
  ({
    component: 'ToolUse',
    props: { tool_use_id: 't1', tool: 'Bash', input, isRunning: false, isErrored: false, isInterrupted: false, isExpanded },
  }) as const

const result = (output: object, isExpanded = true, isErrored = false) =>
  ({ component: 'ToolResult', props: { tool_use_id: 't1', tool: 'Bash', output, isErrored, isExpanded } }) as const

test('a Bash row names its purpose, its folder and the command apart', async ($, on) => {
  engine(on)
  const drawn = await $.ui.mount({
    plugin: 'binnacle',
    surface: 'terminal',
    ...row({ command: 'cd /Users/ana/repo && git status --short', description: 'Show working tree status' }),
  })
  expect(await drawn.find({ type: 'Text', text: 'Bash(Show working tree status)' })).toBeDefined()
  expect(await drawn.find({ type: 'Text', text: '~/repo' })).toBeDefined()
  expect(await drawn.find({ type: 'Code' })).toEqual(expect.objectContaining({ props: expect.objectContaining({ source: 'git status --short', language: 'bash' }) }))
  await drawn.unmount()
})

test('a command with control characters still draws', async ($, on) => {
  engine(on)
  const drawn = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...row({ command: "printf '\x1b[31mred\x1b[0m\r\x07'" }) })
  expect(await drawn.find({ type: 'Code' })).toEqual(expect.objectContaining({ props: expect.objectContaining({ source: "printf 'red'" }) }))
  await drawn.unmount()
})

test('other tools and other surfaces keep the engine row', async ($, on) => {
  engine(on)
  const read = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'ToolUse', props: { ...row({ command: 'x' }).props, tool: 'Read' } })
  expect(await read.find({ type: 'Code' })).toBeUndefined()
  await read.unmount()
  const desktop = await $.ui.mount({ plugin: 'binnacle', surface: 'desktop', ...row({ command: 'ls' }) })
  expect(await desktop.find({ type: 'Code' })).toBeUndefined()
  await desktop.unmount()
})

test('a folded row counts the lines it leaves out and ctrl+o shows them', async ($, on) => {
  engine(on)
  const command = Array.from({ length: 20 }, (_, i) => `echo ${i}`).join('\n')
  const folded = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...row({ command }) })
  expect(await folded.find({ type: 'Text', text: /\+8 lines/ })).toBeDefined()
  await folded.unmount()
  const expanded = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...row({ command }, true) })
  expect(await expanded.find({ type: 'Text', text: /lines/ })).toBeUndefined()
  await expanded.unmount()
})

test('expanded, the row draws purpose, command and result, and the result block steps aside', async ($, on) => {
  engine(on)
  const clean = { stdout: '{"ok":true}\n', stderr: '', interrupted: false }
  const drawn = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'ToolUse', props: { ...row({ command: 'jq . a.json', description: 'Read a' }, true).props, output: clean } })
  expect(await drawn.find({ type: 'Code', text: 'jq . a.json' })).toEqual(expect.objectContaining({ props: expect.objectContaining({ language: 'bash' }) }))
  expect(await drawn.find({ type: 'Code', text: '{"ok":true}' })).toEqual(expect.objectContaining({ props: expect.objectContaining({ language: 'json', source: '{"ok":true}' }) }))
  await drawn.unmount()

  const block = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...result(clean) })
  expect(await block.find({ type: 'Text', text: 'native result' })).toBeUndefined()
  await block.unmount()
})

test('a failed call leaves its error to the engine, once', async ($, on) => {
  engine(on)
  const failed = { stdout: '', stderr: 'boom', interrupted: false }
  const drawn = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', component: 'ToolUse', props: { ...row({ command: 'false' }, true).props, isErrored: true, output: failed } })
  expect(await drawn.find({ type: 'Text', text: 'boom' })).toBeUndefined()
  expect(await drawn.find({ type: 'Code', text: 'false' })).toBeDefined()
  await drawn.unmount()
  const block = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...result(failed, true, true) })
  expect(await block.find({ type: 'Text', text: 'native result' })).toBeDefined()
  await block.unmount()
})

test('a folded result, or one with fields only the engine draws, stays the engine one', async ($, on) => {
  engine(on)
  const clean = { stdout: 'x', stderr: '', interrupted: false }
  for (const shape of [result(clean, false), result({ ...clean, persistedOutputPath: '/tmp/o' }), result({ ...clean, interrupted: true })]) {
    const native = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...shape })
    expect(await native.find({ type: 'Text', text: 'native result' })).toBeDefined()
    await native.unmount()
  }
})

test('the row reads a leading cd in its usual spellings and leaves the rest alone', () => {
  expect(bashRow({ command: 'cd "/Users/ana/my repo"; ls' }, false)).toEqual({ title: 'ls', folder: '~/my repo', source: 'ls', hidden: 0 })
  expect(bashRow({ command: "cd '/tmp/x' && rg foo src" }, false)).toEqual({ title: 'rg', folder: '/tmp/x', source: 'rg foo src', hidden: 0 })
  expect(bashRow({ command: 'cd /tmp' }, false)).toEqual({ title: 'cd', folder: null, source: 'cd /tmp', hidden: 0 })
  expect(bashRow({ command: 'cd $(git rev-parse --show-toplevel) && ls' }, false)?.folder).toBeNull()
  expect(bashRow({ command: '   ' }, false)).toBeNull()
  expect(bashRow({ file_path: '/x' }, false)).toBeNull()
})

test('the result view keeps every byte it can draw and gives up on the rest', () => {
  const clean = (stdout: string, stderr = '') => ({ stdout, stderr, interrupted: false })
  const diff = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n'
  expect(resultView(clean(diff))?.language).toBe('diff')
  expect(resultView(clean('\x1b[32m[1,2]\x1b[0m'))).toEqual({ out: '[1,2]', err: '', language: 'json' })
  expect(resultView(clean('[warn] not json'))?.language).toBeNull()
  expect(resultView(clean('out', 'warning'))).toEqual({ out: 'out', err: 'warning', language: null })
  expect(resultView('Exit code 1')).toBeNull()
  expect(resultView(clean('x'.repeat(30_000)))).toBeNull()
  expect(resultView({ ...clean('[1]'), backgroundTaskId: 'b1' })).toBeNull()
  expect(resultView(undefined)).toBeNull()
})

test('every system prompt asks for tool descriptions the user can read, in their language', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'base', scope: 'shared', text: 'base' }] }))
  const { sections } = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Bash'], outputStyle: null, traits: [] })
  expect(sections.map(section => section.id)).toEqual(['base', 'binnacle:tool-descriptions'])
  expect(sections[1]?.text).toMatch(/plain English/)
})

test('with bashRows off the engine draws its own Bash rows and the prompt asks for nothing', { options: { bashRows: false } }, async ($, on) => {
  engine(on)
  on('prompt.compose', () => ({ sections: [{ id: 'base', scope: 'shared', text: 'base' }] }))
  const drawn = await $.ui.mount({ plugin: 'binnacle', surface: 'terminal', ...row({ command: 'ls', description: 'List' }) })
  expect(await drawn.find({ type: 'Code' })).toBeUndefined()
  await drawn.unmount()
  const { sections } = await $.prompt.compose({ model: 'claude-opus-5-5', promptModel: 'claude-opus-5-5', surfaces: ['terminal'], tools: ['Bash'], outputStyle: null, traits: [] })
  expect(sections.map(section => section.id)).toEqual(['base'])
})
