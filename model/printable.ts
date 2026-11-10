const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/g

/** The engine refuses a tree with control characters in it: tab and newline alone may stay. */
export const printable = (text: string) => text.replace(ANSI, '').replace(CONTROL, '')
