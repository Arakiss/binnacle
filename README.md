# binnacle

A heads-up display for Claude Code. When a session runs a dozen subagents, a workflow and a few
background shells at once, the transcript stops telling you who is doing what. binnacle draws a
band above the prompt with one row per agent, workflow, shell and other session: how it stands,
since when, and what it is doing right now.

```
 ✳ Opus 5.5 · high    ctx ███████ 92% compact now   5h █████ 62% ▲ full in 40m   7d ███ 41%
acme  main ●2 ↑1   #41 ✗ 2/9   ◐ working 3m · 14 actions · 2 agents · ✖ 1 stalled      r: reap 6   p: panel
⚠ CI failing (2 of 9)   ⚠ 6 orphan Codex loops → press r   ⚠ 3 actions denied this turn
✖ explore types  stalled 12m  idle with nothing to wake it
✗ main           exit 2 2m    Lint the plugin
◐ width-audit    working 2m   thinking
◐ main           shell 6m     Wait for PR 2303 to reach production
◐ main           shell 14m    Executor · inbox redesign
✓ main           ended 1m     Render the mockups
```

## What it shows

- **Budgets**: the model and effort, the context window, and the five-hour and weekly quotas as
  gauges. A quota you are burning faster than the clock turns amber; one that will run out before
  it resets says when.
- **Where you are**: repository, branch, uncommitted and unpushed work, the pull request and its
  checks, and how long the session has run.
- **One row per agent and shell**: working, waiting, stalled, unknown or done, with the call it is
  making. A workflow's agents share one row under the workflow's name. A shell whose output stopped
  changing says so.
- **Stalls**: an agent that went idle with nothing left that will wake it is marked stalled. binnacle
  tells the agent once before it idles, and can wake the main loop with a note (`/binnacle wake`).
- **Alerts**: failing CI, denied actions this turn, other sessions writing in the same checkout.
- **A status pane** (`/binnacle`, or `p`): the turn's calls with their results, every refusal with
  its reason, agents and shells, pull request and CI, usage with sparklines, compactions, edited
  files and loaded skills.

## Install

At the prompt of a Claude Code session:

```
/plugin install binnacle --marketplace Arakiss/binnacle
```

Answer `y` to add the marketplace, then pick a scope. From a shell:

```
claude plugin install binnacle --marketplace Arakiss/binnacle
```

The band uses a few [Nerd Font](https://www.nerdfonts.com/) glyphs (the branch sign); any Nerd
Font in your terminal covers them.

## Commands

| Command | What it does |
| --- | --- |
| `/binnacle` | Opens or closes the status pane |
| `/binnacle band on\|off` | Draws above the prompt, or leaves the status line to it |
| `/binnacle line full\|compact\|hidden` | How much the status line shows |
| `/binnacle wake on\|off` | Whether a stalled agent wakes the main loop with a note |
| `/binnacle reap` | Ends orphaned Codex loops (with `watchCodexLoops` on) |

## Options

Set them in the plugin's settings (`/plugin`, then binnacle):

| Option | Default | What it does |
| --- | --- | --- |
| `language` | `en` | The language binnacle speaks: `en`, `es`, or any dictionary you add |
| `peersCommand` | empty | A command that lists your other sessions, so each gets a row (below) |
| `watchCodexLoops` | off | Flags Codex app-server wrapper loops left behind by Zentty and offers to end them |
| `hideModeHint` | off | Drops the permission-mode reminder from the hint under the prompt |

### Language

Every word binnacle draws comes from a JSON dictionary under `i18n/`. English is the default and
Spanish ships with it: set `language` to `es`. To add a language, copy `i18n/en.json` to
`i18n/<code>.json`, translate the values, keep the `{placeholders}`, and run
`bun tools/i18n.ts` to build it in. A key a dictionary leaves out falls back to English.

binnacle also reads `i18n/<language>.json` from its folder when a session starts, so you can change
a word without rebuilding: the file's keys win over the built-in ones.

### Other sessions

binnacle can give each of your other live sessions a row. Point `peersCommand` at any command that
prints a JSON array of sessions, for example a small script of your own:

```json
[
  {
    "session": "b1c2d3e4",
    "harness": "claude-code",
    "cwd": "/home/you/shop",
    "repo": "/home/you/shop",
    "branch": "main",
    "intent": "Vesper: syncing the docs site",
    "liveness": "live",
    "lifecycle": "active",
    "last_ms": 1793000000000
  }
]
```

Only `session` is required. An `intent` that opens with a capitalised name and a colon shows that
name; `liveness: "live"` gets a row; `lifecycle` other than `active` is left out. The command runs
without a shell, split on spaces, every ten seconds.

## Status line

The band is the main view. binnacle also ships a status line for terminals where you would rather
keep the band off (`/binnacle band off`). Each session writes a small launcher to
`~/.claude/binnacle/statusline.sh` that runs the installed version, so point Claude Code's
`statusLine` at it in `~/.claude/settings.json`:

```json
{
  "statusLine": { "type": "command", "command": "sh ~/.claude/binnacle/statusline.sh" }
}
```

It needs [Bun](https://bun.sh), and keeps working when an update moves the plugin. While the band
is on, the status line stays quiet; `BINNACLE_LINE=full` in its command prints the full lines
anyway.

`bun tools/liveness.ts` prints the same verdicts for the latest session, one row per agent and
shell, and exits with code 3 while an agent is stalled, for scripts and other tools to read.

## Development

```
claude --plugin-dir /path/to/binnacle    # run a session with this checkout loaded
claude plugin test .                     # the test suite
claude plugin validate .
bun tools/i18n.ts --check                # dictionaries complete and built
bun tools/preview.ts 120 band            # draw every fixture at 120 columns
```

## License

MIT
