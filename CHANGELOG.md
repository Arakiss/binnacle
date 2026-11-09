# Changelog

Every change a user of binnacle can notice. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); before 1.0.0 a minor version may
change what the band shows.

## [0.4.0] - 2026-11-09

The band now says what is being worked on, not which tool ran last.

### Added

- A heading for the session itself: its goal, what it does now (with the call that runs, or the
  model's thinking as it streams, beside it) and what it has so far; between turns, how the last
  turn ended. A pulse of the last three minutes' calls sits beside how long the turn has run.
- A small model (`haiku`) reads what each loop was asked, said and did into three short clauses.
  It is asked only when the work moved, never while the session is idle, and at most 90 times an
  hour. `/binnacle digest on|off` switches it; without it the band shows each loop's own words.
- Each agent's row says what it is on, in words, with a second line for its goal and what it has
  so far when the band has rows to spare.
- Under the pointer, an agent's row shows the task it was given, whole.
- An agent that just reported keeps a row for three minutes with how its report opens.
- Other sessions that run binnacle get a row each, with their goal and what they do now, from
  their own state files and with nothing to configure.
- A "what it is about" section at the top of the status pane.
- `tools/shot.ts` and `tools/demo.ts`, which draw the README's stills and recording from the test
  fixtures.
- CI on every push and pull request, a guide for contributors, issue forms and a security policy.

### Changed

- The model, the budgets, the repo and the branch move from the band's first two lines to one
  line at its foot.
- The main loop no longer takes a row beside the agents: the heading is its place.
- Other sessions come last, under a rule with their title.
- With the `language` option left at its default, binnacle follows Claude Code's own `language`
  setting when it has that dictionary.
- The spinner is a braille one.

## [0.3.0] - 2026-10-26

### Added

- `bun tools/quota.ts` answers how much of each rate-limit window is left, when it resets, the
  pace of the last hour and whether the window fills before it resets.
- The state file keeps each rate-limit window's last reading.

## [0.2.0] - 2026-10-26

### Added

- The full status block as a classic status line (`tools/statusline.ts`).
- The `/binnacle` command takes the chosen language's words as well as the English ones.
- Other sessions sit under their own title when they share the band, and are named by the peers
  command's `display_name`.
- With the band off, a one-line summary pinned under the prompt.

## [0.1.0] - 2026-10-26

### Added

- binnacle: a band above the Claude Code prompt with a row per agent, workflow, background shell
  and other session, context and quota gauges, liveness verdicts, alerts and a status pane.

[0.4.0]: https://github.com/Arakiss/binnacle/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/Arakiss/binnacle/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Arakiss/binnacle/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Arakiss/binnacle/releases/tag/v0.1.0
