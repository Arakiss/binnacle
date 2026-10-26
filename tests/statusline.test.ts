import { describe, expect, test } from 'claude-code/testing'

import { t, useLanguage } from '../i18n'
import { printed, statusOf, type Input } from '../render/statusline'
import { IDLE, NOW, TZ } from './fixtures'

const INPUT: Input = {
  session_id: 'session-1',
  model: { id: 'claude-opus-5-5', display_name: 'Opus' },
  context_window: { used_percentage: 34, context_window_size: 1_000_000, total_input_tokens: 340_000 },
  rate_limits: { five_hour: { used_percentage: 62, resets_at: NOW / 1000 + 7200 }, seven_day: { used_percentage: 9 } },
}

const PRINT = { columns: 160, now: NOW, tz: TZ, runs: [], isForced: false }

/** The printed lines without their colour. */
const plain = (lines: readonly string[]) => lines.map(line => line.replace(/\x1b\[[0-9;]*m/g, ''))

describe('the classic status line', () => {
  test("it reads Claude Code's status line input: the model, the context and each rate-limit window", () => {
    const status = statusOf(INPUT)
    expect(status.model).toBe('Opus 5.5')
    expect(status.context).toEqual({ percent: 34, tokens: 340_000, window: 1_000_000 })
    expect(status.limits).toEqual([
      { kind: 'five_hour', percent: 62, resetsAt: NOW + 7_200_000 },
      { kind: 'seven_day', percent: 9, resetsAt: undefined },
    ])
    expect(statusOf({}).model).toBe('Claude')
  })

  test('it prints the status block, and nothing while the band draws unless forced', () => {
    const lines = plain(printed(INPUT, IDLE, PRINT))
    expect(lines.length).toBeGreaterThanOrEqual(2)
    expect(lines[0]).toContain(t('status.idle'))
    expect(lines.join('\n')).toContain('acme')
    expect(printed(INPUT, { ...IDLE, band: true }, PRINT)).toEqual([])
    expect(plain(printed(INPUT, { ...IDLE, band: true }, { ...PRINT, isForced: true }))).toEqual(lines)
    expect(printed(INPUT, { ...IDLE, mode: 'hidden' }, PRINT)).toEqual([])
  })

  test('it speaks the language binnacle speaks in that session', () => {
    try {
      const spanish = plain(printed(INPUT, { ...IDLE, language: 'es' }, PRINT))
      // printed() switched the words to the session's language; the expectation reads the same dictionary.
      expect(spanish[0]).toContain(t('status.idle'))
      useLanguage('en')
      expect(spanish[0]).not.toContain(t('status.idle'))
    } finally {
      useLanguage('en')
    }
  })
})
