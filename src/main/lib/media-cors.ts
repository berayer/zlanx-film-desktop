import { session } from "electron"
import { hostLog } from "@main/logger"

/** 播放器网络日志器（作用域 `media-cors`） */
const log = hostLog.scope("media-cors")

/**
 * 需要补 CORS 头的媒体资源。
 *
 * 注意这里对整个 URL（含 query）做匹配：不少站的地址是 `/player.php?url=xxx.m3u8` 或
 * `/xxx.php?token=abc.m3u8`，后缀只出现在查询串里，只看 pathname 会漏。
 * 末尾的 `[?#&;]|$` 保证匹配的是后缀本身，而不是 `.mp4x` 这类。
 */
const MEDIA_URL_PATTERN =
  /(\.m3u8|\.mpd|\.ts|\.m4s|\.mp4|\.m4a|\.aac|\.mp3|\.flv|\.webm|\.ogv|\.key)(?:[?#&;]|$)/i

/** 补进响应里的 CORS 头（键用小写：HTTP/2 下响应头一律小写） */
const CORS_RESPONSE_HEADERS: Record<string, string[]> = {
  "access-control-allow-origin": ["*"],
  "access-control-allow-methods": ["GET, HEAD, OPTIONS"],
  "access-control-allow-headers": ["*"],
  // hls.js 会读 Content-Length / Range 做分片与码率估算
  "access-control-expose-headers": ["Content-Length", "Content-Type", "Range", "Accept-Ranges"],
}

/**
 * 让播放器可以跨源拉取视频流。
 *
 * 背景：hls.js / dash.js 是用 XHR 去取 m3u8 与分片的，属于浏览器的「跨源请求」，
 * 目标站（影视源）基本不会返回 `Access-Control-Allow-Origin`，于是渲染进程还没拿到数据
 * 就被 Chromium 拦掉，控制台报：
 * `Access to XMLHttpRequest at ... has been blocked by CORS policy`。
 *
 * 处理方式（比 `webSecurity: false` 精确得多，不会关掉整个渲染进程的同源策略）：
 * 1. 只对媒体类请求动手；
 * 2. 响应阶段补上 CORS 头，浏览器就放行；
 * 3. 请求阶段去掉 `Origin` —— 部分站在看到 Origin 时会返回不同内容或直接 403。
 *
 * `<video src>` 直连不受影响（不带 crossorigin 属性时本来就不走 CORS 校验，
 * 只是拿不到像素数据而已，播放正常）。
 */
export function configureMediaCors(): void {
  const webRequest = session.defaultSession.webRequest

  const isMediaRequest = (details: { url: string; resourceType?: string }): boolean =>
    details.resourceType === "media" || MEDIA_URL_PATTERN.test(details.url)

  webRequest.onHeadersReceived((details, callback) => {
    if (!isMediaRequest(details)) {
      callback({})
      return
    }
    callback({
      responseHeaders: { ...details.responseHeaders, ...CORS_RESPONSE_HEADERS },
    })
  })

  webRequest.onBeforeSendHeaders((details, callback) => {
    if (!isMediaRequest(details)) {
      callback({})
      return
    }
    const requestHeaders = { ...details.requestHeaders }
    // 请求头的键大小写不固定（Chromium 通常原样保留），两个都删
    delete requestHeaders["Origin"]
    delete requestHeaders["origin"]
    callback({ requestHeaders })
  })

  log.info("已开启播放器跨源放行（媒体响应补 CORS 头、请求去掉 Origin）")
}
