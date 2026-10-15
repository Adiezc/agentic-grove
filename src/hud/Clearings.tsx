/**
 * The controls for clearings: putting a stone in one from its panel, and the clearings list,
 * renaming, undoing and suggestions in the Projects panel.
 *
 * Nothing here decides anything. Every change goes to the node side, which writes `grove.json`
 * and moves the stones (`core/state/grove.ts`); the scene follows on the next snapshot.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Check, CirclesThree, PencilSimple, X } from '@phosphor-icons/react'
import { MAX_CLEARING_NAME } from '../../core/state/clearings.ts'
import type { ClearingSuggestion } from '../../core/state/clearings.ts'
import type { StoneSpec } from '../scene/Runestone'
import { DEMO } from '../demo'

type Answer = { ok: boolean; error?: string } | undefined

/** The clearings in the grove, by name, with their stones' names, in the order they stand. */
export function clearingNames(stones: StoneSpec[]): { name: string; members: StoneSpec[] }[] {
  const groups = new Map<string, StoneSpec[]>()
  for (const stone of stones) {
    if (!stone.clearing) continue
    groups.set(stone.clearing, [...(groups.get(stone.clearing) ?? []), stone])
  }
  return [...groups.entries()].map(([name, members]) => ({ name, members }))
}

/** A small name box: Enter or the tick saves, Escape or the cross puts it away. */
function NameField({ initial = '', placeholder, onSave, onCancel }: { initial?: string; placeholder: string; onSave: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) onSave(name.trim())
  }
  return (
    <form className="clearing-field" onSubmit={submit}>
      <input
        autoFocus
        value={name}
        maxLength={MAX_CLEARING_NAME}
        placeholder={placeholder}
        aria-label="Clearing name"
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
          }
        }}
      />
      <button type="submit" className="setting-button" disabled={!name.trim()} aria-label="Save">
        <Check size={12} weight="thin" />
      </button>
      <button type="button" className="setting-button" onClick={onCancel} aria-label="Cancel">
        <X size={12} weight="thin" />
      </button>
    </form>
  )
}

/**
 * In a stone's panel: which clearing it stands in, or a way to put it in one. Only for a project's
 * own stone; a sub-stone or a twin stands off its stone, wherever that stone is.
 */
export function StoneClearing({ stone, stones }: { stone: StoneSpec; stones: StoneSpec[] }) {
  const [choosing, setChoosing] = useState(false)
  const [naming, setNaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setChoosing(false)
    setNaming(false)
    setError(null)
  }, [stone.id])
  const canWrite = Boolean(window.grove) && !DEMO
  if (stone.parent) return null

  const act = async (run: () => Promise<Answer>) => {
    setError(null)
    const result = await run()
    if (result && !result.ok) setError(result.error ?? 'That did not work')
    else {
      setChoosing(false)
      setNaming(false)
    }
  }
  const others = clearingNames(stones).filter((clearing) => clearing.name !== stone.clearing)

  return (
    <div className="stone-clearing">
      {stone.clearing ? (
        <p className="clearing-line">
          <CirclesThree size={13} weight="thin" aria-hidden="true" />
          <span>
            In the clearing <strong>{stone.clearing}</strong>
          </span>
          {canWrite ? (
            <button type="button" className="clearing-quiet" onClick={() => void act(() => window.grove!.leaveClearing(stone.id))}>
              Leave
            </button>
          ) : null}
        </p>
      ) : canWrite && !choosing ? (
        <button type="button" className="panel-link" onClick={() => setChoosing(true)}>
          <CirclesThree size={13} weight="thin" aria-hidden="true" />
          Put in a clearing
        </button>
      ) : null}
      {choosing ? (
        <div className="split-offer">
          <p>Stones in a clearing stand together inside a ring, joined by mycelium.</p>
          {naming || !others.length ? (
            <NameField
              placeholder="Name a new clearing, like Work"
              onSave={(name) => void act(() => window.grove!.joinClearing(stone.id, name))}
              onCancel={() => (others.length ? setNaming(false) : setChoosing(false))}
            />
          ) : (
            <div className="split-choices">
              {others.map((clearing) => (
                <button key={clearing.name} type="button" className="setting-button" onClick={() => void act(() => window.grove!.joinClearing(stone.id, clearing.name))}>
                  {clearing.name}
                </button>
              ))}
              <button type="button" className="setting-button" onClick={() => setNaming(true)}>
                New clearing…
              </button>
              <button type="button" className="setting-button" onClick={() => setChoosing(false)} aria-label="Cancel">
                <X size={12} weight="thin" />
              </button>
            </div>
          )}
        </div>
      ) : null}
      {error ? <p className="panel-error">{error}</p> : null}
    </div>
  )
}

/**
 * In the Projects panel: the clearings, each renamable and undoable, and any the Grove suggests.
 * Undoing asks twice, like removing a stone; the stones and their work are untouched either way.
 */
export function ClearingsSection({ stones, suggestions }: { stones: StoneSpec[]; suggestions: ClearingSuggestion[] }) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const [undoing, setUndoing] = useState<string | null>(null)
  const [accepting, setAccepting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canWrite = Boolean(window.grove) && !DEMO
  const clearings = clearingNames(stones)
  const nameOf = (id: string) => stones.find((stone) => stone.id === id)?.name ?? id
  const offers = suggestions.filter((offer) => offer.stones.every((id) => stones.some((stone) => stone.id === id)))
  if (!clearings.length && !offers.length) return null

  const act = async (run: () => Promise<Answer>) => {
    setError(null)
    const result = await run()
    if (result && !result.ok) setError(result.error ?? 'That did not work')
    else {
      setRenaming(null)
      setUndoing(null)
      setAccepting(null)
    }
  }
  const list = (ids: string[]) => {
    const names = ids.map(nameOf)
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : (names[0] ?? '')
  }

  return (
    <section className="clearings-section" aria-label="Clearings">
      {clearings.length ? (
        <ul className="clearing-list">
          {clearings.map((clearing) => (
            <li key={clearing.name}>
              {renaming === clearing.name ? (
                <NameField
                  initial={clearing.name}
                  placeholder="Clearing name"
                  onSave={(name) => void act(() => window.grove!.renameClearing(clearing.name, name))}
                  onCancel={() => setRenaming(null)}
                />
              ) : (
                <div className="clearing-row">
                  <CirclesThree size={14} weight="thin" aria-hidden="true" />
                  <span className="rail-row-text">
                    {clearing.name}
                    <small>{list(clearing.members.map((stone) => stone.id))}</small>
                  </span>
                  {canWrite ? (
                    <>
                      <button type="button" className="clearing-icon" onClick={() => setRenaming(clearing.name)} aria-label={`Rename ${clearing.name}`} title="Rename">
                        <PencilSimple size={13} weight="thin" />
                      </button>
                      <button
                        type="button"
                        className={`clearing-icon${undoing === clearing.name ? ' is-confirming' : ''}`}
                        onClick={() => (undoing === clearing.name ? void act(() => window.grove!.removeClearing(clearing.name)) : setUndoing(clearing.name))}
                        onBlur={() => setUndoing(null)}
                        aria-label={undoing === clearing.name ? `Undo ${clearing.name}: press again to confirm` : `Undo ${clearing.name}`}
                        title={undoing === clearing.name ? 'Press again to undo the clearing' : 'Undo the clearing'}
                      >
                        <X size={13} weight="thin" />
                      </button>
                    </>
                  ) : null}
                </div>
              )}
              {undoing === clearing.name ? <p className="setting-fine">Press again to undo it. The stones stay, each back in a circle of its own.</p> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {canWrite
        ? offers.map((offer) => {
            const key = offer.stones.join('\n')
            return (
              <div key={key} className="split-offer">
                <p>You often work on {list(offer.stones)} together. Give them a clearing?</p>
                {accepting === key ? (
                  <NameField
                    placeholder="Name it, like Work"
                    onSave={(name) => void act(() => window.grove!.makeClearing(offer.stones, name))}
                    onCancel={() => setAccepting(null)}
                  />
                ) : (
                  <div className="split-choices">
                    <button type="button" className="setting-button" onClick={() => setAccepting(key)}>
                      <CirclesThree size={12} weight="thin" /> Make a clearing
                    </button>
                    <button type="button" className="setting-button" onClick={() => void act(() => window.grove!.declineClearing(offer.stones))}>
                      No thanks
                    </button>
                  </div>
                )}
              </div>
            )
          })
        : null}
      {error ? <p className="panel-error">{error}</p> : null}
    </section>
  )
}
