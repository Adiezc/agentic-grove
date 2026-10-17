/**
 * PM's model choice for one job, as a small chip: "Opus · high". Hover for PM's reason; click to
 * change the model or the effort, one click each.
 *
 * PM proposes and you decide (17 October 2026), so this is where the deciding happens. It shows
 * whatever it is given (normally `pickModel` from `core/model-policy.ts`) and reports your change
 * through `onChange`; it saves nothing itself, so the caller decides whether a change is for this
 * job only. The chip turns amber when PM wants your OK first, the Grove's one colour for "needs you".
 *
 * Self-contained, to drop into the chat panel:
 *
 *   <ModelChip pick={pick} onChange={(model, effort) => setPick({ ...pick, model, effort })} />
 */
import { useEffect, useRef, useState } from 'react'
import { effortLabel, effortsFor, modelLabel, type ModelTool } from '../../core/models.ts'
import { ModelPicker } from './ModelPicker'

export interface ChipPick {
  tool: ModelTool
  model: string
  effort: string
  reason?: string
  needsOk?: boolean
}

export function ModelChip({
  pick,
  onChange,
  disabled = false,
}: {
  pick: ChipPick
  onChange: (model: string, effort: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Clicking anywhere else, or Escape, closes it: a choice is one click, and leaving is too.
  useEffect(() => {
    if (!open) return
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', away)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', away)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const name = pick.model ? modelLabel(pick.model) : 'Default'
  const text = pick.effort ? `${name} · ${effortLabel(pick.effort)}` : name

  return (
    <div className="model-chip-box" ref={box}>
      <button
        type="button"
        className={`model-chip${pick.needsOk ? ' needs-ok' : ''}${open ? ' is-open' : ''}`}
        title={pick.reason}
        aria-expanded={open}
        aria-label={`Model: ${text}. ${pick.reason ?? ''} Change`}
        disabled={disabled}
        onClick={() => setOpen((was) => !was)}
      >
        {text}
      </button>
      {open ? (
        <div className="model-chip-pop" role="dialog" aria-label="Model and effort">
          {pick.reason ? <p className="setting-fine model-chip-reason">{pick.reason}</p> : null}
          <ModelPicker tool={pick.tool} value={pick.model} onChange={(model) => onChange(model, pick.effort)} />
          <div className="model-picker">
            <span className="model-label">Effort</span>
            <div className="model-chips" role="radiogroup" aria-label="Effort">
              {['', ...effortsFor(pick.tool)].map((effort) => (
                <button
                  key={effort || 'default'}
                  type="button"
                  role="radio"
                  aria-checked={pick.effort === effort}
                  className={`grow-kind${pick.effort === effort ? ' is-on' : ''}`}
                  title={effort ? undefined : 'Whatever you chose in the tool itself'}
                  onClick={() => onChange(pick.model, effort)}
                >
                  {effort ? effortLabel(effort) : 'Default'}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
