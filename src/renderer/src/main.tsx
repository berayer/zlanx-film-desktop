import { StrictMode } from "react"
import ReactDOM from "react-dom/client"
import { RouterProvider, createHashHistory, createRouter } from "@tanstack/react-router"

// Import the generated route tree
import { routeTree } from "./routeTree.gen"

import "@/globals.css"

/**
 * 这里必须用 hash history（`/#/search?q=…`），不能用默认的 browser history。
 *
 * 打包后渲染层是用 `loadFile` 以 `file://` 加载的，`location.pathname` 会是
 * index.html 在磁盘上的绝对路径（形如 `/E:/…/renderer/index.html`），
 * browser history 拿它去匹配路由表必然匹配不上 → 首页直接渲染成 Not Found。
 * hash history 只看 `#/` 后面的部分，与页面是怎么被加载的无关，dev 与打包后一致。
 */
const router = createRouter({ routeTree, history: createHashHistory() })

// Register the router instance for type safety
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}

// Render the app
const rootElement = document.getElementById("root")!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  )
}
