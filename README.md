# dsh-deepmemory

深度记忆插件：跨会话的长期记忆 + 侧边栏控制台。

一个本地 SQLite 文件存四类东西——**事实**（facts，长期有效的一句话）、**片段**（episodes，双方说过的话——用户说的话和助手回的话都记）、**日记**（diary，一天一篇）、**向量**（vec，可选的嵌入索引）。会话日志才是真源，这个库是可以在任何时候重建的缓存。

- 包名：`@emo-bird/dsh-deepmemory`
- 插件 id：`deepmemory`
- 数据目录：`${DSH_HOME:-~/.dsh}/deepmemory/`（`memory.db` + `settings.json`）

## 它解决什么

普通会话的记忆只在上下文窗口里。这个插件把「换一个会话还用得上」的东西存下来，并且在下一轮对话里用一句极短的话告诉模型「你有记忆，去哪查」，内容本身要模型**主动调工具**取。

不每轮注入全文是刻意的：注入成本是常数，查询词由模型按当前对话决定，比固定注入更准。

## 三档检索

同一次搜索的三个阶段，不是三选一：

| 档 | 做法 | 成本 | 作用 |
|---|---|---|---|
| 1 | FTS5 `tokenize=trigram` + BM25 | ~1ms | 中文子串召回，保证不漏 |
| 2 | 中文 bigram 余弦重排 | ~5ms | 换了说法的也能往前提 |
| 3 | 嵌入向量余弦重排 | 取决于模型 | 语义相近但用词不同的 |

档 1+2 永远开，零依赖。档 3 默认关闭，面板里开启后需要模型；运行失败自动降级到档 2，不会让搜索整体失败。

**换嵌入模型**：`vec` 表只是派生索引，删掉重算即可；原文不受影响。

## 写入与注入的门控

两层，越具体越优先（子代理还有一层挂在父会话下面）：

```
会话覆盖  >  全局默认
```

每层四个开关：**读记忆** / **写记忆** / **计入日记** / **删除记忆**。

- **读**：管 `memory_search` / `memory_recall` / `diary_read` 能不能用
- **写**：管你说的话、它回的话要不要存成片段
- **日**：管这个会话的内容要不要进当天的日记
- **删**：管能不能删记录（唯一默认关闭的一维）

「删除记忆」是唯一不可撤销的一维，**全局默认关闭**：打开之后，面板才会允许「清空本会话记忆」——它删的是这个会话的原始片段，事实（facts）不动，因为事实已经脱离会话独立存在。

存储时只写「与父层不同」的键，所以「跟随上层」是默认状态，文件不会膨胀；把值改回与父层相同，那个键会留成 null 墓碑而不是删掉——删掉的键下次列表时会被重新钉住，「恢复继承」就永远失效。

全局默认是**新会话的起点**：每个会话创建时读一次当时的值，钉成自己的，之后改全局默认不再影响任何已有会话。子代理另有独立的一层，没被单独钉住时跟随父会话。

## 工具

普通会话能看到五个：

- `memory_search` — 关键词检索事实/片段/日记
- `memory_recall` — 概览：重要事实 + 最近一篇日记
- `memory_save` — 存一条事实
- `diary_read` — 读日记（不给日期就读最新一篇），受该会话的**读**开关管
- `memory_forget` — 删除事实/片段/日记/整个会话的片段。**唯一不可逆的动作**，所以只在开了「删」的会话里生效，否则直接拒绝

`memory_forget` 与面板上的红字「清空本会话记忆」走同一套门控（每会话的 `forget` 开关，默认关），区别只是调用方是模型还是人。

另外两个**只存在于定时日记会话**里，普通会话根本不会收到它们的定义：

- `diary_material` — 取当天素材，已按每会话的**日**开关筛过
- `diary_write` — 写一篇日记

判定方式不是猜：日记任务跑在 `<数据目录>/diary` 下，插件只在 `agent/created` 时看到工作目录等于这个目录，才把这两个工具挂到该 agent 的作用域上。所以「工具列表里没有 diary_write」是结构性的，不靠模型自觉。

## 日记

**一天一篇，跨会话整合**：把当天所有项目、所有会话、飞书与 Web 的片段汇总成一篇散文，不是按会话列条目。当天没有对话就不写。日记任务自己那个会话的独白不计入素材，否则它会把自己的开场白当成「今天唯一的对话」。

**哪些对话进日记由「日」开关决定**：关掉某个会话的「日」，它的片段照常存（写开关管的是存不存），但不会出现在当天的素材里。这个筛选发生在 `dayDigest(store, day, { include })`，由 index.js 传进来的 `diaryAllowed` 决定。

由 DSH 定时任务在固定时间开一个新会话（工作目录 `<数据目录>/diary`），模型先调 `diary_material` 取素材、写完调 `diary_write` 落盘。插件本身不含任何模型调用。

- `lib/diary.js` 的 `composeInstruction(day)` 是那段指令；素材走工具，不塞进 prompt
- `renderDigest` 按会话分组、按时间排序，单条截断 400 字，最多 400 条
- 日记日界用**本地时间**（`localDay`），`store.js` 里 episodes 的 `day` 字段也是本地日期——用 UTC 会把凌晨的消息记到前一天

## 侧边栏面板

`sidebar.panellist` 的 id 与 `main` 的 key 都是 `deepmemory`——侧边栏只认 id 去解析主面板。

七个页签：概览、事实、片段、**搜索**、日记、**会话**、设置。

面板右上角有一个搜索框，回车就跳到「搜索」页跑一次检索（和工具走同一条 `MemorySearch`
流水线，所以面板能搜到的和 agent 能搜到的是同一批），结果按事实 / 片段 / 日记打标签，
命中的词高亮，可以直接删。搜索是独立页签，所以搜完还能切回去看别的，不必先清空输入框。

检索是模糊的：三个字以上的查询走 FTS5 trigram，短查询补一遍按词的 `LIKE`，
连成一串的查询（「水母颜色」）在没有整体命中时会退化成字符 bigram 重试——
所以两三个字的词、只出现在长句里某个片段的词，都还能捞出来，而不是只有完全一致才命中。

「概览」页的「重建检索索引」会回来一行结果（事实 / 片段 / 日记各重建了多少条），
不再是一闪而过。

「会话」页是逐会话控制台，两张表：

- **子代理默认值**：同一批会话行，控制这些会话派出去的子代理继承什么。没被钉住就跟随父会话；「恢复继承」写的是 null 墓碑，不是删键。
- **会话**：一行一个已存储会话，四列开关 + 前两列信息。

表头固定为「会话 / 首句 / 读 写 日 删」。**首句**优先取 `episodes` 里该会话最早的一条 user 记录（`ROW_NUMBER()` 取，不用 `MIN(created_at)` 自连接——同一毫秒的两条会因此挑错）；没有记录的旧会话回退到 `sessionProjectionCache` 的 `titleInput.first.text`，那是宿主用来生成标题的原始提问，所以老会话也有首句。会话清单来自 `sessionPersistence.list()`，标题走 `sessionProjectionCache.cachedSnapshot`（零 I/O），子代理会话被排除。某行被单独改过时名字下方会出现「已覆盖 · 恢复继承」，开了「删」的会话还会多一条红色「清空本会话记忆」。

「设置」页只有全局默认、每日日记任务、语义检索依赖与推荐嵌入模型。

删除有三个入口，都不需要开会话的「删」开关：事实页、片段页、日记页各自的「删除」按钮，以及搜索结果的删除。只有「清空某个会话的全部片段」受「删」开关约束——那是唯一影响一片历史的动作。日记与片段删除前会弹一次确认。

## 配色与主题

面板和会话头的小开关都只引用 `--dsw-alias-*` token，不写死任何颜色，所以亮色和暗色都跟着走，不需要媒体查询。

**为什么不用 `prefers-color-scheme`**：主题包把亮色变量声明在 `body` 上，暗色声明在 `body[data-ds-dark-theme]` 上，主题是用户在设置里选的，跟系统无关。用媒体查询反而会和用户的选择打架。

三组容易混淆的 token：

| token | 含义 | 不能怎么用 |
| --- | --- | --- |
| `brand-primary` | **单色**（亮色近黑 `#0f1115`，暗色近白）。是对比填充色 | 不能当蓝色 accent 用 |
| `button-primary-fill` + `label-primary-foreground` | 必须成对：前者填底，后者写字，配色翻转后对比度不变 | 不能只用一个 |
| `link` | 真正的蓝色，两套背景都清晰 | —— |

其余用到的：`label-primary` / `label-secondary` / `label-tertiary` 三级文字，`border-l1`（发丝线）/ `border-l2`（常规边框），`bg-base`（页面）/ `bg-layer-1`（输入框）/ `bg-layer-2`（次级面），`settings-card-fill` + `settings-card-stroke`（卡片面 + 描边，宿主就是用这一对画设置卡片的），`interactive-bg-hover`（悬停），`state-error-primary`（错误）。圆角用 `--dsw-radius-xs/sm/md`。

**样式是注入的 `<style>`，不是内联 `style`**。原因很实际：`hover`、`:focus`、过渡、滚动条样式都无法内联表达。注入时带 `data-plugin-css` 标记，插件重载（HMR）时不会堆叠重复样式表。类名统一 `dm-` 前缀。

侧边栏图标用 `fill: currentColor`，颜色交给宿主按钮决定——同一份 SVG 在亮/暗侧边栏、选中/未选中四种状态都正确。

**包图标和侧边栏图标是同一个图形。**

| 文件 | 用途 | 画法 |
| --- | --- | --- |
| `icon.svg`（包根目录） | bundle 元数据图标，插件列表/能力面板用 | 512 网格，粉色 `#F472B6` 实心，一道高光用 `fill-rule="evenodd"` 打穿 |
| `lib/client.js` 里的 `SidebarIcon` | 侧边栏按钮 | 同一份 path 数据，换成 `currentColor`，尺寸取 slot 的 `size` prop |

图形是一只水母：圆顶帽、四根带钩的触手，帽子上一道镂空高光。**整只水母是一条 path**——帽子、触手、高光都在同一串路径里，高光是挖空的子路径而不是叠一个白色图形，所以放在任何底色上都成立，也仍然只有一个颜色。

侧边栏那份只换颜色（`#F472B6` → `currentColor`），几何完全不动，两处露脸认得出是同一个东西。

## 会话标题栏的四个小开关

`conversation.session.header.actions` 里注册了一个 `deepmemory-flags`，紧挨着会话标题：

```
读  写  日  删
```

单字胶囊，**实心 = 开，空心 = 关**，悬停有完整说明。点一下只改**当前会话**这一层（`scope: 'session'`），全局默认不动。

实心态用的是 `button-primary-fill` + `label-primary-foreground` 这一对，所以亮色下是深底浅字、暗色下自动反过来，不会出现白字配白底。

之所以做成单字：这个槽位「overflow is clipped and faded before the utilities」，长标签会被裁掉；`label` 属性对 list 项是显示文字，但会话头里没有足够宽度承载四个中文词。

会话头组件通过 `sessionId` prop 拿到当前会话 id，所以只注册一次就能服务所有对话。

## 日记定时任务

面板「设置」页可以开启，落到 DSH 的 `schedule` 服务（`kind: 'daily'`），默认 `23:40` / `Asia/Shanghai`，`target` 是 `{ kind: 'new', create: { cwd, agentPreset } }`——每次投递开一个新会话，不会写进聊天里。

- 任务的唯一身份是标题 `深度记忆 · 写日记`；`ensureTask` 按标题查目录，已存在且时间相同就直接返回，时间不同则 `edit` 改期，不会造出第二个任务
- 日期按投递时间算：小时 < 4 视为「补昨晚」，否则就是当天（`targetDayFor`）
- 当天没素材时不写：prompt 里明确要求回「今天没有素材，不写日记」且不调 `diary_write`
- 插件自身不发任何模型调用，也不轮询——一切由 DSH 的定时系统驱动

## 面板接口

面板不走 typert Remote（纯 JS 手写包没有 generator 描述符），走 Connection 服务的精确 Fetch 路由：

```
GET  /api/deepmemory/stats
GET  /api/deepmemory/facts?limit=200
GET  /api/deepmemory/episodes?limit=100&day=YYYY-MM-DD
GET  /api/deepmemory/diary
GET  /api/deepmemory/search?q=…
GET  /api/deepmemory/settings
GET  /api/deepmemory/sessions
GET  /api/deepmemory/session-flags?sessionId=…
GET  /api/deepmemory/dependency
GET  /api/deepmemory/models
GET  /api/deepmemory/diary-task
POST /api/deepmemory/settings       { scope: global|session|subagent|semantic|clear-session, id, flags, subagent? }
POST /api/deepmemory/session-flags  { sessionId, scope?: 'subagent', flags | clear: true }
POST /api/deepmemory/forget         { kind: fact|episode|diary|session, id | day | sessionId }
POST /api/deepmemory/facts          { text, subject, weight }
POST /api/deepmemory/rebuild
POST /api/deepmemory/dependency     { action: 'install' }
POST /api/deepmemory/models         { action: install|remove|reveal, model }
POST /api/deepmemory/diary-task     { action: 'enable', time?, zone?, cwd?, agentPreset? } | { action: 'disable' }
```

`GET /dependency` 的响应里带一个 `progress`：`{ phase: 'idle'|'installing'|'done'|'error', bytes, totalBytes, startedAt, finishedAt, error }`。npm 不报字节，所以 Host 在装的时候每秒量一次 `vendor/` 的大小当作进度，`totalBytes` 是估算的 600 MB（实测一次完整安装约 575 MB——onnxruntime-node 把每个平台的 native 运行时都装了）。面板每 900 ms 拉一次这个接口，把「安装中…」变成「12.4 MB / 320.0 MB（4%）」。这是一个进度提示，不是倒计时；装完显示的是实测落盘大小。

**必须注册到 `connection.fetch.register`，不是 `webServer.register`。** `/api` 这个 prefix 由 `client-connection` 独占，只有它会在把请求交给 handler 之前做浏览器信任校验并把 Peer 传进来；直接在 webserver 上挂一条 prefix 会在那道栅栏之前应答。重复注册同一 path 会抛错，所以同一路径的 `GET` 与 `POST` 分成两条路由；`GET` 要和 `HEAD` 一起声明，否则 HEAD 会掉到 404。

浏览器端 `fetch` 同源、带 authority-bound cookie，所以不需要额外鉴权。

## 提示词

「什么时候查、什么时候记」由插件自己写（`lib/index.js` 的 `guidanceText()`），注册在 `systemPrompt.section` 上，不塞进任何 preset 的 persona——换 preset 不该换掉记忆的用法。

那段「该查就去查」的督促单独占一个 section（`deepmemory:recall-nudge`），并且**只在「读」开着的会话里存在**：它的 `text` 是个函数，拿得到本次装配的 `agent`，读开关关着就返回空串；空 section 在渲染前会被丢掉，所以关掉时那段话根本不进提示词，不是进了不生效。装配发生在每一轮开始时，改开关下一轮就换。

另外注册一个 `systemPrompt.context`（order 900），每步只说一句：

> 长期记忆：N 条事实、M 条过往片段、K 篇日记。最近一篇日记是 YYYY-MM-DD。需要细节时用 memory_search 查。

### 第三档依赖不进 profile

`@huggingface/transformers` 会拉 `onnxruntime-node`（unpacked 约 575 MB，含各平台 native 库）。装进 profile 会让每次 DSH 启动都慢，而且装失败会把 profile 弄成半坏状态。所以：

- 装进本 bundle 自己的 `vendor/`（已在 `.gitignore` 里），npm 缓存也放 `vendor/.npm-cache`——默认缓存在系统临时目录，受限环境下会写不进去，装到一半失败比慢更糟
- 面板「设置 → 语义检索」有安装按钮，`POST /api/deepmemory/dependency {action:'install'}` 走 `npm install`，进程内串行化（两次点击不会起两个 npm）
- 无头环境用 `node scripts/install-embed.mjs`
- 依赖缺失时 `createEmbedder()` 返回 `undefined`，**不抛错**，第三档保持关闭；开关仍然可以拨，只是不生效

**模型是另一回事。** 依赖装好只代表代码能跑；模型要单独下载，默认从 `huggingface.co` 拉 `Xenova/bge-small-zh-v1.5`（`BAAI/*` 的原始仓库只有 PyTorch 权重，没有 `onnx/`，直接指过去会 404）。国内常连不上，此时：

- 在面板同页把「下载镜像」填 `https://hf-mirror.com`（写进 `semantic.remoteHost`，也可用环境变量 `DSH_DEEPMEMORY_HF_HOST`）
- 或者自己把 ONNX 目录放进 `vendor/models`，再把「本地模型目录」指到它（写进 `semantic.modelPath`）

两条都失败时第三档就保持关闭，日志里会说明原因。注意本机实测：镜像能取 `config.json`/`tokenizer.json`，但 `.onnx` 走的是另一个 CDN，Node 的 TLS 校验在这台机器上过不去（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），所以模型要手工放。

## 推荐嵌入模型

面板「设置」页的「推荐嵌入模型」列了四个 `Xenova/*` 的 ONNX 转换（`BAAI/*` 只有 PyTorch
权重，指过去必然 404）：`bge-small-zh-v1.5`（24 MB，中文首选）、`bge-base-zh-v1.5`、
`multilingual-e5-small`、`all-MiniLM-L6-v2`（英文最省）。

- **安装**：真去下载到 `vendor/models`，装完立刻切成那个模型（写 `semantic.model`），
  这样点完就生效，不用再手动填模型名。
- **卸载**：删掉 `vendor/models` 下属于它的缓存目录，模型文件不进 profile，删了不影响别的。
- **打开模型目录**：在文件管理器里打开 `vendor/models`，手动放模型就放这儿。

本机实测的坑：镜像能取 `config.json` / `tokenizer.json`，但 `.onnx` 走的是另一个 CDN，
Node 的 TLS 校验过不去（`UNABLE_TO_VERIFY_LEAF_SIGNATURE`），`Invoke-WebRequest` 也一样。
所以这台机器上「安装」多半会失败——失败信息会显示在卡片下方，而不会静默。可行的路是把
ONNX 目录手工放进 `vendor/models`，再在「本地模型目录」里指过去。

## 开发

```bash
node test/store.test.mjs
node test/search.test.mjs
node test/settings.test.mjs
node test/diary.test.mjs
node test/toolkit.test.mjs
node test/scheduler.test.mjs
```

逐个文件跑：`node --test test/` 在本机沙箱里会因为 `spawn EPERM` 挂掉。

### 不能 import `@deepseek-ai/*`

bundle 是用 pnpm 的 `link:` 装进 profile 的，运行时从本仓库目录向上解析依赖。而 `@deepseek-ai/*` 这些包**只存在于 `app.asar` 内**，profile 的 `node_modules\@deepseek-ai\` 下只有 `cosmokit` 和 `schemastery`。所以：

```js
import { defineTool } from '@deepseek-ai/dsh-tools'  // ✗ ERR_MODULE_NOT_FOUND，整个 bundle 起不来
```

注意这是 **import 的问题，不是 link 安装的问题** —— link 安装本身完全正常，只要不 import DSH 内部包就行。真正的判据是「有没有 import」，`tool-fence.js` 和伴侣 preset 里一条 `import` 都没有，所以它们走 link 一点事没有。

需要 `defineTool` 这类工具函数时，在本仓库内自己实现一份（见 `lib/toolkit.js`），或者干脆只跟 `ctx` 服务打交道 —— 根平面注册的包也全都只走 `ctx`。

### 面板接口要走 `connection.fetch.register`

`/api` 这个前缀被 `client-connection` 独占，`ctx.webServer.register({ kind: 'prefix', path: '/api/deepmemory' })` 拿不到浏览器请求（浏览器的 fetch 只带 authority-bound 签名 cookie，走的是 Connection 的 Fetch 通道）。正确写法：

```js
ctx.inject(['connection'], (connCtx) => {
  connCtx.effect(() => connCtx.connection.fetch.register({
    path: '/api/deepmemory/stats',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async (request) => new Response('…'),
  }))
})
```

要点：`fetch` 收到的是 WHATWG `Request`、必须返回 `Response`；同一 `path` 只能注册一次（所以 GET 与 POST 要拆两条）；声明 GET 时把 `HEAD` 一起写上，否则 HEAD 掉 404。

环境事实（写代码时别踩）：

- 本机 node 只有 `C:\Program Files\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe`（v24.21.0，SQLite 3.53.4，`node:sqlite` 内置）
- FTS5 `trigram` 对**少于 3 个字符**的查询必然为空，短查询要退回 `LIKE`
- FTS 表必须是普通 `fts5(text, tokenize='trigram')`，写成 `content=''` 的 contentless 表不能 `DELETE`
- `{{...}}` 在 prompt section 里会被当模板变量，未注册的变量会让整轮请求失败

## 安装

```text
plugin_manager action=install_bundle target=<本目录绝对路径>
```

替换已安装的包需要重启 DSH 才会加载新 JS。
