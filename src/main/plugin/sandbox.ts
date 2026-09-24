import { Buffer } from "node:buffer"
import { createRequire } from "node:module"
import path from "node:path"
import * as vm from "node:vm"
import { PluginError } from "./errors"
import type { PluginHttp, PluginHttpInit, PluginLogger } from "./interface"

export interface SandboxOptions {
  pluginId: string
  /** 插件入口源码 */
  code: string
  /** 入口文件绝对路径（用于栈信息与 `__filename`） */
  filename: string
  /** 插件根目录绝对路径（用于 `__dirname` 与模块解析起点） */
  directory: string
  allowRequire: readonly string[]
  /** 宿主预置的模块表（键为插件里写的模块名），命中即直接返回 */
  modules?: Readonly<Record<string, unknown>>
  allowCodeGeneration: boolean
  /** 顶层代码执行超时（毫秒） */
  timeout: number
  /** 注入给插件的 `console` */
  logger: PluginLogger
  /** 注入给插件的 `fetch`（安装校验阶段传拒绝实现） */
  http: PluginHttp
}

export interface SandboxHandle {
  exports: Record<string, unknown>
  dispose(): void
}

/**
 * 以 CommonJS 形式在 `node:vm` 沙箱中执行插件入口代码。
 *
 * - 只注入白名单 `require`、`console` 与 `fetch`（`fetch` 由宿主按超时策略包装）；
 * - **`node:vm` 的新上下文不继承 Node 全局**，所有插件能用的全局都要在这里逐个列出
 *   （目前含 `Buffer`、`URL` / `URLSearchParams`、`TextEncoder` / `TextDecoder`、
 *   `AbortController` / `AbortSignal`、定时器、`queueMicrotask`）；
 * - 顶层同步执行受 `timeout` 约束，超时抛 `LOAD_FAILED`；
 * - 默认屏蔽 `eval` / `new Function`（`allowCodeGeneration` 可放开）。
 */
export function runPluginModule(options: SandboxOptions): SandboxHandle {
  const { pluginId, code, filename, directory, allowCodeGeneration, timeout } = options

  const sandbox: Record<string, unknown> = {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    AbortSignal,
    // Node 全局，必须显式注入：vm 上下文里默认是 undefined，
    // 插件一调用 Buffer.from(...) 就 ReferenceError
    Buffer,
  }
  sandbox.console = options.logger
  sandbox.fetch = (input: string | URL, init?: RequestInit) =>
    options.http.request(String(input), init as PluginHttpInit | undefined)
  if (!allowCodeGeneration) {
    sandbox.eval = forbidden("eval", pluginId)
    sandbox.Function = forbidden("new Function", pluginId)
  }

  const moduleObj: { exports: Record<string, unknown> } = { exports: {} }
  sandbox.__zlanx_module = moduleObj
  sandbox.__zlanx_exports = moduleObj.exports
  sandbox.__zlanx_require = createPluginRequire(options)
  sandbox.__zlanx_filename = filename
  sandbox.__zlanx_dirname = directory

  const context = vm.createContext(sandbox, { name: `plugin:${pluginId}` })
  const wrapper = new vm.Script(
    "(function (exports, require, module, __filename, __dirname) {\n" +
      code +
      "\n})(__zlanx_exports, __zlanx_require, __zlanx_module, __zlanx_filename, __zlanx_dirname);",
    { filename },
  )

  try {
    wrapper.runInContext(context, { timeout })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const timedOut = /timed out|execution terminated/i.test(message)
    throw new PluginError(
      "LOAD_FAILED",
      timedOut ? `插件顶层代码执行超过 ${timeout}ms` : `插件代码执行失败：${message}`,
      { pluginId, cause: error },
    )
  }

  return {
    exports: moduleObj.exports,
    dispose() {
      // vm 上下文无法被强制终止，这里移除可复用的宿主引用并交由 GC 回收
      sandbox.__zlanx_require = undefined
      sandbox.__zlanx_module = undefined
      sandbox.__zlanx_exports = undefined
    },
  }
}

function forbidden(name: string, pluginId: string): () => never {
  return () => {
    throw new PluginError("PERMISSION_DENIED", `插件未开启 allowCodeGeneration，禁止使用 ${name}`, {
      pluginId,
    })
  }
}

/**
 * 宿主侧模块解析起点。
 * CJS 打包环境（如 Electron 主进程 bundle）有模块作用域的 `__filename`，直接使用；
 * ESM 环境（测试 / Node 直跑）没有 `__filename`，退回进程工作目录。
 */
function hostRequireBasePath(): string {
  if (typeof __filename === "string") {
    return __filename
  }
  return path.join(process.cwd(), "index.js")
}

function createPluginRequire(options: SandboxOptions): (id: string) => unknown {
  const { pluginId, directory, allowRequire, modules } = options
  const cache = new Map<string, unknown>()
  // 只在「白名单内但未预置」时才会走到：从插件目录向上解析，失败再回退到宿主。
  const pluginBase = createRequire(path.join(directory, "index.js"))
  const hostBase = createRequire(hostRequireBasePath())

  return (id: string): unknown => {
    if (typeof id !== "string" || id.length === 0) {
      throw new PluginError("MODULE_NOT_ALLOWED", "require 的参数必须是非空模块名", { pluginId })
    }
    if (id.startsWith(".") || id.startsWith("/")) {
      throw new PluginError("MODULE_NOT_ALLOWED", `插件暂不支持加载本地文件 "${id}"，请保持插件为单文件`, { pluginId })
    }
    const allowed = allowRequire.some((name) => id === name || id.startsWith(`${name}/`))
    if (!allowed) {
      throw new PluginError(
        "MODULE_NOT_ALLOWED",
        `插件不允许 require "${id}"，已允许的模块：${allowRequire.join(", ") || "无"}`,
        { pluginId },
      )
    }
    const cached = cache.get(id)
    if (cached !== undefined) {
      return cached
    }

    // 1) 宿主预置模块（静态 import，已随主进程打包，优先命中）
    const provided = modules?.[id]
    if (provided !== undefined) {
      cache.set(id, provided)
      return provided
    }

    // 2) 退回宿主自身的模块解析（开发态的 node_modules / 打包后的 asar）
    let mod: unknown
    try {
      const resolved = pluginBase.resolve(id)
      mod = hostBase(resolved)
    } catch (firstError) {
      try {
        mod = hostBase(id)
      } catch {
        throw new PluginError(
          "MODULE_NOT_ALLOWED",
          `无法解析模块 "${id}"，请在宿主的 modules 中预置该模块（见 src/main/plugin/modules.ts）`,
          { pluginId, cause: firstError },
        )
      }
    }
    cache.set(id, mod)
    return mod
  }
}
