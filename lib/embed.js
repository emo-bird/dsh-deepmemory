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

import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { dirname, join } from 'node:path'
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
/**
 * Embedding models worth offering in the panel. `Xenova/*` are the ONNX
 * conversions transformers.js actually ships; pointing at `BAAI/*` fails,
 * because those repos only hold PyTorch weights.
 */
export const RECOMMENDED_MODELS = Object.freeze([
  {
    id: 'Xenova/bge-small-zh-v1.5',
    label: 'bge-small-zh',
    size: '约 24 MB',
    dim: 512,
    note: '中文首选，小、快，够用',
    recommended: true,
  },
  {
    id: 'Xenova/bge-base-zh-v1.5',
    label: 'bge-base-zh',
    size: '约 100 MB',
    dim: 768,
    note: '中文，召回更准，慢一点',
    recommended: false,
  },
  {
    id: 'Xenova/multilingual-e5-small',
    label: 'multilingual-e5-small',
    size: '约 120 MB',
    dim: 384,
    note: '中英混着聊的时候更稳',
    recommended: false,
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    label: 'all-MiniLM-L6-v2',
    size: '约 23 MB',
    dim: 384,
    note: '英文最省，中文别用',
    recommended: false,
  },
])

export function modelDirectory(bundleRoot) {
  return join(vendorDirectory(bundleRoot), 'models')
}

/** Directory names are lossy (`a/b` cannot be a path segment twice), so match loosely. */
function modelTokens(model) {
  const text = String(model)
  return [text, text.replace(/\//g, '_'), text.replace(/\//g, '--'), text.split('/').pop() ?? text].filter(
    (token, index, list) => token !== '' && list.indexOf(token) === index,
  )
}

/** A model counts as present when its cache directory survives on disk. */
export function installedModels(bundleRoot) {
  const dir = modelDirectory(bundleRoot)
  if (existsSync(dir) === false) return []
  // A model counts as installed only when its ONNX weights are on disk: an
  // interrupted download leaves config.json behind, and calling that installed
  // would light up a tier that fails on the first query.
  const weights = []
  const walk = (base, depth) => {
    if (depth > 6) return
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      const full = join(base, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.name.endsWith('.onnx')) weights.push(full)
    }
  }
  walk(dir, 1)
  return RECOMMENDED_MODELS.filter((model) =>
    weights.some((file) => modelTokens(model.id).some((token) => file.includes(token))),
  ).map((model) => model.id)
}

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

/**
 * Download one model into `vendor/models` and throw it away. The panel needs a
 * install button per model, and a model is "installed" exactly when its cache
 * directory exists; loading it once is the only honest way to produce that.
 */
/**
 * Files a transformers.js model needs on disk.
 *
 * `dtype: 'q8'` reads `onnx/model_quantized.onnx`; the JSON files carry the
 * tokenizer and dimensions. Missing optional files are tolerated, a missing
 * ONNX file is not.
 */
const MODEL_FILES = [
  { path: 'config.json', optional: false },
  { path: 'tokenizer.json', optional: false },
  { path: 'tokenizer_config.json', optional: true },
  { path: 'special_tokens_map.json', optional: true },
  { path: 'onnx/model_quantized.onnx', optional: false },
]

const downloadOnce = (url, target, options) =>
  new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest
    // A slow link usually means an interrupted transfer, so every attempt
    // resumes from whatever is already on disk instead of starting over.
    let existing = 0
    try {
      existing = existsSync(target) ? statSync(target).size : 0
    } catch {
      existing = 0
    }
    const req = send(
      url,
      {
        method: 'GET',
        // The host runtime rejects the chain these CDNs present, so a download
        // the user asked for explicitly is the one place verification is
        // relaxed; nothing else in the plugin talks to the network.
        rejectUnauthorized: false,
        headers: {
          'user-agent': 'dsh-deepmemory',
          ...(existing > 0 ? { range: `bytes=${existing}-` } : {}),
        },
      },
      (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume()
          const next = new URL(response.headers.location, url)
          downloadOnce(next, target, options).then(resolve, reject)
          return
        }
        // 416 means the byte we asked from is at or past the end: the file on
        // disk is already whole, which is a success for a resume.
        if (response.statusCode === 416 && existing > 0) {
          response.resume()
          resolve({ bytes: existing, skipped: true })
          return
        }
        const resuming = response.statusCode === 206 && existing > 0
        if (response.statusCode !== 200 && !resuming) {
          response.resume()
          reject(new Error(`${target}: HTTP ${response.statusCode}`))
          return
        }
        const length = Number(response.headers['content-length'] ?? 0)
        const total = length > 0 ? length + (resuming ? existing : 0) : 0
        let written = resuming ? existing : 0
        mkdirSync(dirname(target), { recursive: true })
        const sink = createWriteStream(target, { flags: resuming ? 'a' : 'w' })
        response.on('data', (chunk) => {
          written += chunk.length
          options.onProgress?.(written, total)
        })
        response.pipe(sink)
        sink.on('finish', () => resolve({ bytes: written }))
        sink.on('error', reject)
        response.on('error', reject)
      }
    )
    req.on('error', reject)
    req.end()
  })

/**
 * Fetch one model into `vendor/models`, reporting progress as it goes.
 *
 * @param {{bundleRoot: string, model: string, remoteHost?: string,
 *   logger?: {warn: Function, info: Function},
 *   onProgress?: (bytes: number, total: number) => void}} options
 */
export async function downloadModel(options) {
  const { bundleRoot, model, logger } = options
  const host = remoteHostFor(options) ?? 'https://hf-mirror.com'
  const root = modelDirectory(bundleRoot)
  // modelTokens() lists every spelling removeModel must clean up; the download
  // writes the one transformers.js itself looks for: cacheDir/<org>/<name>/.
  const folder = join(root, ...model.split('/').filter((part) => part !== ''))
  let bytes = 0
  let total = 0
  for (const file of MODEL_FILES) {
    const url = new URL(`${host.replace(/\/+$/, '')}/${model}/resolve/main/${file.path}`)
    const target = join(folder, ...file.path.split('/'))
    try {
      logger?.info?.(`deepmemory: downloading ${file.path}`)
      const result = await downloadOnce(url, target, {
        onProgress: (done, size) => {
          bytes = done
          if (size > 0) total = size
          options.onProgress?.(done, size)
        },
      })
      logger?.info?.(`deepmemory: ${file.path} (${result.bytes} bytes)`)
    } catch (error) {
      if (file.optional) {
        logger?.warn?.(`deepmemory: optional ${file.path} skipped: ${String(error)}`)
        continue
      }
      throw error
    }
  }
  return { model, directory: folder, bytes, total }
}

export async function prefetchModel(options) {
  const { bundleRoot, model, logger } = options
  const state = installState(bundleRoot)
  if (!state.installed) throw new Error('依赖未安装：先点「安装依赖」')
  const entry = nodeEntry(join(state.vendor, 'node_modules', '@huggingface', 'transformers'))
  if (entry === undefined) throw new Error('依赖目录存在但加载不了：先点「重新安装依赖」')
  // Fetch the files ourselves first: transformers' own fetch cannot be told to
  // accept this machine's certificate chain, and a failed download there is
  // indistinguishable from a missing model.
  await downloadModel(options)
  const transformers = await import(pathToFileURL(entry).href)
  const { pipeline, env } = transformers
  env.cacheDir = modelDirectory(bundleRoot)
  env.allowRemoteModels = false
  env.allowLocalModels = true
  const extractor = await pipeline('feature-extraction', model, { dtype: 'q8' })
  // One forward pass, so a half-downloaded file surfaces here instead of on the
  // first real query.
  await extractor(['测试'], { pooling: 'mean', normalize: true })
  logger?.info?.(`deepmemory: model ${model} is ready in ${env.cacheDir}`)
  return { model, directory: env.cacheDir }
}

/**
 * Delete the cache directory that belongs to `model`.
 *
 * Downloads land at models/<org>/<name>/..., so that exact folder is the thing
 * to remove; the token scan stays for flat layouts written by older builds.
 * Dropping the now-empty org directory keeps `models/` from filling up with
 * Xenova/ and nothing else, which is what "why are there so many folders"
 * looked like.
 */
export function removeModel(bundleRoot, model) {
  const dir = modelDirectory(bundleRoot)
  if (existsSync(dir) === false) return { removed: 0 }
  let removed = 0
  const nested = join(dir, ...model.split('/').filter((part) => part !== ''))
  if (existsSync(nested)) {
    rmSync(nested, { recursive: true, force: true })
    removed += 1
    const org = dirname(nested)
    try {
      if (org !== dir && readdirSync(org).length === 0) rmSync(org, { recursive: true, force: true })
    } catch {
      // A directory that is not ours to remove is fine to leave behind.
    }
  }
  const tokens = modelTokens(model)
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    if (!tokens.some((token) => entry.name.includes(token))) continue
    rmSync(join(dir, entry.name), { recursive: true, force: true })
    removed += 1
  }
  return { removed }
}