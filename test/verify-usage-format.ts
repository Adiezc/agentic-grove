import assert from 'node:assert/strict'
import { compactTokens } from '../core/usage/format.ts'

const cases: [string, () => void][] = [
  ['under a thousand is shown as it is', () => {
    assert.equal(compactTokens(999), '999 tokens')
  }],
  ['a thousand is the first "k"', () => {
    assert.equal(compactTokens(1_000), '1k tokens')
  }],
  ['999,499 still rounds down to 999k', () => {
    assert.equal(compactTokens(999_499), '999k tokens')
  }],
  ['999,500 would round to "1000k", so it reads as 1.0M instead', () => {
    assert.equal(compactTokens(999_500), '1.0M tokens')
  }],
  ['a million reads as 1.0M', () => {
    assert.equal(compactTokens(1_000_000), '1.0M tokens')
  }],
]
let failed = 0
for (const [name, check] of cases) {
  try {
    check()
    console.log(`ok    ${name}`)
  } catch (error) {
    failed++
    console.log(`FAIL  ${name}\n      ${error instanceof Error ? error.message : String(error)}`)
  }
}
if (failed) process.exit(1)
console.log(`\nAll ${cases.length} token-format checks hold.`)
