import { resolve } from "path"
import { defineConfig } from "electron-vite"
import react from "@vitejs/plugin-react"
import { tanstackRouter } from "@tanstack/router-plugin/vite"
import tailwindcss from "@tailwindcss/vite"

// 别名要同时给 main / preload / renderer 三份配置，
// 否则主进程里写 `@main/...` 时 Rollup 解析不到（tsconfig 的 paths 只管类型检查）
const alias = {
  "@": resolve("src/renderer/src"),
  "@main": resolve("src/main/"),
  "@preload": resolve("src/preload"),
  "@shared": resolve("src/shared"),
  "@generated": resolve("generated"),
}

/**
 * 打进主进程包体的依赖：插件可通过 require 拿到（与 src/main/plugin/modules.ts 保持一致）。
 * 只列第三方库；Node 内置模块（`node:crypto` 等）Rollup 不会打包，无需在此登记。
 */
const HOST_BUNDLED_MODULES = ["cheerio", "he", "es-toolkit"]

/**
 * 主进程分块：把体积最大的两块单独拆出来。
 *
 * - `prisma`：`generated/prisma` 生成的 Client 代码，占了主进程包的一大半；
 * - `vendor`：其余被打进包体的 node_modules（即 `HOST_BUNDLED_MODULES` 及其依赖，
 *   它们是给插件 `require` 用的，不能走外部化）。
 *
 * package.json 里的 dependencies 已被 `externalizeDeps` 外部化成运行时 require，
 * 所以这里只剩下「必须内联」的那部分依赖，分组是稳定的。
 */
function mainManualChunks(id: string): string | undefined {
  // Windows 上 id 形如 E:/.../generated/prisma/client.ts，用 includes 判断即可
  if (id.includes("generated/prisma")) {
    return "prisma"
  }
  if (id.includes("node_modules")) {
    return "vendor"
  }
  return undefined
}

/**
 * 渲染进程分块：把大且稳定的第三方库单独成块，与业务代码 / 路由分片分开。
 *
 * 收益来自三点：
 * 1. 业务代码改动不会改变这些块的 hash，Chromium 的磁盘缓存可以持续命中；
 * 2. 首屏并行请求若干小文件，而不是等一个 1MB+ 的入口包下载并解析完；
 * 3. 播放器那套（react-player / media-chrome / hls / dash，合计 1.5MB+）
 *    只由播放页的动态 import 触发，不会被首页带出来。
 *
 * 这里**只对确定的库分组，其余交回 Rollup**：把未知依赖统一塞进一个 vendor 块，
 * 很容易把本该懒加载的代码（比如播放器）拖进首屏，反而变慢。
 */
function rendererManualChunks(id: string): string | undefined {
  // Vite 的动态 import 辅助（__vitePreload）必须单独落在共享块里。
  // 它是入口和所有懒加载块共用的，一旦被 Rollup 归进某个业务块（比如播放器），
  // 入口就会静态依赖那整个块 —— 首屏因此预加载本该懒加载的 4MB 播放器代码。
  if (id.includes("vite/preload-helper") || id.includes("vite/modulepreload-polyfill")) {
    return "shared"
  }

  if (!id.includes("node_modules")) {
    return undefined
  }

  // react / react-dom / scheduler 必须在同一块：拆开会出现 hook 运行时的重复实例
  if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) {
    return "react"
  }
  if (id.includes("node_modules/@tanstack/")) {
    return "router"
  }
  if (
    id.includes("node_modules/@base-ui/") ||
    id.includes("node_modules/lucide-react/") ||
    id.includes("node_modules/class-variance-authority/") ||
    id.includes("node_modules/tailwind-merge/") ||
    id.includes("node_modules/clsx/")
  ) {
    return "ui"
  }
  if (
    id.includes("node_modules/react-player/") ||
    id.includes("node_modules/media-chrome/") ||
    id.includes("node_modules/hls.js/") ||
    id.includes("node_modules/dashjs/")
  ) {
    return "player"
  }
  return undefined
}

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      // electron-vite 默认把 package.json 里的 dependencies 外部化成运行时 require；
      // 但宿主提供给插件 require 的模块必须打进包体，否则发布后要靠 asar 里的
      // node_modules 才能解析到（pnpm 的链接结构在这里并不稳定）。
      externalizeDeps: { exclude: HOST_BUNDLED_MODULES },
      // 只在构建日志里报告原始体积：gzip 体积对本地加载没有意义，算它还拖慢构建
      reportCompressedSize: false,
      rollupOptions: {
        output: { manualChunks: mainManualChunks },
      },
    },
  },
  preload: {
    resolve: { alias },
  },
  renderer: {
    resolve: { alias },
    plugins: [
      tanstackRouter({
        target: "react",
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
    ],
    build: {
      // 跑的是内置的 Chromium，不需要为老浏览器降级语法，输出更精简
      target: "es2022",
      reportCompressedSize: false,
      // 播放器 / dash 这类块本来就大，把告警阈值抬到 1MB，避免噪音
      chunkSizeWarningLimit: 1024,
      rollupOptions: {
        output: { manualChunks: rendererManualChunks },
      },
    },
  },
})
