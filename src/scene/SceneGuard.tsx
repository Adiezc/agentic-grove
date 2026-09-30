/**
 * What happens when the 3D scene cannot draw: say so, keep everything else working, and offer a
 * way back.
 *
 * Two ways a scene fails. A component inside it throws (a model that did not load, a shader that
 * did not compile), which React reports to an error boundary; or the Mac takes the graphics
 * context away (a GPU reset, too many WebGL pages open), which only a `webglcontextlost` event
 * reports. Either used to leave a black window with the panels floating over nothing, and a black
 * grove looks exactly like a quiet one. The review (30 September 2026, item 6) asked for a visible
 * failure with a recovery action.
 *
 * The HUD sits outside this guard on purpose: stones can still be opened from Projects, agents
 * sent from the console, and settings changed, while the scene is down.
 */
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Draw again from scratch. The caller remounts the scene with a new key. */
  onRetry: () => void
  /** Switch to Performance graphics, the lightest mode, then draw again. */
  onLighter: () => void
  /** Set by the scene itself when the graphics context is lost, which no boundary can catch. */
  lost: boolean
}

interface State {
  error: string | null
}

export class SceneGuard extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown) {
    console.error('agentic-grove: the scene failed —', error)
  }

  private retry(then: () => void) {
    this.setState({ error: null })
    then()
  }

  render() {
    const { error } = this.state
    const { lost } = this.props
    if (!error && !lost) return this.props.children
    return (
      <div className="scene-failed" role="alert">
        <p className="scene-failed-title">The grove could not be drawn</p>
        <p className="scene-failed-line">
          {lost ? 'The Mac took the graphics away, which can happen after sleep or a GPU reset.' : error}
        </p>
        <p className="scene-failed-line">Everything else still works: projects, the console and settings.</p>
        <div className="scene-failed-actions">
          <button type="button" className="setting-button is-primary" onClick={() => this.retry(this.props.onRetry)}>
            Try again
          </button>
          <button type="button" className="setting-button" onClick={() => this.retry(this.props.onLighter)}>
            Use Performance graphics
          </button>
        </div>
      </div>
    )
  }
}
