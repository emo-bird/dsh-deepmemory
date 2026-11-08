/**
 * Tier 3: optional embedding rerank.
 *
 * The dependency is deliberately *not* a package dependency. `@huggingface/
 * transformers` pulls onnxruntime-node, whose tarball is ~290 MB and which
 * would have to be installed into the profile — slowing every DSH start for a
 * feature most sessions never turn on. Instead the panel's install action puts
 * it in this bundle's own `vendor/` directory (git-ignored), and this module
 * loads it lazily and returns `undefined` when it is not there.
 *
 * The rule the caller must honour: absence is not an error. Tier 3 is a
 * rerank, and a rerank that cannot run leaves tiers 1 and 2 untouched.
 *
 * @module @emo-bird/dsh-deepmemory/embed
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Default model.
 *
 * `Xenova/*` is the ONNX conversion transformers.js actually serves; the
 * original `BAAI/*` repositories only carry PyTorch weights, so pointing at them
 * produces a 404 for `onnx/model_quantized.onnx`. ~24 MB, Chinese-first.
 */
export const DEFAULT_MODEL = 'Xenova/bge-small-zh-v1.5'

/**
 * Where model files are downloaded from.
 *
 * `huggingface.co` is frequently unreachable from mainland China, so an
 * override is checked before the library default. `DSH_DEEPMEMORY_HF_HOST` lets
 * a user point at `https://hf-mirror.com` without editing the bundle.
 */
export function remoteHostFor(options = {}) {
  const configured = options.remoteHost ?? process.env.DSH_DEEPMEMORY_HF_HOST
  return typeof configured === 'string' && configured.trim() !== '' ? configured.trim() : undefined
}

/** Where the optional dependency lands, relative to the bundle root. */
export function vendorDirectory(bundleRoot) {
  return join(bundleRoot, 'vendor')
}

/**
 * The file `@huggingface/transformers` wants imported on Node.
 *
 * Importing the package *directory* fails with ERR_UNSUPPORTED_DIR_IMPORT —
 * Node does not read `exports` for a file URL. The package ships an ESM build
 * behind the `node` + `import` conditions (`dist/transformers.node.mjs`), which
 * is the one to load; the fallbacks exist because a future version may move it.
 */
function nodeEntry(packageDir) {
  let pkg
  try {
    pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
  const exportsField = pkg.exports ?? {}
  const candidates = [
    exportsField?.node?.import?.default,
    exportsField?.node?.default,
    exportsField?.import?.default,
    exportsField?.default?.import?.default,
    typeof exportsField === 'string' ? exportsField : undefined,
    pkg.module,
    pkg.main,
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const file = join(packageDir, candidate)
    if (existsSync(file)) return file
  }
  return undefined
}

/**
 * Is the optional dependency present?
 *
 * Two shapes count as installed: a real `node_modules/@huggingface/transformers`
 * under `vendor/`, or any `.onnx` model already downloaded next to it.
 */
export function installState(bundleRoot) {
  const vendor = vendorDirectory(bundleRoot)
  const packageDir = join(vendor, 'node_modules', '@huggingface', 'transformers')
  // "Installed" means loadable, not merely present: an interrupted npm run can
  // leave the package directory without a readable entry.
  const transformers = nodeEntry(packageDir) !== undefined
  let models = []
  const modelDir = join(vendor, 'models')
  if (existsSync(modelDir)) {
    try {
      models = readdirSync(modelDir).filter((name) => name.endsWith('.onnx'))
    } catch {
      models = []
    }
  }
  return { vendor, transformers, models, installed: transformers }
}

/**
 * Build an embedder over `@huggingface/transformers`.
 *
 * Returns `undefined` rather than throwing when the dependency or the model is
 * missing: the caller treats that exactly like "semantic disabled".
 *
 * @param {{bundleRoot: string, model?: string, modelPath?: string, logger?: {warn?: (message: string) => void}}} options
 * @returns {Promise<{model: string, dim: number, embed: (texts: string[]) => Promise<Float32Array[]>} | undefined>}
 */
export async function createEmbedder(options) {
  const { bundleRoot, logger } = options
  const state = installState(bundleRoot)
  if (!state.installed) return undefined

  const packageDir = join(state.vendor, 'node_modules', '@huggingface', 'transformers')
  const entry = nodeEntry(packageDir)
  if (entry === undefined) {
    logger?.warn?.('deepmemory: the vendor dependency has no loadable entry; semantic rerank stays off')
    return undefined
  }
  let transformers
  try {
    transformers = await import(pathToFileURL(entry).href)
  } catch (error) {
    logger?.warn?.(`deepmemory: the vendor dependency exists but would not load (${String(error)})`)
    return undefined
  }

  const { pipeline, env } = transformers
  if (typeof pipeline !== 'function') {
    logger?.warn?.('deepmemory: @huggingface/transformers exports no pipeline(); semantic rerank stays off')
    return undefined
  }

  // Keep every artifact inside vendor/, never in the OS cache or the cwd.
  env.cacheDir = join(state.vendor, 'models')
  env.allowRemoteModels = true
  const remoteHost = remoteHostFor(options)
  if (remoteHost !== undefined) env.remoteHost = remoteHost

  const model = options.model ?? DEFAULT_MODEL
  let extractor
  try {
    extractor = await pipeline('feature-extraction', options.modelPath ?? model, { dtype: 'q8' })
  } catch (error) {
    logger?.warn?.(
      `deepmemory: could not load ${model} (${String(error)}); 语义第三档保持关闭。` +
        ' 如果模型下载不了，把 ONNX 目录放进 vendor/models 并在面板里把模型路径指过去即可。',
    )
    return undefined
  }

  /** @type {number|undefined} */
  let dim

  return {
    model,
    get dim() {
      return dim ?? 0
    },
    async embed(texts) {
      const output = await extractor(texts, { pooling: 'mean', normalize: true })
      const flat = output.tolist()
      const rows = Array.isArray(flat[0]) ? flat : [flat]
      const vectors = rows.map((row) => Float32Array.from(row))
      if (dim === undefined && vectors.length > 0) dim = vectors[0].length
      return vectors
    },
  }
}
