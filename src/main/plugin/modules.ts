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

/** 键名必须与插件里写的模块名完全一致（支持子路径，如 `es-toolkit/array`） */
export const HOST_MODULES: Record<string, unknown> = {
  cheerio,
  he,
  "es-toolkit": esToolkit,
}

/** 允许插件 require 的模块名，默认交给 `initPluginManager` 作为 allowRequire */
export const HOST_MODULE_NAMES: readonly string[] = Object.keys(HOST_MODULES)
