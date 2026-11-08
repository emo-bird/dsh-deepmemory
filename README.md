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

三层，越具体越优先：

```
会话覆盖  >  preset 默认  >  全局默认
```

每层四个开关：**读记忆** / **写记忆** / **计入日记** / **删除记忆**。

「删除记忆」是唯一不可撤销的一维，**全局默认关闭**：打开之后，面板才会允许「清空本会话记忆」——它删的是这个会话的原始片段，事实（facts）不动，因为事实已经脱离会话独立存在。

存储时只写「与父层不同」的键，所以「跟随上层」是默认状态，文件不会膨胀；把值改回与父层相同，那个键会被删掉。

`preset` 那一层是**新会话的默认值**：用该 preset 开出来的会话，没被单独覆盖过就按它走。改 preset 层不会影响已存在的会话。

## 四个工具

模型可见的：

- `memory_search` — 关键词检索事实/片段/日记
- `memory_recall` — 概览：重要事实 + 最近一篇日记
- `memory_save` — 存一条事实
- `diary_read` — 读日记（不给日期就读最新一篇）

另有 `diary_write` 只给定时任务用：模型在普通会话里不该自己写日记。

## 日记

**一天一篇，跨会话整合**：把当天所有项目、所有 preset、飞书与 Web 的片段汇总成一篇散文，不是按会话列条目。当天没有对话就不写。

由 DSH 定时任务在固定时间开一个新会话，把素材喂进去，模型写完后调 `diary_write` 落盘。插件本身不含任何模型调用。

- `lib/diary.js` 的 `composePrompt(store, day)` 生成「指令 + 素材」
- `renderDigest` 按会话分组、按时间排序，单条截断 400 字，最多 400 条

## 侧边栏面板

`sidebar.panellist` 的 id 与 `main` 的 key 都是 `deepmemory`——侧边栏只认 id 去解析主面板。

六个页签：概览（计数与重建索引）、事实、片段、日记、**会话**、设置。

「会话」页是逐会话控制台，两张表：

- **新会话的默认值（按 preset）**：一行一个 preset，勾的是该 preset 新开会话时的起点。
- **会话**：一行一个已存储会话，四列开关 + 前两列信息。

表头固定为「会话 / 首句 / 读 写 日 删」。**首句**是该会话里用户说的第一句话（`episodes` 里按 `created_at` 取每条会话最早的一条 user 记录）——自动生成的标题会漂，首句不会，认人靠它更可靠。会话清单来自 `sessionPersistence.list()`，标题走 `sessionProjectionCache.cachedSnapshot`（零 I/O），子代理会话被排除。某行被单独改过时名字下方会出现「已覆盖 · 恢复继承」。

「设置」页只有全局默认、每日日记任务、语义检索依赖。

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

侧边栏图标用 `stroke: currentColor`，颜色交给宿主按钮决定——同一份 SVG 在亮/暗侧边栏、选中/未选中四种状态都正确。

**两个图标是同一个图形的两种画法**，不是两套设计：

| 文件 | 用途 | 画法 |
| --- | --- | --- |
| `icon.svg`（包根目录） | bundle 元数据图标，插件列表/能力面板用 | 64×64 彩色实心方块（深蓝底 + 浅蓝描边） |
| `lib/client.js` 里的 `SidebarIcon` | 侧边栏按钮 | 24×24 单色描边，取 slot 的 `size` prop |

两者都是「一个回环 + 一排三个点」（记忆环）这个 motif。之前侧边栏画的是另一个「头/脑」轮廓，跟包图标对不上，已经改成同一图形——同一个插件在两处露脸，认得出是同一个东西才算合格。侧边栏那份必须是单色描边，因为它要和相邻的侧边栏图标（也是 `currentColor` 线条）在同一排视觉重量里。

## 会话标题栏的四个小开关

`conversation.session.header.actions` 里注册了一个 `deepmemory-flags`，紧挨着会话标题：

```
读  写  日  删
```

单字胶囊，**实心 = 开，空心 = 关**，悬停有完整说明。点一下只改**当前会话**这一层（`scope: 'session'`），preset 默认与全局默认都不动。

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
GET  /api/deepmemory/diary-task
POST /api/deepmemory/settings       { scope: global|preset|session|semantic|clear-session, id, flags, presetId }
POST /api/deepmemory/session-flags  { sessionId, flags | clear: true }
POST /api/deepmemory/forget         { kind: fact|episode|diary|session, id | day | sessionId }
POST /api/deepmemory/facts          { text, subject, weight }
POST /api/deepmemory/rebuild
POST /api/deepmemory/dependency     { action: 'install' }
POST /api/deepmemory/diary-task     { action: 'enable', time?, zone?, cwd?, agentPreset? } | { action: 'disable' }
```

**必须注册到 `connection.fetch.register`，不是 `webServer.register`。** `/api` 这个 prefix 由 `client-connection` 独占，只有它会在把请求交给 handler 之前做浏览器信任校验并把 Peer 传进来；直接在 webserver 上挂一条 prefix 会在那道栅栏之前应答。重复注册同一 path 会抛错，所以同一路径的 `GET` 与 `POST` 分成两条路由；`GET` 要和 `HEAD` 一起声明，否则 HEAD 会掉到 404。

浏览器端 `fetch` 同源、带 authority-bound cookie，所以不需要额外鉴权。

## 提示词

「什么时候查、什么时候记」由插件自己写（`lib/index.js` 的 `guidanceText()`），注册在 `systemPrompt.section` 上，不塞进任何 preset 的 persona——换 preset 不该换掉记忆的用法。

另外注册一个 `systemPrompt.context`（order 900），每步只说一句：

> 长期记忆：N 条事实、M 条过往片段、K 篇日记。最近一篇日记是 YYYY-MM-DD。需要细节时用 memory_search 查。

### 第三档依赖不进 profile

`@huggingface/transformers` 会拉 `onnxruntime-node`（unpacked ~290 MB）。装进 profile 会让每次 DSH 启动都慢，而且装失败会把 profile 弄成半坏状态。所以：

- 装进本 bundle 自己的 `vendor/`（已在 `.gitignore` 里）
- 面板「设置 → 语义检索」有安装按钮，`POST /api/deepmemory/dependency {action:'install'}` 走 `npm install`，进程内串行化（两次点击不会起两个 npm）
- 无头环境用 `node scripts/install-embed.mjs`
- 依赖缺失时 `createEmbedder()` 返回 `undefined`，**不抛错**，第三档保持关闭；开关仍然可以拨，只是不生效

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
