/**
 * Installer for the optional tier-3 dependency.
 *
 * Runs `npm install` into `vendor/` inside this bundle, never into the profile.
 * Two reasons: the profile is shared by every plugin and a 290 MB dependency
 * there would slow each Host start, and a failed install must not be able to
 * leave the profile half-broken. Everything a failed run leaves behind is a
 * directory the user can delete.
 *
 * The install is serialised through one in-flight promise, because two panel
 * clicks must not start two npm processes against the same directory.
 *
 * @module @emo-bird/dsh-deepmemory/install
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installState, vendorDirectory } from './embed.js'

/** What the panel shows before it is installed. */
export const DEPENDENCY_NAME = '@huggingface/transformers'

/** One install at a time for the whole process. */
let inFlight = undefined

function run(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      // npm is a .cmd shim on Windows, which Node cannot spawn without a shell.
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const cap = (chunk) => {
      out += String(chunk)
      if (out.length > 20000) out = out.slice(-20000)
    }
    child.stdout?.on('data', cap)
    child.stderr?.on('data', cap)
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) resolve(out)
      else reject(new Error(`npm exited with ${code}\n${out}`))
    })
  })
}

/**
 * Install the optional dependency into `vendor/`.
 *
 * @param {{bundleRoot: string, logger?: {info?: Function, warn?: Function}}} options
 * @returns {Promise<{installed: boolean, vendor: string, log?: string}>}
 */
export async function installDependency(options) {
  const { bundleRoot, logger } = options
  const vendor = vendorDirectory(bundleRoot)

  if (inFlight !== undefined) return inFlight

  inFlight = (async () => {
    mkdirSync(vendor, { recursive: true })
    // A package.json of our own keeps npm from walking up into the user's
    // project and treating that as the install root.
    writeFileSync(
      join(vendor, 'package.json'),
      `${JSON.stringify({ name: 'deepmemory-vendor', private: true, version: '0.0.0' }, null, 2)}\n`,
      'utf8',
    )
    logger?.info?.(`deepmemory: installing ${DEPENDENCY_NAME} into ${vendor}`)
    const args = ['install', '--no-audit', '--no-fund', '--loglevel=error', DEPENDENCY_NAME]
    // Under pnpm/npm the running CLI's own JS entry is the one guaranteed to
    // exist; `npm` on PATH is a fallback for a bare node process.
    const npmCli = process.env.npm_execpath
    const log =
      npmCli === undefined
        ? await run('npm', args, { cwd: vendor })
        : await run(process.execPath, [npmCli, ...args], { cwd: vendor })
    return { installed: installState(bundleRoot).installed, vendor, log: log.slice(-4000) }
  })()

  try {
    return await inFlight
  } finally {
    inFlight = undefined
  }
}

/** Everything the settings page needs to render the install block. */
export function dependencyStatus(bundleRoot) {
  const state = installState(bundleRoot)
  return {
    name: DEPENDENCY_NAME,
    installed: state.installed,
    vendor: state.vendor,
    models: state.models,
  }
}
