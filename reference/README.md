# reference/ — DSH 内部实现摘录

这里是从本机 `app.asar` 抽出来的参考副本，用来读 DSH 的契约（tool schema、slot、
Fetch 路由、schedule 服务等）。它们**不是本插件的运行时代码**，不参与构建、不被打包、
不进 `files`，也整个目录被 `.gitignore` 忽略。

抽的时候 DSH 版本是 Desktop 的 `C:\Program Files\DSH NEXT\resources\app.asar`。
升级 DSH 后这些副本可能过期，需要时重新抽。

## 重新抽取

```powershell
$node = 'C:\Program Files\DSH NEXT\resources\runtime\x64\primary-runtime\dependencies\node\bin\node.exe'
& $node .\reference\_asar_extract.js 'node_modules/@deepseek-ai/dsh-tools/lib/index.js' .\reference\_tools_index.js
```

第一个参数是 asar 内部路径，第二个是输出文件；传目录则列出其子项。

注意：`@deepseek-ai/dsh-agent-preset` 在 asar 里是 `unpacked: true`，抽它会算出 NaN
offset 报 `ERR_OUT_OF_RANGE`，那个包要直接从 `app.asar.unpacked\` 读。

## 各文件是什么

| 文件 | 来源（asar 内路径） | 用途 |
| --- | --- | --- |
| `_asar_extract.js` | 本地脚本 | asar 读取器本身 |
| `_askuser.js` / `_askuser.md` | `@deepseek-ai/dsh-tool-ask-user` | `ask_user_question` 的 schema 与行为 |
| `_timecontext.js` | `@deepseek-ai/dsh-time-context` | 时间上下文怎么注入 |
| `_sysprompt.js` | `@deepseek-ai/dsh-system-prompt` | `section` / `context` / `variable` 的排序与插值规则 |
| `_tools_index.js` | `@deepseek-ai/dsh-tools/lib/index.js` | `register` / `restrict` / `view` / schema 校验 |
| `_tools_shared2.js` | `@deepseek-ai/dsh-tools/lib/*` | 上面那包的共享 chunk |
| `_cordis.js` | `@deepseek-ai/cordis` | Effect / Reload / 服务注入模型 |
| `_agentidx.js` | `@deepseek-ai/dsh-agent/lib/index.js` | agent 生命周期与 `agent/created` payload |
| `_ws.md` / `_conn.md` | `@deepseek-ai/dsh-host-webserver` / `dsh-client-connection` | Web 宿主路由与浏览器信任栅栏 |
| `_conn_index.js` | `@deepseek-ai/dsh-client-connection/lib/index.js` | Connection Fetch 路由实现 |

## 两条从这些文件里读出来的硬约束

1. **不能 `import '@deepseek-ai/*'`**。link 安装时 Node 从本仓库向上找，只能看到
   profile 的 `node_modules`，那里没有这些包（它们只在 asar 里）。工具定义因此走
   本地 `lib/toolkit.js`。
2. **面板接口要注册到 `connection.fetch.register`**，不是 `webServer.register`。
   `/api` 这个前缀被 client-connection 独占，且注册以 path 为键——同一路径的多个
   method 必须合成一条，见 `lib/index.js` 的 `route()`。
