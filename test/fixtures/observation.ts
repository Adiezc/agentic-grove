/** Set before importing observers: their paths and parsing caches belong to one fixture run. */
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export async function observationFixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'grove-provider-fixture-'))
  const grove = path.join(root, 'grove')
  const providers = path.join(root, 'providers')
  await Promise.all([fs.mkdir(grove), fs.mkdir(providers)])
  const previousGrove = process.env.AGENTIC_GROVE_HOME
  const previousProviders = process.env.AGENTIC_GROVE_PROVIDER_HOME
  process.env.AGENTIC_GROVE_HOME = grove
  process.env.AGENTIC_GROVE_PROVIDER_HOME = providers
  return {
    root, grove, providers,
    async dispose() {
      if (previousGrove === undefined) delete process.env.AGENTIC_GROVE_HOME
      else process.env.AGENTIC_GROVE_HOME = previousGrove
      if (previousProviders === undefined) delete process.env.AGENTIC_GROVE_PROVIDER_HOME
      else process.env.AGENTIC_GROVE_PROVIDER_HOME = previousProviders
      await fs.rm(root, { recursive: true, force: true })
    },
  }
}
