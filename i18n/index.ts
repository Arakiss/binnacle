// Every word binnacle shows comes from a dictionary: i18n/<language>.json, one flat object of keys
// to strings with {name} placeholders, plurals as `<key>.one` and `<key>.other`. English is the
// default and the fallback for any key a dictionary lacks.
//
// The engine loads code files alone, so the JSON is compiled into i18n/dictionaries.ts by
// `bun tools/i18n.ts`; the hooks module also reads the chosen language's JSON from disk when the
// session starts, so an edited or added dictionary works without that step.

import { DICTIONARIES } from './dictionaries'

export type Dictionary = Readonly<Record<string, string>>
export type Vars = Readonly<Record<string, string | number>>

export const DEFAULT_LANGUAGE = 'en'

const english: Dictionary = DICTIONARIES[DEFAULT_LANGUAGE] ?? {}

let active: Dictionary = english
let activeLanguage = DEFAULT_LANGUAGE

/**
 * Switches every word to `language`: the built-in dictionary of that name, then `override` (one
 * read from disk), over English. An unknown language with no override reads English.
 */
export function useLanguage(language: string, override: Dictionary = {}): void {
  activeLanguage = language
  active = { ...english, ...(DICTIONARIES[language] ?? {}), ...override }
}

/** The language the words are in now. */
export const language = () => activeLanguage

/** The words of `key` with each `{name}` filled from `vars`; the key itself when no dictionary has it. */
export function t(key: string, vars: Vars = {}): string {
  const text = active[key] ?? english[key] ?? key
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

/** `<key>.one` for one, `<key>.other` for any other count, with `{n}` set to the count. */
export function tn(key: string, n: number, vars: Vars = {}): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...vars })
}

/** A number with the language's decimal mark: "1.2" or "1,2". */
export function decimal(n: number, digits = 1): string {
  return n.toFixed(digits).replace('.', t('number.decimal'))
}

/** A dictionary as JSON parsed it, or null when it is not a flat object of strings. */
export function dictionaryFrom(value: unknown): Dictionary | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const entries = Object.entries(value)
  return entries.every(([, text]) => typeof text === 'string') ? (Object.fromEntries(entries) as Dictionary) : null
}
