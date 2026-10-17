/**
 * Settings for how PM picks models: when it asks, which models it may use, your own model and
 * effort for each kind of job, and where the allowance rules start.
 *
 * Mounted inside a Settings section. Every change is saved straight away through `saveSettings`,
 * which runs it past the same checks as a hand edit of `grove.json`. The rules themselves live in
 * `core/model-policy.ts` and `core/usage/limits.ts`; this only edits what they read.
 */
import { useState } from 'react'
import { CLAUDE_MODELS, effortLabel, effortsFor, type ModelChoice, type ModelTool } from '../../core/models.ts'
import { DEFAULT_TIER_CHOICES, JOB_TIERS, MODEL_MODES, type JobTier, type ModelMode, type TierChoice } from '../../core/model-policy.ts'
import { DEFAULT_THRESHOLDS, type UsageThresholds } from '../../core/usage/limits.ts'
import type { GroveSettings } from '../../core/state/schema.ts'
import { saveSettings } from '../store/settings'
import { useCodexModels } from './ModelPicker'

const MODE_NAME: Record<ModelMode, string> = { 'auto-ask-costly': 'Ask if costly', auto: 'Choose for me', 'always-ask': 'Always ask' }
const MODE_LINE: Record<ModelMode, string> = {
  'auto-ask-costly': 'PM picks, and checks with you before Fable or extra-high effort.',
  auto: 'PM picks without asking, unless your allowance is running low.',
  'always-ask': 'PM says what it would use and waits for your yes.',
}
const TIER_NAME: Record<JobTier, string> = { quick: 'Quick question', build: 'Building', plan: 'Planning' }
const TOOL_NAME: Record<ModelTool, string> = { 'claude-code': 'Claude Code', codex: 'Codex' }
const THRESHOLD_NAME: Record<keyof UsageThresholds, string> = {
  noOpusAbove: 'Ask before Opus above',
  haikuOnlyAbove: 'Haiku only above',
  weeklyWarnAbove: 'Warn about the week above',
}

function modelsOf(tool: ModelTool, codex: ModelChoice[]): ModelChoice[] {
  return tool === 'claude-code' ? CLAUDE_MODELS : codex
}

export function ModelSettings({ settings }: { settings: GroveSettings }) {
  const codex = useCodexModels()
  const [tool, setTool] = useState<ModelTool>('claude-code')
  const models = modelsOf(tool, codex)
  const approved = settings.approvedModels[tool]
  const tiers = settings.tierModels[tool]

  const toggleApproved = (value: string) => {
    // An empty list means every model; the first click narrows it to all but the one clicked off.
    const current = approved.length ? approved : models.map((each) => each.value)
    const next = current.includes(value) ? current.filter((each) => each !== value) : [...current, value]
    const all = models.every((each) => next.includes(each.value))
    void saveSettings({ approvedModels: { ...settings.approvedModels, [tool]: all ? [] : next } })
  }

  const setTier = (tier: JobTier, change: Partial<TierChoice>) => {
    const choice = { model: tiers[tier]?.model ?? '', effort: tiers[tier]?.effort ?? '', ...change }
    const next = { ...tiers }
    if (choice.model || choice.effort) next[tier] = choice
    else delete next[tier]
    void saveSettings({ tierModels: { ...settings.tierModels, [tool]: next } })
  }

  const setThreshold = (key: keyof UsageThresholds, text: string) => {
    const value = Number(text)
    if (!Number.isFinite(value) || value < 0 || value > 100) return
    void saveSettings({ usageThresholds: { ...settings.usageThresholds, [key]: value } })
  }

  return (
    <>
      <div className="segmented" role="radiogroup" aria-label="When PM asks">
        {MODEL_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={settings.modelMode === mode}
            className={`segment${settings.modelMode === mode ? ' is-on' : ''}`}
            onClick={() => void saveSettings({ modelMode: mode })}
          >
            {MODE_NAME[mode]}
          </button>
        ))}
      </div>
      <p className="setting-line">{MODE_LINE[settings.modelMode]}</p>

      <div className="segmented policy-tools" role="radiogroup" aria-label="Tool">
        {(['claude-code', 'codex'] as const).map((each) => (
          <button
            key={each}
            type="button"
            role="radio"
            aria-checked={tool === each}
            className={`segment${tool === each ? ' is-on' : ''}`}
            onClick={() => setTool(each)}
          >
            {TOOL_NAME[each]}
          </button>
        ))}
      </div>

      <div className="model-picker">
        <span className="model-label">Models PM may use</span>
        {models.length ? (
          <div className="model-chips" role="group" aria-label="Approved models">
            {models.map((each) => {
              const on = approved.length === 0 || approved.includes(each.value)
              return (
                <button key={each.value} type="button" aria-pressed={on} className={`grow-kind${on ? ' is-on' : ''}`} onClick={() => toggleApproved(each.value)}>
                  {each.label}
                </button>
              )
            })}
          </div>
        ) : (
          <p className="setting-fine">Codex has not listed its models on this Mac yet. PM keeps your Codex model.</p>
        )}
      </div>

      <div className="policy-tiers">
        {JOB_TIERS.map((tier) => {
          const base = DEFAULT_TIER_CHOICES[tool][tier]
          const yours = tiers[tier]
          const baseName = base.model ? (models.find((each) => each.value === base.model)?.label ?? base.model) : 'your default'
          return (
            <div key={tier} className="policy-tier">
              <span className="model-label">{TIER_NAME[tier]}</span>
              <select
                className="policy-select"
                aria-label={`${TIER_NAME[tier]} model`}
                value={yours?.model ?? ''}
                onChange={(event) => setTier(tier, { model: event.target.value })}
              >
                <option value="">PM: {baseName}</option>
                {models.map((each) => (
                  <option key={each.value} value={each.value}>
                    {each.label}
                  </option>
                ))}
              </select>
              <select
                className="policy-select"
                aria-label={`${TIER_NAME[tier]} effort`}
                value={yours?.effort ?? ''}
                onChange={(event) => setTier(tier, { effort: event.target.value })}
              >
                <option value="">PM: {effortLabel(base.effort)}</option>
                {effortsFor(tool).map((each) => (
                  <option key={each} value={each}>
                    {effortLabel(each)}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>

      <div className="policy-thresholds">
        {(Object.keys(DEFAULT_THRESHOLDS) as (keyof UsageThresholds)[]).map((key) => (
          <label key={key} className="policy-threshold">
            <span className="model-label">{THRESHOLD_NAME[key]}</span>
            <span className="policy-percent">
              <input
                className="model-other"
                type="number"
                min={0}
                max={100}
                step={5}
                defaultValue={settings.usageThresholds[key]}
                key={settings.usageThresholds[key]}
                onBlur={(event) => setThreshold(key, event.target.value)}
              />
              %
            </span>
          </label>
        ))}
      </div>
      <p className="setting-fine">Five-hour use for the first two, the week for the last. Unknown use never holds work back.</p>
    </>
  )
}
