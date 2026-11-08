#!/usr/bin/env node
/**
 * Install the optional tier-3 dependency into this bundle's own `vendor/`.
 *
 * The panel has the same action behind a button; this script exists for a
 * headless install and for CI. Both paths end up in `vendor/`, never in the
 * profile, so a failed run is one directory the user can delete.
 *
 *   node scripts/install-embed.mjs
 */

import { installDependency, dependencyStatus } from '../lib/install.js'
import { fileURLToPath } from 'node:url'

const bundleRoot = fileURLToPath(new URL('..', import.meta.url))

const before = dependencyStatus(bundleRoot)
if (before.installed) {
  console.log(`already installed: ${before.name}`)
  process.exit(0)
}

console.log(`installing ${before.name} into ${before.vendor} …`)
try {
  const result = await installDependency({ bundleRoot, logger: { info: (line) => console.log(line) } })
  console.log(result.installed ? 'done. Turn the switch on in 深度记忆 → 设置.' : 'npm finished but the package is still missing.')
  if (result.log !== undefined) console.log(result.log)
  process.exit(result.installed ? 0 : 1)
} catch (error) {
  console.error(String(error))
  process.exit(1)
}
