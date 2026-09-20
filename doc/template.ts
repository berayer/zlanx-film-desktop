/**
 * 影视源插件模板（不含任何站点信息，可直接复制改名后开始写）
 *
 * 使用方式：
 *  1. 连同同目录的 `plugin-api.d.ts` 一起复制到你的插件工程，并确保两者都在 tsconfig 的 include 内；
 *  2. 填写下面的 `id` / `name` / `version`（三者必填，缺一项安装会直接失败）；
 *  3. 实现 `api` 里需要的方法（search / getDetail / getPlayUrl，按需实现）；
 *  4. 编译成 **单个 CommonJS 文件** 后在宿主的插件面板「从本地安装」：
 *     `npx tsc template.ts --module commonjs --target es2022 --outDir dist`
 *     （不要 bundle：依赖请用 require 交给宿主注入）
 *
 * 沙箱约束：不能 require 相对路径 / 本地文件；顶层不要写副作用（安装校验与每次加载都会执行顶层代码）；
 * 只能 require 宿主预置的模块（见 HostModuleName）。
 */

// 需要 DOM 解析时可解开下面这行（宿主预置了 cheerio / he / es-toolkit）
// import * as cheerio from "cheerio"

/** 宿主上下文在 activate 时注入，顶层只声明引用 */
let ctxRef: PluginContext | undefined

/** 标注成 ZlanxPlugin 后，清单字段与 api 方法签名都会被检查 */
const plugin: ZlanxPlugin = {
  // —— 必填元信息（也可以用 module.exports.manifest = { ... } 集中声明）——
  id: "",
  name: "",
  version: "0.1.0",

  // —— 可选元信息 ——
  // description: "",
  // author: "",
  // homepage: "",
  // apiVersion: "^1.0.0", // 不填表示不限制宿主 API 版本

  // —— 配置项：插件面板据此生成表单，用户填写后存到插件目录的 config.json ——
  // config: [
  //   {
  //     key: "host",
  //     label: "站点地址",
  //     type: "string",
  //     required: true,
  //     default: "https://example.com",
  //     placeholder: "https://example.com",
  //     description: "不要以斜杠结尾",
  //   },
  // ],

  activate(ctx: PluginContext) {
    ctxRef = ctx
    ctx.logger.info(`插件已启用：${ctx.manifest.name}@${ctx.manifest.version}`)
  },

  deactivate() {
    ctxRef?.logger.info("插件已停用")
    ctxRef = undefined
  },

  // —— 宿主可调用的方法（宿主通过 manager.call(id, "search", keyword) 调用）——
  api: {
    /** 按关键字搜索，返回 Film[] */
    async search(keyword: string): Promise<Film[]> {
      if (!ctxRef || keyword.trim().length === 0) {
        return []
      }
      // const host = ctxRef.config.require("host").toString()
      // const response = await fetch(new URL("/search", host))
      // const html = await response.text()
      // const $ = cheerio.load(html)
      // ...解析出列表后返回
      return []
    },

    /** 取影片详情（海报 / 标签 / 剧集分组），返回 Film | undefined */
    async getDetail(id: string): Promise<Film | undefined> {
      if (!ctxRef) {
        return undefined
      }
      // 构造 Film，sources 的每个元素是一条线路（一组剧集）
      const film: Film = {
        id,
        title: "",
        poster: "",
        tags: [
          // ["年份：", "2026"], ["", "纯值标签"]
        ],
        sources: [
          // [{ id: "", title: "第 1 集" }]
        ],
      }
      return film
    },

    /** 取某一集的播放地址，返回 string | undefined */
    async getPlayUrl(id: string): Promise<string | undefined> {
      if (!ctxRef) {
        return undefined
      }
      ctxRef.logger.debug(`取播放地址：${id}`)
      // 取不到地址时可以返回 undefined，宿主会回退到剧集自带的 url
      return undefined
    },
  },
}

module.exports = plugin
