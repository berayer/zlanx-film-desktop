# 影视源插件开发指南

本目录是插件开发的对外资料，包含两份文件：

| 文件 | 用途 |
| --- | --- |
| [`plugin-api.d.ts`](./plugin-api.d.ts) | 插件开发类型声明（自包含、零依赖、全局可用，无需 import） |
| [`template.ts`](./template.ts) | 空白模板，不含任何站点信息，复制改名即可开始写 |

## 一、插件是什么

- 一个插件就是 **一个 CommonJS 文件**（`index.js`），宿主把它放到 `plugins/<插件 id>/index.js` 后加载。
- 元信息不写在 manifest.json 里，而是来自 `module.exports` 的导出字段（平铺写，或集中在 `module.exports.manifest` 里，后者优先）。
- 宿主只会调用它声明过的方法，当前是 `search` / `getDetail` / `getPlayUrl`，实现其中任意几个即可。
- 插件目录里还会有宿主维护的 `state.json` / `config.json` / `storage.json`，插件不要手改。

## 二、上手流程

1. 复制 `plugin-api.d.ts` 与 `template.ts` 到你的工程，保证两者都在 `tsconfig.json` 的 `include` 内。
2. 填写 `id` / `name` / `version`（**三项必填**，缺一项安装直接失败且不落盘）。
3. 实现 `api` 里需要的方法。
4. 编译成单个 CommonJS 文件（**不要 bundle**，依赖交给宿主注入的 `require`）：

   ```bash
   npx tsc template.ts --module commonjs --target es2022 --outDir dist
   ```

5. 在宿主的插件管理页「从本地安装」（支持多选 `.js` / `.cjs`），或从 URL 安装。

## 三、清单字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `id` | ✅ | 全局唯一 ID（建议 kebab-case），同时作为插件目录名 |
| `name` | ✅ | 展示名称 |
| `version` | ✅ | 语义化版本号，如 `1.2.0` |
| `description` / `author` / `homepage` / `icon` | | 展示用信息 |
| `apiVersion` | | 依赖的宿主 API 版本，支持 `^1.0.0`、`>=1.0.0`、`1.x` |
| `dependencies` | | 依赖的其他插件：`{ [pluginId]: 版本范围 }` |
| `enabled` | | 默认是否启用，默认 `true`；运行时启停状态存在 `state.json` |
| `config` | | 配置项声明，插件面板据此生成表单 |

生命周期钩子（可选）：`activate(ctx)` 在加载完成 / 启用时调用，`deactivate()` 在禁用 / 卸载时调用。

## 四、可调用方法

```ts
interface SourceApi {
  search(keyword: string, options?: PluginCallOptions): Promise<Film[]>
  getDetail(id: string, options?: PluginCallOptions): Promise<Film | undefined>
  getPlayUrl(id: string, options?: PluginCallOptions): Promise<string | undefined>
}
```

- 宿主调用时会带上第二个参数 `options`（`timeout` / `signal`），用不到可以不声明。
- 方法默认超时 30s，可在 `options.timeout` 覆盖。
- `getDetail` 返回的 `Film.sources` 是「线路 → 剧集」的二维数组：`[[第1集, 第2集], [线路2的集...]]`。
- `getPlayUrl` 取不到时返回 `undefined`，宿主会回退到剧集自带的 `url`。

### Film 数据结构

```ts
interface Film {
  id: string            // 站内唯一 ID，后续取详情 / 播放地址都用它
  title: string
  poster?: string
  year?: string
  region?: string
  genres?: string[]
  description?: string
  rating?: number
  latest?: string       // 「更新至 12 集」这类文案
  latestDate?: string
  sources?: FilmSourceEpisode[][]  // 多条线路，每条线路多集
  tags?: FilmTag[]      // [属性, 取值]，宿主原样按数组顺序渲染
  [key: string]: unknown  // 允许自行扩展字段
}

interface FilmSourceEpisode {
  id: string   // 剧集 ID，用于 getPlayUrl
  title: string
  url?: string // 部分源会直接给出播放页地址
}
```

`tags` 的标签可以为空字符串（`["", "奇幻"]` 表示纯值标签），只有取值为空才会被丢弃。

## 五、上下文能力（`activate(ctx)` 注入）

```ts
interface PluginContext {
  readonly manifest: Readonly<PluginManifest>
  readonly apiVersion: string
  readonly logger: PluginLogger     // debug / info / warn / error / log，随宿主日志落盘
  readonly storage: PluginStorage   // get / set / delete / clear / keys / flush
  readonly config: PluginConfig     // get / require / has / all（只读视图）
  readonly http: PluginHttp         // request / text / json，可自定义 method / headers / body / timeout
  readonly events: PluginEvents     // on / once / off / emit（插件内自洽，不跨插件）
  getPlugin(id: string): PluginInfo | undefined
  reload(): Promise<void>
}
```

- **配置**：`config` 字段声明后，用户在插件面板填写，存到插件目录的 `config.json`；必填项用 `ctx.config.require(key)`，缺失会抛 `INVALID_CONFIG`。
- **存储**：`ctx.storage` 是插件私有 KV，落地为独立 JSON，写入约 200ms 合并落盘一次，需要立刻写盘就 `await ctx.storage.flush()`。
- **日志**：`ctx.logger.*` 或直接 `console.*`，输出都会随宿主日志（electron-log）落盘。

## 六、网络与沙箱约束

- `fetch` 与 `ctx.http` 默认超时 15000ms；需要自定义 header / 超时 / 取消信号时用 `ctx.http`。
- 安装校验阶段禁止发起网络请求。
- 插件只能 `require` 宿主预置的模块，相对路径 / 绝对路径会抛 `MODULE_NOT_ALLOWED`：

  | 模块 | 说明 |
  | --- | --- |
  | `cheerio` | HTML 解析 |
  | `he` | HTML 实体编解码 |
  | `es-toolkit` | 工具函数 |
  | `node:crypto`（或 `crypto`） | Node 内置加解密 |

  宿主已把命名导出与 `default` 归一化，所以 `require("x")` 与 `require("x").default` 都指向同一份实现；
  需要精确类型时自行断言：`const cheerio = require("cheerio") as typeof import("cheerio")`。
- 顶层不要写副作用：安装校验与每次加载都会执行一遍顶层代码。
- 默认禁用 `eval` 与 `new Function`。
- 其它可用全局：`setTimeout` / `setInterval` / `queueMicrotask` / `URL` / `URLSearchParams` /
  `TextEncoder` / `TextDecoder` / `AbortController` / `AbortSignal` / `__filename` / `__dirname`。

## 七、错误码

宿主抛出的错误名为 `PluginError`，`error.code` 取值见 `PluginErrorCode`：
`INVALID_MANIFEST` / `PLUGIN_NOT_FOUND` / `PLUGIN_NOT_LOADED` / `ENTRY_NOT_FOUND` / `INSTALL_FAILED` /
`INVALID_CONFIG` / `LOAD_FAILED` / `HOOK_FAILED` / `HOOK_TIMEOUT` / `METHOD_NOT_FOUND` /
`PERMISSION_DENIED` / `MODULE_NOT_ALLOWED` / `DEPENDENCY_MISSING` / `INCOMPATIBLE_API` / `INVALID_OPTION`。

## 八、调试

- 插件管理页可查看状态（`active` / `inactive` / `error`）、启停、配置与卸载；加载失败会显示原因。
- 插件日志随宿主日志落盘（electron-log，位置为 `app.getPath("logs")/main.log`）。
- 开发态插件目录是项目根的 `plugins/`，打包后是 `userData/plugins/`。

## 九、类型的维护

`plugin-api.d.ts` 由宿主实现反向生成，宿主改动后需要同步重新生成，来源是：

- `src/main/plugin/interface.ts` —— 清单 / 上下文 / 配置 / 错误码
- `src/shared/plugin-api.ts` —— 可调用方法（`SourceApi`）与数据结构（`Film` / `FilmTag`）
- `src/main/plugin/sandbox.ts` —— 沙箱注入的全局（`console` / `fetch` / `require`）
- `src/main/plugin/modules.ts` —— 宿主预置、可 `require` 的模块
