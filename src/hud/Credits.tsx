/** Read the same human credits shipped in the app, without granting filesystem access. */
import { useState } from 'react'
import credits from '../../CREDITS.md?raw'

// This document uses headings, paragraphs and lists. Render those as ordinary React text,
// never HTML; keep source URLs selectable alongside their labels.
function readable(text: string): string {
  return text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/<((?:https?:\/\/)[^>]+)>/g, '$1').replace(/\n[ \t]*/g, ' ')
}

function Acknowledgements() {
  return credits.trim().split(/\n\s*\n/).map((block, index) => {
    if (block === '# Credits') return null
    if (/^---+$/.test(block)) return <hr key={index} />
    if (block.startsWith('### ')) return <h4 key={index}>{readable(block.slice(4))}</h4>
    if (block.startsWith('## ')) return <h3 key={index}>{readable(block.slice(3))}</h3>
    if (block.startsWith('- ')) return (
      <ul key={index}>{block.split(/\n(?=- )/).map((item, itemIndex) => <li key={itemIndex}>{readable(item.slice(2))}</li>)}</ul>
    )
    return <p key={index}>{readable(block)}</p>
  })
}

export function CreditsReader() {
  const [view, setView] = useState<'credits' | 'licences'>('credits')
  const [notices, setNotices] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const showLicences = async () => {
    setView('licences')
    if (notices !== null || loading) return
    setLoading(true)
    setError(null)
    try {
      // Relative to the built page: works both in the packaged file:// app and web preview.
      // This reads only one fixed bundled document, under the existing self-only page policy.
      const response = await fetch(new URL('attribution/THIRD_PARTY_NOTICES.txt', document.baseURI))
      if (!response.ok) throw new Error('Notices unavailable')
      const text = await response.text()
      if (!text.trim() || !text.includes('Third-party notices for')) throw new Error('Invalid notices')
      setNotices(text)
    } catch {
      setError('The licence notices could not be loaded. In the Mac app, you can also open them from Agentic Grove → Third-party licences. When running from source, build and preview the app first.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <details className="credits-reader">
      <summary>Read credits and licences</summary>
      <div className="setting-actions" role="group" aria-label="Credits documents">
        <button type="button" className={`setting-button${view === 'credits' ? ' is-primary' : ''}`} aria-pressed={view === 'credits'} onClick={() => setView('credits')}>Acknowledgements</button>
        <button type="button" className={`setting-button${view === 'licences' ? ' is-primary' : ''}`} aria-pressed={view === 'licences'} onClick={() => { void showLicences() }}>Licence notices</button>
      </div>
      <div key={view} className="credits-scroll" role="region" aria-label={view === 'credits' ? 'Credits and acknowledgements' : 'Third-party licence notices'} tabIndex={0}>
        {view === 'credits' ? <Acknowledgements /> : (
          loading ? <p role="status">Loading licence notices…</p> : error ? <p role="status">{error}</p> : <pre className="credits-notices">{notices}</pre>
        )}
      </div>
    </details>
  )
}
