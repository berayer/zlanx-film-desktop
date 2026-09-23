import { app, session } from "electron"
import { hostLog } from "@main/logger"

/** 代理与网络日志器（作用域 `proxy`） */
const log = hostLog.scope("proxy")

/**
 * `proxyFetch` 超时后抛出的错误。
 *
 * 单独建一个类型是为了让调用方区分「超时」和「网络错误」，
 * 从而抛出各自的业务错误码（插件侧是 `HOOK_TIMEOUT`）。
 */
export class ProxyTimeoutError extends Error {
  constructor(readonly timeout: number) {
    super(`请求超过 ${timeout}ms 未完成`)
    this.name = "ProxyTimeoutError"
  }
}

export interface ProxyFetchInit {
  method?: string
  headers?: Record<string, string>
  body?: BodyInit
  /** 外部取消信号 */
  signal?: AbortSignal
  /** 超时（毫秒）；不传表示不限制 */
  timeout?: number
}

/**
 * 把会话（渲染进程 + 主进程的 `session.fetch`）显式设为「跟随系统代理」。
 *
 * Electron 的 Chromium 本来就会读系统代理，但显式设置一次有两点好处：
 * 1. 覆盖任何 `--proxy-server` 之类的命令行开关，行为可控；
 * 2. 启动日志里能直接看到解析结果，用户报「搜索不到 / 播不了」时一眼能排除代理问题。
 *
 * Windows 读 IE / 系统设置（含 PAC 与「自动检测」），macOS 读网络偏好设置，
 * Linux 读桌面环境设置与 `http_proxy` / `https_proxy` 环境变量。
 */
export async function configureSystemProxy(): Promise<void> {
  const defaultSession = session.defaultSession

  await defaultSession.setProxy({ mode: "system" })

  // 代理要求账号密码时，Electron 默认直接取消认证（表现为请求失败）。
  // 这里不做交互（没有输入框），只留下日志，方便定位「为什么只有我这边打不开」。
  app.on("login", (_event, _webContents, _details, authInfo, callback) => {
    if (authInfo.isProxy) {
      log.warn(`代理 ${authInfo.host}:${String(authInfo.port)} 要求身份认证，当前未提供凭据，本次请求已取消`)
    }
    callback()
  })

  // 解析结果形如 `PROXY 127.0.0.1:7890` / `DIRECT`，只用于日志
  const resolved = await defaultSession
    .resolveProxy("https://www.example.com")
    .catch((error: unknown) => `解析失败：${error instanceof Error ? error.message : String(error)}`)
  log.info(`已启用系统代理（示例解析结果：${resolved}）`)
}

/**
 * 主进程侧的网络请求统一入口。
 *
 * 走 `session.fetch`（Chromium 网络栈）而不是 Node 的全局 `fetch`（undici）：
 * 后者完全不认识系统代理，插件抓不到站的典型症状就是「浏览器能开、应用里超时」。
 * 走同一套会话配置，主进程的插件请求与渲染进程的图片 / 视频请求用的是同一个代理设置。
 */
export async function proxyFetch(url: string, init: ProxyFetchInit = {}): Promise<Response> {
  const { timeout, signal, ...rest } = init

  const controller = new AbortController()
  const onExternalAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", onExternalAbort, { once: true })

  // 中断（自己触发的超时）统一翻译成 ProxyTimeoutError；外部 signal 引起的中断保持原样
  const request = session.defaultSession
    .fetch(url, { ...rest, signal: controller.signal } as RequestInit)
    .catch((error: unknown) => {
      if (timeout !== undefined && controller.signal.aborted && !signal?.aborted) {
        throw new ProxyTimeoutError(timeout)
      }
      throw error
    })

  try {
    if (timeout === undefined) {
      return await request
    }

    // session.fetch 对 AbortSignal 的支持在各版本间不完全可靠，这里自己再守一道：
    // 到点先中断底层请求，再同步 reject，保证调用方一定不会被引擎「永久挂住」。
    return await new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        controller.abort()
        reject(new ProxyTimeoutError(timeout))
      }, timeout)
      request.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  } finally {
    signal?.removeEventListener("abort", onExternalAbort)
  }
}
