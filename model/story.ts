// What each loop works on, in words. binnacle's other models say how a loop stands (working,
// waiting, stalled); this one keeps what it is about: what it was asked, the last thing it wrote
// between calls, how its last turn ended, and the shape of its calls. model/digest.ts has a small
// model read all of it into a sentence (`brief`). Pure reducers over the activity, bounded like
// every other list there; `at` is passed in.

import { cut } from '../render/text'
import type { Activity, AgentRun, Brief, Finished, Story, Trail } from '../types'
import { touchAgent } from './activity'

export const LIMITS = {
  /** Characters kept of one request, and how many requests. */
  ask: 600,
  asks: 3,
  /** Characters kept of what a loop said, and of how its turn ended. */
  said: 280,
  outcome: 280,
  /** Edited files a trail names. */
  files: 4,
  /** Characters of one clause of a brief. */
  clause: 160,
}

const EMPTY_TRAIL: Trail = { read: 0, search: 0, edit: 0, run: 0, web: 0, agent: 0, other: 0, files: [] }

type Kind = Exclude<keyof Trail, 'files'>

const KINDS: Record<string, Kind> = {
  Read: 'read',
  NotebookRead: 'read',
  Grep: 'search',
  Glob: 'search',
  LS: 'search',
  LSP: 'search',
  ToolSearch: 'search',
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Bash: 'run',
  BashOutput: 'run',
  Monitor: 'run',
  WebFetch: 'web',
  WebSearch: 'web',
  Agent: 'agent',
  Task: 'agent',
  Workflow: 'agent',
}

/** What a tool's call counts as in a trail. */
export const kindOf = (tool: string): Kind => KINDS[tool] ?? 'other'

/** How many calls a trail holds. */
export const stepsOf = (trail: Trail | undefined): number => (trail === undefined ? 0 : trail.read + trail.search + trail.edit + trail.run + trail.web + trail.agent + trail.other)

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim()

/**
 * A model's text as the lines a person would read aloud: fenced code, tables and markup lines
 * left out, list marks, headings and emphasis stripped.
 */
export function prose(text: string): string[] {
  return text
    .replace(/```[\s\S]*?(```|$)/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line !== '' && !/^[|<]/.test(line) && !/^[-=*_]{3,}$/.test(line))
    .map(line =>
      collapse(
        line
          .replace(/^(#{1,6}|>|[-*•]|\d+[.)])\s+/, '')
          .replace(/\*\*|__|`/g, '')
          .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
      ),
    )
    .filter(line => line !== '')
}

/** The last thing a loop wrote before it acted: where it says what it is about to do. */
export function lastWords(text: string, max = LIMITS.said): string {
  return cut(prose(text).at(-1) ?? '', max)
}

/** How an answer opens: where a report puts what it found. A first line of a word or two ("Done.") takes the next along. */
export function opening(text: string, max = LIMITS.outcome): string {
  const [first = '', second] = prose(text)
  return cut(first.split(' ').length < 4 && second !== undefined ? `${first} ${second}` : first, max)
}

/**
 * Whether a turn's opening text is a request: the person's words, or the prompt an agent was
 * given. A notice the engine wrote (a task's end, a reminder, a command's echo) opens with a tag.
 */
export function isAsk(text: string): boolean {
  const said = text.trim()
  return said !== '' && !said.startsWith('<')
}

const storyOf = (a: Activity, agentId: string | undefined): Story => (agentId === undefined ? a.story : a.agents.find(run => run.id === agentId)?.story) ?? {}

/** The activity with the story of the main loop, or of the agent `agentId`, changed. */
function retold(a: Activity, agentId: string | undefined, at: number, change: (story: Story) => Story): Activity {
  if (agentId === undefined) return { ...a, story: change(a.story ?? {}) }
  return { ...a, agents: touchAgent(a.agents, agentId, at, run => ({ ...run, story: change(run.story ?? {}) })) }
}

/** A loop was asked something: its newest request, kept with the few before it. */
export function asked(a: Activity, agentId: string | undefined, text: string, at: number): Activity {
  if (!isAsk(text)) return a
  const ask = cut(collapse(text), LIMITS.ask)
  if (storyOf(a, agentId).asks?.at(-1) === ask) return a
  return retold(a, agentId, at, story => ({ ...story, asks: [...(story.asks ?? []), ask].slice(-LIMITS.asks), askedAt: at }))
}

/** The main loop's turn began: its trail starts over; what it was asked and its brief stand. */
export function turnBegan(a: Activity): Activity {
  if (a.story === undefined) return a
  const { trail: _trail, ...story } = a.story
  return { ...a, story }
}

/** A loop wrote `text` in a step of its turn. */
export function said(a: Activity, agentId: string | undefined, text: string, at: number): Activity {
  const words = lastWords(text)
  if (words === '') return a
  return retold(a, agentId, at, story => ({ ...story, said: words, saidAt: at }))
}

/** A loop's turn ended with `answer`. */
export function concluded(a: Activity, agentId: string | undefined, answer: string, at: number): Activity {
  const words = opening(answer)
  if (words === '') return a
  return retold(a, agentId, at, story => ({ ...story, outcome: words, outcomeAt: at }))
}

/** A loop made a call with `tool`, on `file` when it edits one. */
export function called(a: Activity, agentId: string | undefined, tool: string, at: number, file?: string): Activity {
  return retold(a, agentId, at, story => {
    const trail = story.trail ?? EMPTY_TRAIL
    const kind = kindOf(tool)
    const files = file === undefined ? trail.files : [file, ...trail.files.filter(f => f !== file)].slice(0, LIMITS.files)
    return { ...story, trail: { ...trail, [kind]: trail[kind] + 1, files } }
  })
}

/** The three clauses of a brief, before they are stamped. */
export type BriefWords = Omit<Brief, 'at'>

/** What one reading by the model said: of the main loop, and of each agent by id. */
export type Briefs = { main?: BriefWords; agents: Readonly<Record<string, BriefWords>> }

/** The model's reading folded in; an agent that went meanwhile is left alone. */
export function briefed(a: Activity, briefs: Briefs, at: number): Activity {
  const stamped = (story: Story | undefined, words: BriefWords): Story => ({ ...(story ?? {}), brief: { ...words, at } })
  return {
    ...a,
    ...(briefs.main === undefined ? {} : { story: stamped(a.story, briefs.main) }),
    agents: a.agents.map((run): AgentRun => {
      const words = briefs.agents[run.id]
      return words === undefined ? run : { ...run, story: stamped(run.story, words) }
    }),
  }
}

/** The spans a pulse counts calls in, and how long each lasts: three minutes in all. */
export const PULSE_SPANS = 12
export const PULSE_SPAN_MS = 15_000

/** The main loop's calls of the last three minutes, counted per span, oldest first; the spans are fixed to the clock, so they do not slide between redraws. */
export function pulseOf(a: Activity, now: number): number[] {
  const last = Math.floor(now / PULSE_SPAN_MS)
  const spans = Array.from({ length: PULSE_SPANS }, () => 0)
  for (const call of a.calls) {
    if (call.agentId !== undefined) continue
    const i = PULSE_SPANS - 1 - (last - Math.floor(call.at / PULSE_SPAN_MS))
    if (i >= 0 && i < PULSE_SPANS) spans[i] = (spans[i] ?? 0) + 1
  }
  return spans
}

/** How long an agent that reported stays in sight. */
export const FINISHED_MS = 3 * 60_000

/** The most finished agents shown. */
const FINISHED_MAX = 3

/** The agents that handed their report back within FINISHED_MS, newest first, with how it opened. */
export function finishedOf(a: Activity, now: number): Finished[] {
  return a.agents
    .flatMap(run => {
      const outcome = run.story?.outcome
      if (run.endedAt === undefined || run.reportedAt === undefined || outcome === undefined || now - run.endedAt > FINISHED_MS) return []
      return [{ id: run.id, name: run.name, endedAt: run.endedAt, outcome }]
    })
    .sort((x, y) => y.endedAt - x.endedAt)
    .slice(0, FINISHED_MAX)
}

/** A story with nothing a drawing reads left out, as the state file carries it. */
export function slim(story: Story | undefined): Story | undefined {
  if (story === undefined) return undefined
  const { asks, askedAt, said: words, saidAt, outcome, outcomeAt, trail, brief } = story
  const kept = { asks: asks?.slice(-1), askedAt, said: words, saidAt, outcome, outcomeAt, trail, brief }
  const known = Object.fromEntries(Object.entries(kept).filter(([, value]) => value !== undefined))
  return Object.keys(known).length === 0 ? undefined : known
}

/**
 * The newest words of a text that is still being written: from the start of its last sentence
 * while that fits `max`, else its last `max` characters from a word's start, an ellipsis before.
 */
export function tail(text: string, max = 110): string {
  const flat = collapse(text)
  const from = Math.max(flat.lastIndexOf('. ', flat.length - 12), flat.lastIndexOf(': ', flat.length - 12))
  const sentence = from === -1 ? flat : flat.slice(from + 2)
  if (sentence.length >= 12 && sentence.length <= max) return sentence
  if (flat.length <= max) return flat
  const end = flat.slice(-(max - 1))
  const space = end.indexOf(' ')
  return `…${space === -1 || space > max / 2 ? end : end.slice(space + 1)}`
}
