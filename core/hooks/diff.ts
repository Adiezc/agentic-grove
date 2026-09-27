/**
 * A line-by-line comparison of two small texts, for showing a change before making it.
 *
 * Written here rather than pulled in as a dependency because it is thirty lines, the inputs are a
 * settings file of a few dozen lines, and the only output needed is "which lines were added and
 * which removed". The textbook longest-common-subsequence table is fine at that size.
 */
export interface DiffLine {
  /** `gap` stands in for a run of unchanged lines that was folded away. */
  kind: 'same' | 'add' | 'remove' | 'gap'
  text: string
}

/** Unchanged lines kept either side of a change, so each change has something to be read against. */
const CONTEXT = 2

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split('\n')
  const b = after.split('\n')
  // Past this, the table gets big for no reason; show it as a whole replacement instead.
  if (a.length * b.length > 4_000_000) {
    return [...a.map((text) => ({ kind: 'remove' as const, text })), ...b.map((text) => ({ kind: 'add' as const, text }))]
  }
  const table = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1))
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!)
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ kind: 'same', text: a[i++]! })
      j++
    } else if (j < b.length && (i >= a.length || table[i]![j + 1]! >= table[i + 1]![j]!)) {
      lines.push({ kind: 'add', text: b[j++]! })
    } else {
      lines.push({ kind: 'remove', text: a[i++]! })
    }
  }
  return fold(lines)
}

/** Fold long unchanged runs down to their edges, so the change is what the eye lands on. */
function fold(lines: DiffLine[]): DiffLine[] {
  const near = lines.map((_, index) =>
    lines.slice(Math.max(0, index - CONTEXT), index + CONTEXT + 1).some((line) => line.kind !== 'same')
  )
  const folded: DiffLine[] = []
  lines.forEach((line, index) => {
    if (line.kind !== 'same' || near[index]) folded.push(line)
    else if (folded.at(-1)?.kind !== 'gap') folded.push({ kind: 'gap', text: '' })
  })
  return folded
}
