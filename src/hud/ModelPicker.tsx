/**
 * Choosing a model: Default, the tool's short names, or Other for an exact name.
 *
 * Used in the agent card (saved on the agent) and the grow form. Chips rather than a dropdown, so
 * every choice is visible at once and one click is the whole job. Default comes first and means
 * "whatever you picked in Claude Code or Codex"; see `core/models.ts` for why that is the default.
 */
import { useEffect, useState, type KeyboardEvent } from 'react'
import { choicesFor, isModelName, MAX_MODEL_CHARS, type ModelTool } from '../../core/models.ts'

export function ModelPicker({
  tool,
  value,
  onChange,
  disabled = false,
  label = 'Model',
}: {
  tool: ModelTool
  value: string
  onChange: (model: string) => void
  disabled?: boolean
  label?: string
}) {
  const choices = choicesFor(tool)
  const known = choices.some((choice) => choice.value === value.toLowerCase())
  const [otherOpen, setOtherOpen] = useState(!known)
  const [draft, setDraft] = useState(known ? '' : value)
  // A value that changes from outside (another agent shown in the same card) resets the field.
  useEffect(() => {
    setOtherOpen(!known)
    setDraft(known ? '' : value)
  }, [value, known])

  const commit = () => {
    const name = draft.trim()
    if (name && isModelName(name) && name !== value) onChange(name)
  }
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    }
  }
  const invalid = draft.trim() !== '' && !isModelName(draft.trim())

  return (
    <div className="model-picker">
      <span className="model-label">{label}</span>
      <div className="model-chips" role="radiogroup" aria-label={label}>
        {choices.map((choice) => {
          const on = !otherOpen && choice.value === value.toLowerCase()
          return (
            <button
              key={choice.value || 'default'}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              className={`grow-kind${on ? ' is-on' : ''}`}
              title={choice.value ? undefined : 'Whatever you chose in the tool itself'}
              onClick={() => {
                setOtherOpen(false)
                if (choice.value !== value) onChange(choice.value)
              }}
            >
              {choice.label}
            </button>
          )
        })}
        <button
          type="button"
          role="radio"
          aria-checked={otherOpen}
          disabled={disabled}
          className={`grow-kind${otherOpen ? ' is-on' : ''}`}
          onClick={() => setOtherOpen(true)}
        >
          Other
        </button>
      </div>
      {otherOpen ? (
        <input
          className={`model-other${invalid ? ' is-invalid' : ''}`}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={onKey}
          maxLength={MAX_MODEL_CHARS}
          placeholder={tool === 'claude-code' ? 'An exact name, like claude-opus-5-5' : 'An exact Codex model name'}
          aria-label="Exact model name"
          aria-invalid={invalid}
          spellCheck={false}
        />
      ) : null}
    </div>
  )
}
