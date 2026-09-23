# zlanx-film-desktop

一个基于 Electron + React + TypeScript 的桌面影视聚合播放器：通过「影视源插件」搜索影片、解析播放地址、在线播放，
并支持收藏与观看历史（含进度续播）。

## 功能特性

- **影视源插件**：插件是单个 `index.js` 文件，可本地多选安装或从 URL 安装；支持启用 / 禁用、配置项、独立存储与日志。
- **搜索**：按影视源分栏，只搜索当前激活的源，切换分栏才发起对应源的请求（结果按关键字缓存），可设置默认搜索源。
- **播放**：`react-player` 播放 + Media Chrome 自定义控制条；多线路切换、选集、上一集 / 下一集、播放结束自动连播。
- **播放行为**：进入页面不自动播放，切换线路不会打断正在播放的内容，只有点击集数才会解析地址并起播。
- **收藏 / 历史**：影片收藏与取消收藏；观看历史记录每集的播放进度，已看集数高亮标记，可一键「回到 mm:ss」续播。
- **导航**：顶栏窗口控制（最小化 / 最大化 / 关闭）+ 页面后退按钮（支持 `Alt + ←`）。
- **网络**：所有网络请求自动跟随系统代理（渲染进程的图片 / 视频，主进程的插件请求与插件下载）。

## 技术栈

| 层面   | 选型                                                                                         |
| ------ | -------------------------------------------------------------------------------------------- |
| 桌面壳 | Electron 39 + electron-vite 5（main / preload / renderer 三端构建）+ electron-builder        |
| 渲染层 | React 19、TanStack Router（文件路由）、Tailwind CSS v4、shadcn/ui（底层为 `@base-ui/react`） |
| 播放器 | react-player 3 + media-chrome 4                                                              |
| 数据   | Prisma 7 + SQLite（better-sqlite3 adapter），数据库文件在 `userData/data/dev.db`             |
| 插件   | 宿主 `PluginManager<SourceApi>`，沙箱内 `require` 白名单                                     |
| 工程   | TypeScript 5.9（strict）、oxlint、oxfmt、electron-log                                        |

## 快速开始

```bash
# 安装依赖
pnpm install

# 开发（热重载）
pnpm dev

# 类型检查（node / web / plugin 三份 tsconfig）
pnpm typecheck

# 代码检查与格式化
pnpm lint
pnpm fmt

# 预览构建产物
pnpm start
```

打包：

```bash
pnpm build:win     # Windows
pnpm build:mac     # macOS
pnpm build:linux   # Linux
pnpm build:unpack  # 仅产出未打包目录，便于排查
```

## 目录结构

```
src/
├── main/                 # 主进程
│   ├── api.ts            # IPC 接口注册（插件 / 数据库）
│   ├── logger.ts         # electron-log 宿主日志
│   ├── lib/db.ts         # Prisma 客户端与数据库路径
│   └── plugin/           # 插件系统：manager / sandbox / modules / config / storage …
├── preload/              # preload 与渲染端 API
├── renderer/src/
│   ├── routes/           # 文件路由：index(收藏) / search / player / history / plugin / about
│   ├── components/       # ui（shadcn）+ custom（业务组件）
│   └── lib/              # 搜索偏好、标签解析、日志等
├── shared/               # 主进程与渲染进程共享类型：plugin-api / db-api / ipc
doc/                      # 插件开发资料：开发指南 / 类型声明 / 空白模板
plugins/                  # 开发态插件加载目录
prisma/                   # schema.prisma 与迁移
```

## 影视源插件

### 安装

- 插件管理页支持「从本地安装」（多选 `.js` / `.cjs` 文件，逐项反馈结果）与「从 URL 安装」。
- 开发态插件目录是项目根 `plugins/`，打包后是 `userData/plugins/`，每个插件一个目录：
  `index.js` / `state.json` / `config.json` / `storage.json`。

### 开发资料

插件开发相关内容统一放在 [`doc/`](./doc)：

- [`doc/plugin-dev.md`](./doc/plugin-dev.md) —— 开发指南（清单字段、可调用方法、上下文能力、沙箱约束、调试）
- [`doc/plugin-api.d.ts`](./doc/plugin-api.d.ts) —— 插件类型声明（自包含、零依赖，放进 tsconfig 的 include 即可全局使用）
- [`doc/template.ts`](./doc/template.ts) —— 空白模板，不含任何站点信息，复制改名即可开始写

### 宿主侧要点

- 可调用方法白名单固定为 `search / getDetail / getPlayUrl`（`src/shared/plugin-api.ts`）。
- 插件可 `require` 的第三方库由宿主预置，唯一定义源是 `src/main/plugin/modules.ts`，当前包含：
  `cheerio`、`he`、`es-toolkit`、`node:crypto`（`crypto` 亦可）。
  新增一个库需要三步：装到 `dependencies` → 在 `modules.ts` 注册 → 加进 `electron.vite.config.ts` 的 `HOST_BUNDLED_MODULES`；
  Node 内置模块只需注册进 `modules.ts`。
- `require` 结果已做 ESM / CJS 归一化，`require("x")` 与 `require("x").default` 都指向同一份实现。
- 类型文件由宿主实现反向生成，宿主改动后需同步更新 `doc/plugin-api.d.ts`。

## 数据库

Prisma + SQLite，schema 见 `prisma/schema.prisma`（`.env` 里的 `DATABASE_URL` 仅用于迁移工具，运行时路径由主进程按 `userData` 计算）。

```bash
pnpm exec prisma migrate dev --name <变更名>   # 生成并应用迁移
pnpm exec prisma generate                      # 重新生成客户端类型
```

## 网络与代理

应用启动时把会话（session）显式设为「跟随系统代理」，实现见 `src/main/lib/proxy.ts`：

- **渲染进程**：海报图片、播放器（含 m3u8 分片）都走 Chromium 网络栈，自动使用系统代理，无需额外配置。
- **主进程**：插件的 `ctx.http.*` 与「从 URL 安装插件」统一走 `proxyFetch()` → `session.fetch`（同样是 Chromium 网络栈）。
  这里刻意不用 Node 的全局 `fetch`：undici 不读系统代理，会出现「浏览器能开、应用里一直超时」。
- Windows 读系统 / IE 代理设置（含 PAC 与「自动检测设置」），macOS 读网络偏好设置，Linux 读桌面环境设置与
  `http_proxy` / `https_proxy` 环境变量。
- 启动日志会打印一行 `已启用系统代理（示例解析结果：PROXY 127.0.0.1:7890 / DIRECT）`，排查网络问题时看它即可。
- 需要账号密码的企业代理目前只打印一条 warn 日志（应用不提供凭据输入），这类代理下的请求会被取消。

## 打包与发布

- **macOS 产物只能在 macOS 上构建**：`codesign` / `hdiutil` / dmg 都是 macOS 独有工具，
  electron-builder 在非 macOS 上跑 `--mac` 会直接报错，没有跨平台绕法。
  Windows 可在 Linux / macOS 上打（需 wine），Linux 产物需 docker，AppImage 只能在 Linux 上打。
- 因此仓库带了 [`.github/workflows/release.yml`](./.github/workflows/release.yml)：推 `v*` tag 触发，
  `macos-13` 出 x64、`macos-14` 出 arm64、`windows-latest` 出 nsis 安装包，最后自动创建 GitHub Release 并附上产物；
  也可以手动 Run workflow 只出产物（不建 Release）。
- CI 每个 job 都跑完整的 `pnpm install --frozen-lockfile` —— postinstall 里的 `electron-builder install-app-deps`
  负责为当前平台 + Electron ABI 重新编译 `better-sqlite3`（`npmRebuild: false`，打包阶段不再编译），
  所以跨平台打包时这一步不能跳过。
- 未签名未公证的 macOS 包在别人机器上会被 Gatekeeper 拦（"已损坏，无法打开"，首次需右键 → 打开）。
  正式分发请按下面「签名与公证」配好 CI secrets。

## 签名与公证

**一次性的 Apple 侧准备**（需要 Apple Developer Program 会员资格）：

1. 在 `developer.apple.com` → Certificates 建一个 **Developer ID Application** 证书，下载后导入钥匙串；
   再从钥匙串里把它连同私钥导出成 `.p12`（导出时设一个密码）。
2. 在 `appleid.apple.com` → Sign-In and Security → App-Specific Passwords 生成一个**App 专用密码**。
3. 在 `developer.apple.com` → Membership 里抄下 **Team ID**。
   （也可以改用 App Store Connect API Key：`APPLE_API_KEY` / `APPLE_API_KEY_ID` / `APPLE_API_ISSUER_ID`。）

**填进 GitHub Secrets**（仓库 Settings → Secrets and variables → Actions）：

```bash
# .p12 转 base64 单行字符串，值贴进 CSC_LINK
base64 -w0 DeveloperID.p12 | gh secret set CSC_LINK
gh secret set CSC_KEY_PASSWORD      # 导出 .p12 时设的密码
gh secret set APPLE_ID              # Apple 开发者账号邮箱
gh secret set APPLE_APP_SPECIFIC_PASSWORD
gh secret set APPLE_TEAM_ID
# Windows 可选：代码签名证书（.pfx/.p12 的 base64）
gh secret set WIN_CSC_LINK
gh secret set WIN_CSC_KEY_PASSWORD
```

**仓库侧已经就位的部分**（无需再改）：

- `electron-builder.yml`：`hardenedRuntime: true` + `build/entitlements.mac.plist`（公证的硬性前置条件），
  `gatekeeperAssess: false`，`notarize: false`（本地打包不会因为缺凭据直接失败）。
- `@electron/notarize` 已加进 devDependencies —— electron-builder 不自带它，公证时从项目里 `require`，
  缺了会直接报 module not found。
- `release.yml` 的 mac job：配齐 `CSC_LINK` + `APPLE_ID` + `APPLE_TEAM_ID` 时自动追加
  `--config.mac.notarize=true`；没配就只出产物并打一条 warning。

本地想验证签名结果（需已装证书的本机）：

```bash
pnpm build:mac
codesign -dv --verbose=4 dist/mac/蓝星影视.app   # 看签名链
spctl -a -t exec -vv dist/mac/蓝星影视.app        # 看 Gatekeeper 评估
```

公证是异步的：CI 里 electron-builder 会阻塞等待 Apple 返回结果并自动 staple
（断网机器首次打开时也能通过），通常 1–5 分钟。

## 约定

- 日志统一走 electron-log（主进程 `src/main/logger.ts` 的 `hostLog`，渲染端 `src/renderer/src/lib/logger.ts` 的 `rendererLog`），不使用 `console.*`。
- 渲染层异步加载统一写成 `useEffect` 内 `void (async () => { ... if (cancelled) return; setState() })()`；异步结果以 `key = plugin::id` 判定是否过期。
- 「选中项」优先用 `useMemo` 派生，而不是在 effect 里 setState（oxlint 开启了 `react(set-state-in-effect)`）。
