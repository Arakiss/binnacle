/** A rate-limit window as last measured; `resetsAt` in milliseconds. */
export type Meter = { kind: string; percent: number; resetsAt?: number }

/** The session's context window, rate limits and cost, as `session.measure` pushes them. */
export type Snapshot = {
  percent?: number
  tokens?: number
  window: number
  limits: Meter[]
  usd?: number
}

export type Git = {
  root: string
  repo: string
  branch: string
  dirty: number
  ahead: number
  behind: number
}

/** Checks of the pull request for the current branch, by outcome. */
export type Ci = { pass: number; fail: number; pending: number }

/** The pull request for the current branch; `review` is gh's reviewDecision, '' when none; `url` its page. */
export type Pr = { number: number; review: string; url?: string }

/** Another live or recently seen session, as the `peersCommand` option's command lists it. */
export type Peer = {
  session: string
  harness: string
  place: string
  repo: string
  branch: string | null
  intent: string | null
  liveness: string
  lastMs: number
}

/** One reading of a rate-limit window, to project when it fills. */
export type Sample = { t: number; p: number }

export type Mode = 'full' | 'compact' | 'hidden'

export type Outcome = 'running' | 'ok' | 'error' | 'denied'

/** One tool call, of the main loop or of an agent (`agentId`). */
export type Call = {
  id: string
  at: number
  agentId?: string
  tool: string
  target: string
  /** The call's own words for itself (a Bash or Agent description), when it gave them. */
  said?: string
  outcome: Outcome
  reason?: string
  ms?: number
}

/** A Monitor an agent armed: its task, and when it expires at the latest (absent: until stopped). */
export type Watch = { id: string; until?: number }

/** What binnacle knows of whether an agent can be woken; model/liveness.ts reads it. */
export type AgentFacts = {
  /** A teammate: idle between turns and woken by a message; the end of its turn is not its end. */
  isTeammate?: boolean
  /** Where its loop stands as its own events tell: in a turn or idle; absent when none was seen here. */
  phase?: 'turn' | 'idle'
  /** When `phase` began. */
  phaseAt?: number
  /** The engine's AgentStatus at the last reading of `$.agent.list()`. */
  status?: string
  /** When a subagent's run handed its report back. */
  reportedAt?: number
  /** Its last message out, and to whom. */
  sentAt?: number
  sentTo?: string
  /** The last message delivered to it. */
  heardAt?: number
  monitors?: Watch[]
}

/** An agent's newest call: what it does now while `running`, else the last thing it did. */
export type Doing = { id: string; tool: string; text: string; at: number; running: boolean }

/** A subagent or background agent seen this session. */
export type AgentRun = AgentFacts & {
  id: string
  name: string
  type: string
  isBackground?: boolean
  startedAt: number
  lastAt: number
  actions: number
  /** Tool calls of the agent still running. */
  busy: number
  endedAt?: number
  /** When the idle hook last told it it had nothing to wake it. */
  nudgedAt?: number
  /** The `since` of the stall the lead was last told of. */
  toldAt?: number
  /** The run id of the workflow that started it; `$.agent.list()` never lists such an agent. */
  workflow?: string
  doing?: Doing
}

export type FileTouch = { path: string; edits: number; lastAt: number }

export type SkillLoad = { name: string; at: number }

/** A denied or failed call, with the first line of why. */
export type Block = { at: number; tool: string; target: string; reason: string; agentId?: string; said?: string }

export type Compaction = { at: number; trigger: string; before?: number; after?: number }

/** A message that crossed this session's edge: received (`in`) or sent (`out`). */
export type Note = { at: number; direction: 'in' | 'out'; who: string; text: string }

/** The main loop's running turn. */
export type Turn = { id: string; startedAt: number; steps: number; actions: number; denials: number }

export type LastTurn = { endedAt: number; seconds: number; actions: number; steps: number }

/** What the session did, bounded: every list keeps its newest entries only. */
export type Activity = {
  turn: Turn | null
  last: LastTurn | null
  calls: Call[]
  agents: AgentRun[]
  files: FileTouch[]
  skills: SkillLoad[]
  denials: Block[]
  errors: Block[]
  deniedTotal: number
  errorTotal: number
  compactions: Compaction[]
  notes: Note[]
  /** Deny reasons `tool.check` gave, by tool_use_id, until the call's result arrives. */
  checks: Record<string, string>
  /** Each workflow run's `meta.name`, by run id, as its Workflow call returned them; absent before any. */
  workflows?: Record<string, string>
}

/**
 * A background shell this session started: `id` is the task id its output file is named after,
 * `output` that file, which ends with `[exited with code N]` once the command ends.
 */
export type Shell = {
  id: string
  label: string
  startedAt: number
  output: string
  stoppedAt?: number
  /** The agent whose call started it; absent for the main loop's. */
  agentId?: string
  /** When the mod told its idle agent that it ended. */
  toldAt?: number
}

/** An active agent as the status line needs it: enough to say whether it works, waits or stalled. */
export type AgentPulse = AgentFacts & { id?: string; name: string; lastAt: number; busy: number; workflow?: string; doing?: Doing }

/** What binnacle writes to ./state/<session>.json, the facts the status line and tools/liveness.ts draw from; kept small. */
export type Shared = {
  mode?: Mode
  git?: Git | null
  ci?: Ci | null
  crowd?: number
  loops?: number
  history?: Record<string, Sample[]>
  /** `doing`: the main loop's running call in words, as an agent's `doing.text`; `previous` its last ended one. */
  turn?: { startedAt: number; actions: number; denials: number; tool: string | null; doing?: string; previous?: string } | null
  last?: LastTurn | null
  agents?: AgentPulse[]
  shells?: Shell[]
  /** The names of the workflows the active agents belong to, by run id. */
  workflows?: Record<string, string>
  /** The language the words are in, so tools/liveness.ts writes in the same one. */
  language?: string
}

declare module 'claude-code' {
  interface PluginState {
    binnacle: {
      snapshot: Snapshot | null
      git: Git | null
      ci: Ci | null
      pr: Pr | null
      peers: Peer[]
      loops: number[]
      history: Record<string, Sample[]>
      mode: Mode
      activity: Activity
      shells: Shell[]
      /** Whether binnacle draws in the band above the prompt (true) or in the status line alone. */
      band: boolean
      /** Local offset from UTC in minutes, as `date +%z` gave it. */
      tz: number
      /** Whether a stalled agent wakes the main loop with a note (`/binnacle wake on|off`). */
      wake: boolean
    }
  }
}
