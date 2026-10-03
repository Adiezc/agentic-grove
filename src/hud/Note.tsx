/**
 * A carved note in a panel: the one on this stone, this agent or the tree. See `core/state/notes.ts`.
 *
 * Three looks, all quiet:
 *
 *   showing   the first thing in the panel, under a small "You left this" line. Opening the panel
 *             is reading it, so the node side is told and forgets it; the words stay here, fading,
 *             until the panel closes, so nothing vanishes while you are reading it.
 *   waiting   dim, with "Shows when work next starts here", and a pencil to change it.
 *   none      a small link to carve one.
 *
 * No amber anywhere: a note is something you wrote, not something that needs you.
 */
import { useEffect, useState, type KeyboardEvent } from 'react'
import { NotePencil, PencilSimple } from '@phosphor-icons/react'
import { MAX_NOTE_CHARS, noteOn, type NotePlace, type NoteView } from '../../core/state/notes.ts'
import { useGrove } from '../store/grove'
import { DEMO } from '../demo'

const NO_NOTES: NoteView[] = []

/** How long a showing note is on screen before it counts as read. A glance in passing does not. */
const READ_AFTER_MS = 2500

const WAITING_LINE: Record<NotePlace, string> = {
  stone: 'Shows when work next starts on this project',
  agent: 'Shows when this agent is next sent somewhere',
  tree: 'Shows when work next starts anywhere',
}

const CARVE_LINK: Record<NotePlace, string> = {
  stone: 'Leave a note for next time',
  agent: 'Leave a note for its next job',
  tree: 'Leave a note on the tree',
}

export function CarvedNote({ on, id, open }: { on: NotePlace; id: string; open: boolean }) {
  const notes = useGrove((state) => state.snapshot?.notes ?? NO_NOTES)
  const note = noteOn(notes, on, id)
  const canWrite = Boolean(window.grove) && !DEMO
  const [held, setHeld] = useState<NoteView | null>(null)
  const [read, setRead] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Closing the panel, or moving to another place, lets a held note go. Declared first, so that on
  // opening it runs before the hold below rather than undoing it.
  useEffect(() => {
    setHeld(null)
    setRead(false)
    setEditing(false)
    setError(null)
  }, [open, on, id])
  // A note that shows while the panel is open is held here, so it stays on screen after the node
  // side has forgotten it.
  useEffect(() => {
    if (open && note?.state === 'showing') setHeld((current) => current ?? note)
  }, [open, note])
  useEffect(() => {
    if (!held || read || !window.grove) return
    const timer = setTimeout(() => {
      setRead(true)
      void window.grove?.readNote(held.on, held.id)
    }, READ_AFTER_MS)
    return () => clearTimeout(timer)
  }, [held, read])

  const save = async (text: string) => {
    const result = await window.grove?.carveNote(on, id, text)
    if (result && !result.ok) return setError(result.error ?? 'Could not carve it')
    setEditing(false)
    setError(null)
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void save(draft)
    }
    if (event.key === 'Escape') {
      event.stopPropagation()
      setEditing(false)
    }
  }

  if (held) {
    return (
      <section className={`carved-note is-showing${read ? ' is-read' : ''}`} aria-label="A note you left">
        <p className="carved-head">
          <NotePencil size={12} weight="thin" aria-hidden="true" /> You left this
        </p>
        <p className="carved-text">{held.text}</p>
      </section>
    )
  }

  if (editing) {
    return (
      <section className="carved-note is-editing">
        <label className="grow-field">
          <span>{on === 'tree' ? 'A note on the tree' : 'A note for next time'}</span>
          <textarea
            value={draft}
            maxLength={MAX_NOTE_CHARS}
            rows={3}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKey}
            placeholder="Where you left off, what to do first"
          />
        </label>
        <div className="carved-actions">
          <button type="button" className="setting-button is-primary" onClick={() => void save(draft)} disabled={!draft.trim()}>
            Carve
          </button>
          {note ? (
            <button type="button" className="setting-button" onClick={() => void save('')}>
              Remove
            </button>
          ) : null}
          <button type="button" className="setting-button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </div>
        {error ? <p className="panel-error">{error}</p> : null}
      </section>
    )
  }

  if (note?.state === 'waiting') {
    return (
      <section className="carved-note is-waiting" aria-label="A note waiting for next time">
        <p className="carved-head">
          <NotePencil size={12} weight="thin" aria-hidden="true" /> {WAITING_LINE[on]}
          {canWrite ? (
            <button
              type="button"
              className="carved-edit"
              onClick={() => {
                setDraft(note.text)
                setEditing(true)
              }}
              aria-label="Change the note"
              title="Change"
            >
              <PencilSimple size={12} weight="thin" />
            </button>
          ) : null}
        </p>
        <p className="carved-text">{note.text}</p>
      </section>
    )
  }

  if (!canWrite || !open) return null
  return (
    <button
      type="button"
      className="panel-link"
      onClick={() => {
        setDraft('')
        setEditing(true)
      }}
    >
      <NotePencil size={13} weight="thin" aria-hidden="true" />
      {CARVE_LINK[on]}
    </button>
  )
}
