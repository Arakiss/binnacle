# Contributing to binnacle

Issues and pull requests are welcome. binnacle is a Claude Code plugin of function hooks; you need
[Claude Code](https://code.claude.com) and [Bun](https://bun.sh) to work on it.

## Run it

```bash
claude --plugin-dir /path/to/binnacle    # a session with your checkout loaded; saves reload it
```

## Before you open a pull request

```bash
claude plugin test .          # the test suite
claude plugin validate .      # what the engine would refuse
bun tools/i18n.ts --check     # dictionaries complete and built
```

CI runs the same three.

## How the code is laid out

- `model/` turns the session's events into facts: pure reducers, no clock of their own.
- `render/` decides the band, the pane and the status line as data, from those facts.
- `hooks/` is the only part that touches the engine: it listens, reads, writes and draws.
- `tests/fixtures.ts` holds made-up sessions; the tests, `tools/preview.ts` and the README's
  pictures all draw from them.

A change to what the band shows comes with a test that reads the band's lines, and, when it adds
words, with the key in both `i18n/en.json` and `i18n/es.json` (then `bun tools/i18n.ts`).

## Pictures

The README's stills and recording are drawn from the fixtures, never from a real session, so no
one's work ends up in the repository. `README.md` says how to rebuild them.

## Commits and releases

Commits follow [Conventional Commits](https://www.conventionalcommits.org) (`feat:`, `fix:`,
`docs:`, `chore:`). A release bumps `version` in `.claude-plugin/plugin.json` and the README,
adds its section to `CHANGELOG.md`, and is tagged `vX.Y.Z`: an installed copy only picks up new
behaviour through a new version.
