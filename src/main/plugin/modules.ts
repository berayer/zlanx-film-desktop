/**
 * 宿主提供给插件的第三方模块。
 *
 * 插件只有单文件、不能自带依赖，所以凡是插件里 `require(...)` 的模块，
 * 都必须在这里 **静态 import 一次**：
 *
 * 1. 打包时 Rollup 会把它们一起打进 `out/main/index.js`，发布后不需要 node_modules；
 * 2. 运行时由 `PluginManager` 通过 `options.modules` 注入沙箱，插件 `require` 时直接命中，
 *    不再走 Node 的模块解析（asar 里解析不到符号链接型的 node_modules）。
 *
 * 新增一个可 require 的模块：装到 `dependencies` → 在这里 import 并加进下面的表 →
 * 名字自动进入 `HOST_MODULE_NAMES`（由 `initPluginManager` 传给管理器）。
 * 注意不要放进 devDependencies：那会被 electron-builder 裁掉。
 */
import * as cheerio from "cheerio"
import * as esToolkit from "es-toolkit"
import * as he from "he"

/**
 * 把 `import * as X` 的结果整理成插件 `require` 时期望的形态。
 *
 * 同一个 `import * as X` 在两种运行环境下的形态并不一致：
 *
 * - **打包态**（Rollup 命名空间）：命名导出直接挂在对象上，**没有 `default`**；
 * - **开发态**（依赖被外部化）：Node / Vite 的 interop 命名空间，真正的 CJS 导出在 `default` 上。
 *
 * 如果直接把命名空间交给插件，就会出现「同一个插件 dev 能跑、打包后报
 * `Cannot read properties of undefined (reading 'load')`」这类问题——
 * 插件按 ESM 习惯写 `require("cheerio").default` 时，打包态拿不到东西。
 *
 * 这里把两种形态合并成一个对象：命名导出与 `default` 一律指向同一份实现，
 * 于是 `require("x")` 与 `require("x").default` 在两种环境下都可用。
 */
function toPluginModule<T extends object>(namespace: T): T {
  const candidate = namespace as T & { default?: unknown }
  const fallback =
    typeof candidate.default === "object" && candidate.default !== null
      ? (candidate.default as T & { default?: unknown })
      : undefined
  const impl: unknown = fallback ?? namespace

  const merged: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(impl as Record<string, unknown>)) {
    // Object.entries 不会带出原型上的 Symbol.toStringTag 之类，只保留真实导出
    if (value !== undefined) {
      merged[key] = value
    }
  }
  for (const [key, value] of Object.entries(candidate as unknown as Record<string, unknown>)) {
    if (key !== "default" && value !== undefined) {
      merged[key] = value
    }
  }
  merged.default = impl
  return merged as T
}

/** 键名必须与插件里写的模块名完全一致（支持子路径，如 `es-toolkit/array`） */
export const HOST_MODULES: Record<string, unknown> = {
  cheerio: toPluginModule(cheerio),
  he: toPluginModule(he),
  "es-toolkit": toPluginModule(esToolkit),
}

/** 允许插件 require 的模块名，默认交给 `initPluginManager` 作为 allowRequire */
export const HOST_MODULE_NAMES: readonly string[] = Object.keys(HOST_MODULES)
