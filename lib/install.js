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
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { installState, installedModels, vendorDirectory } from './embed.js'

/** What the panel shows before it is installed. */
/** Fallback registry for the one retry. */
const MIRROR_REGISTRY = 'https://registry.npmmirror.com'

export const DEPENDENCY_NAME = '@huggingface/transformers'

/**
 * How much the install is expected to write.
 *
 * onnxruntime-node alone unpacks to ~293 MB and the transformers package adds a
 * few more, so ~320 MB is the honest order of magnitude. It is a denominator
 * for the progress bar, not a promise: npm writes unpacked files, and the final
 * number is measured rather than predicted.
 */
// Measured on a full install: ~575 MB, because onnxruntime-node ships the native
// runtime for every platform, not just this one. The number only drives the
// progress bar, so being slightly high is better than reaching 100% early.
const EXPECTED_BYTES = 600 * 1024 * 1024

/** One install at a time for the whole process. */
let inFlight = undefined

/**
 * Live install state, polled by the panel while the POST is still running.
 * `bytes` is measured from the directory on disk, so it only ever grows - the
 * bar never goes backwards even when npm unpacks a tarball in one go.
 */
const PROGRESS = {
  phase: 'idle',
  bytes: 0,
  totalBytes: EXPECTED_BYTES,
  startedAt: 0,
  finishedAt: 0,
  error: '',
}

export function installProgress() {
  return { ...PROGRESS }
}

/** Bytes currently on disk under `dir`, ignoring links and unreadable entries. */
function directoryBytes(dir) {
  let total = 0
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    try {
      if (entry.isDirectory()) total += directoryBytes(path)
      else if (entry.isFile()) total += statSync(path).size
    } catch {
      // A file that vanished mid-walk simply does not count.
    }
  }
  return total
}

/**
 * Drop the native binaries for platforms this machine will never run.
 *
 * onnxruntime-node ships every platform in one tarball, so a Windows install
 * carries ~400 MB of macOS and Linux libraries it cannot load. Deleting them
 * after the install keeps vendor/ roughly a quarter of its download size.
 */
function pruneOtherPlatforms(vendor, logger) {
  const bin = join(vendor, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6')
  let entries
  try {
    entries = readdirSync(bin, { withFileTypes: true })
  } catch {
    return
  }
  const wanted = process.platform
  let freed = 0
  for (const entry of entries) {
    if (entry.isDirectory() === false) continue
    // The layout is napi-v6/<platform>/<arch>/..., so the platform directory
    // is the whole unit to keep or drop.
    const name = entry.name
    if (name !== wanted) {
      const path = join(bin, name)
      try {
        freed += directoryBytes(path)
        rmSync(path, { recursive: true, force: true })
      } catch (error) {
        logger?.warn?.(`deepmemory: could not prune ${name}: ${String(error)}`)
      }
    }
  }
  if (freed > 0) logger?.info?.(`deepmemory: pruned ${Math.round(freed / (1024 * 1024))} MB of other-platform binaries`)
}

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
    PROGRESS.phase = 'installing'
    PROGRESS.error = ''
    PROGRESS.startedAt = Date.now()
    PROGRESS.finishedAt = 0
    PROGRESS.totalBytes = EXPECTED_BYTES
    PROGRESS.bytes = directoryBytes(vendor)
    // npm gives no byte-level progress, so the size on disk is the signal. One
    // walk per second is cheap next to the download it is measuring.
    const timer = setInterval(() => {
      PROGRESS.bytes = Math.max(PROGRESS.bytes, directoryBytes(vendor))
    }, 1000)
    if (typeof timer.unref === 'function') timer.unref()
    logger?.info?.(`deepmemory: installing ${DEPENDENCY_NAME} into ${vendor}`)
    // The cache goes inside vendor/ too. The default cache under the OS temp
    // directory is outside the bundle and, on a confined host, can be
    // unwritable — an install that dies on its cache is worse than a slow one.
    const args = [
      'install',
      '--no-audit',
      '--no-fund',
      '--loglevel=error',
      '--cache',
      join(vendor, '.npm-cache'),
      DEPENDENCY_NAME,
    ]
    // Under pnpm/npm the running CLI's own JS entry is the one guaranteed to
    // exist; `npm` on PATH is a fallback for a bare node process.
    const npmCli = process.env.npm_execpath
    const invoke = (extra) => {
      const full = [...args, ...extra]
      return npmCli === undefined
        ? run('npm', full, { cwd: vendor })
        : run(process.execPath, [npmCli, ...full], { cwd: vendor })
    }
    try {
      // The default registry can be slow or unreachable; one retry against the
      // mainland mirror costs a second when it is not needed and saves minutes
      // when it is. An explicit DSH_DEEPMEMORY_NPM_REGISTRY always wins.
      const configured = process.env.DSH_DEEPMEMORY_NPM_REGISTRY
      const registry = typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : undefined
      let log
      if (registry === undefined) {
        try {
          log = await invoke([])
        } catch (first) {
          logger?.warn?.(`deepmemory: npm install failed, retrying via the mirror (${String(first?.message ?? first).slice(0, 200)})`)
          log = await invoke(['--registry', MIRROR_REGISTRY])
        }
      } else {
        log = await invoke(['--registry', registry])
      }
      pruneOtherPlatforms(vendor, logger)
      PROGRESS.bytes = directoryBytes(vendor)
      PROGRESS.phase = 'done'
      PROGRESS.finishedAt = Date.now()
      return { installed: installState(bundleRoot).installed, vendor, log: log.slice(-4000) }
    } catch (error) {
      PROGRESS.phase = 'error'
      PROGRESS.error = String(error?.message ?? error).slice(-600)
      PROGRESS.finishedAt = Date.now()
      throw error
    } finally {
      clearInterval(timer)
    }
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
    models: installedModels(bundleRoot),
    progress: installProgress(),
  }
}
