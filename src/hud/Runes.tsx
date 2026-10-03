/**
 * A stone's saved tasks (runes): run one, save a new one, take one away, and answer the Grove's
 * suggestions. Shown in the stone's panel and, for every stone, in the rail's Saved tasks panel.
 *
 * Running a rune goes through the same launcher as sending an agent from the console: Terminal
 * opens in the project with your own Claude Code or Codex. The node side reads the task from
 * grove.json itself (`runRune`), so the page only ever names which rune.
 *
 * Suggestions (`core/state/suggest-runes.ts`) are offers, never actions: "Save" carves one, "No"
 * is remembered so it is not asked again.
 */
import { useState, type KeyboardEvent } from 'react'
import { Lightbulb, Play, Plus, Trash } from '@phosphor-icons/react'
import type { Runestone } from '../../core/state/stones.ts'
import { useFlow } from '../store/flow'
import { DEMO } from '../demo'

export function StoneRunes({ stone, compact = false }: { stone: Runestone; compact?: boolean }) {
  const openRun = useFlow((state) => state.openRun)
  const canWrite = Boolean(window.grove) && !DEMO
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  // Removing asks twice, like everything else that takes something away.
  const [confirming, setConfirming] = useState<string | null>(null)

  const act = async (key: string, call: () => Promise<{ ok: boolean; error?: string; runId?: string } | undefined>) => {
    setBusy(key)
    setError(null)
    const result = await call()
    setBusy(null)
    if (result && !result.ok) setError(result.error ?? 'That did not work')
    return result
  }
  const run = async (runeId: string) => {
    const result = await act(`run:${runeId}`, () => window.grove!.runRune(stone.id, runeId))
    if (result?.ok && result.runId) openRun(result.runId)
  }
  const remove = (runeId: string) => {
    if (confirming !== runeId) return setConfirming(runeId)
    setConfirming(null)
    void act(`remove:${runeId}`, () => window.grove!.removeRune(stone.id, runeId))
  }
  const save = async (prompt: string) => {
    const result = await act('save', () => window.grove!.carveRune(stone.id, prompt))
    if (result?.ok) {
      setAdding(false)
      setDraft('')
    }
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      if (draft.trim()) void save(draft)
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      setAdding(false)
    }
  }

  const suggestions = canWrite ? stone.runeSuggestions : []
  if (!stone.runes.length && !suggestions.length && (!canWrite || compact)) return null

  return (
    <section className="stone-runes" aria-label={`Saved tasks for ${stone.name}`}>
      {stone.runes.length ? (
        <ul className="rail-list">
          {stone.runes.map((rune) => (
            <li key={rune.id} className="rune-row">
              <span className="rail-row-text">
                {rune.name}
                {/* A short task is its own name; saying it twice is noise. */}
                {rune.prompt !== rune.name ? <small>{rune.prompt.length > 80 ? `${rune.prompt.slice(0, 79)}…` : rune.prompt}</small> : null}
              </span>
              {canWrite ? (
                <button
                  type="button"
                  className={`rune-remove${confirming === rune.id ? ' is-confirming' : ''}`}
                  onClick={() => remove(rune.id)}
                  onBlur={() => setConfirming(null)}
                  aria-label={confirming === rune.id ? `Remove ${rune.name}: press again to confirm` : `Remove ${rune.name}`}
                  title={confirming === rune.id ? 'Press again to remove' : 'Remove'}
                >
                  <Trash size={12} weight="thin" />
                </button>
              ) : null}
              <button
                type="button"
                className="setting-button"
                disabled={!canWrite || busy !== null}
                onClick={() => void run(rune.id)}
                title={`Opens Terminal in ${stone.name} and runs this`}
              >
                <Play size={12} weight="thin" /> {busy === `run:${rune.id}` ? 'Starting' : 'Run'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {suggestions.map((suggestion) => (
        <div key={suggestion.key} className="split-offer rune-offer">
          <p>
            <Lightbulb size={12} weight="thin" aria-hidden="true" /> You have started {suggestion.count} sessions here with “
            {suggestion.prompt}”. Save it as a task?
          </p>
          <div className="split-choices">
            <button type="button" className="setting-button is-primary" disabled={busy !== null} onClick={() => void save(suggestion.prompt)}>
              Save
            </button>
            <button
              type="button"
              className="setting-button"
              disabled={busy !== null}
              onClick={() => void act(`decline:${suggestion.key}`, () => window.grove!.declineRune(stone.id, suggestion.key))}
            >
              No
            </button>
          </div>
        </div>
      ))}

      {canWrite && !compact ? (
        adding ? (
          <div className="carved-note is-editing">
            <label className="grow-field">
              <span>A task you repeat here</span>
              <textarea
                value={draft}
                rows={2}
                autoFocus
                maxLength={2000}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={onKey}
                placeholder="Run the tests and fix what fails"
              />
            </label>
            <div className="carved-actions">
              <button type="button" className="setting-button is-primary" disabled={!draft.trim() || busy !== null} onClick={() => void save(draft)}>
                Save
              </button>
              <button type="button" className="setting-button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="panel-link" onClick={() => setAdding(true)}>
            <Plus size={13} weight="thin" aria-hidden="true" />
            Save a task you repeat here
          </button>
        )
      ) : null}
      {error ? <p className="panel-error">{error}</p> : null}
    </section>
  )
}
