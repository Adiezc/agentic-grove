/**
 * Photo mode's three controls, bottom centre: how much depth of field, save, and done.
 *
 * Everything else on screen is hidden while this is up, so the bar says in one line how to move
 * the view. It sits outside the main interface layer because that whole layer is switched off.
 */
import { Camera } from '@phosphor-icons/react'
import { usePhoto } from '../store/photo'

export function PhotoBar({ onDone }: { onDone: () => void }) {
  const depth = usePhoto((state) => state.depth)
  const saving = usePhoto((state) => state.saving)
  const error = usePhoto((state) => state.error)
  return (
    <div className="photo-bar" role="toolbar" aria-label="Photo mode">
      <p className="photo-hint" role="status">
        {error ? `Could not save the image: ${error}` : 'Drag to turn, scroll to zoom, right-drag to slide'}
      </p>
      <div className="photo-controls">
        <label className="photo-depth">
          <span>Depth</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={depth}
            aria-label="Depth of field"
            onChange={(event) => usePhoto.getState().setDepth(Number(event.target.value))}
          />
        </label>
        <button type="button" className="setting-button is-primary" disabled={saving} onClick={() => usePhoto.getState().save()}>
          <Camera size={14} weight="regular" aria-hidden="true" />
          {saving ? 'Saving…' : 'Save image'}
        </button>
        <button type="button" className="setting-button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  )
}
