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
}

/** 打进主进程包体的依赖：插件可通过 require 拿到（与 src/main/plugin/modules.ts 保持一致） */
const HOST_BUNDLED_MODULES = ["cheerio", "he", "es-toolkit"]

export default defineConfig({
  main: {
    resolve: { alias },
    build: {
      // electron-vite 默认把 package.json 里的 dependencies 外部化成运行时 require；
      // 但宿主提供给插件 require 的模块必须打进包体，否则发布后要靠 asar 里的
      // node_modules 才能解析到（pnpm 的链接结构在这里并不稳定）。
      externalizeDeps: { exclude: HOST_BUNDLED_MODULES },
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
  },
})
