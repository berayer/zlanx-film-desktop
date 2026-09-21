import { app, shell, BrowserWindow } from "electron"
import { join } from "path"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import icon from "../../resources/icon.png?asset"
import { hostLog } from "@main/logger"
import { initPluginManager, registerPluginIpc } from "@main/plugin/index"
import { registerApi } from "@main/api"
import { runMigrations } from "@main/lib/migrate"
import { prisma } from "@main/lib/db"

/** 应用级日志器（作用域 `app`，底层 electron-log） */
const log = hostLog.scope("app")

/** 主窗口引用：重复启动时用它把已有窗口拉到前台 */
let mainWindow: BrowserWindow | undefined

/** 主窗口是否已经展示过（首次 ready-to-show 之后才置 true） */
let mainWindowShown = false

/**
 * 把已有主窗口拉到前台。
 *
 * @returns 是否命中了可用窗口；返回 false 说明窗口还没建好或已销毁，
 *   此时什么都不做（等它自己 ready-to-show 弹出即可）。
 */
function focusMainWindow(): boolean {
  const target =
    mainWindow && !mainWindow.isDestroyed()
      ? mainWindow
      : BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())

  if (!target) {
    return false
  }

  // 最小化后可能被隐藏到系统托盘 / 任务栏，先还原再聚焦；
  // macOS 上还需要 dock 的 show，否则窗口仍在其它的 Space 里。
  if (target.isMinimized()) {
    target.restore()
  }
  if (!target.isVisible()) {
    target.show()
  }
  if (process.platform === "darwin") {
    app.show()
  }
  target.focus()
  return true
}

function createWindow(): void {
  // Create the browser window.
  const window = new BrowserWindow({
    width: 1200,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    icon,
    // ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
    frame: false,
  })

  mainWindow = window

  window.on("closed", () => {
    mainWindow = undefined
    mainWindowShown = false
  })

  window.on("ready-to-show", () => {
    window.show()
    mainWindowShown = true
  })

  window.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    window.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

/**
 * 单实例：同一时间只允许一个应用进程。
 *
 * `requestSingleInstanceLock` 要在 app ready 之前调用。拿到锁的实例才是「主实例」，
 * Electron 会把后续每次启动都通知到它的 `second-instance`，由它把已有窗口拉到前台；
 * 没拿到锁的进程在打包态直接退出即可。
 *
 * 开发态例外：electron-vite 改主进程代码时会 kill 旧进程再拉新的，偶发拿不到锁，
 * 这时如果也退出就会表现为「改完代码应用起不来」，所以只警告并继续。
 */
const primaryInstance = app.requestSingleInstanceLock()

if (!primaryInstance && !is.dev) {
  log.info("已有实例正在运行，本次启动退出")
  app.quit()
} else {
  if (!primaryInstance) {
    log.warn("开发态未取得单实例锁（可能是 dev 重启），继续启动，本次不做实例转发")
  }

  /**
   * 用户再次双击图标 / 从命令行启动时触发：把已有窗口拉到前台。
   *
   * 窗口还在加载（未 ready-to-show）时什么都不做，避免强行 show 闪一帧白屏 ——
   * 它加载完自己就会弹出来。
   */
  app.on("second-instance", (_event, argv) => {
    const args = argv.slice(1).join(" ")
    if (!mainWindowShown) {
      log.info(`检测到重复启动${args ? `（参数：${args}）` : ""}，窗口尚未就绪，忽略`)
      return
    }
    log.info(`检测到重复启动${args ? `（参数：${args}）` : ""}，聚焦已有窗口`)
    focusMainWindow()
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId("zlanx.film.desktop")

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on("browser-window-created", (_, window) => {
      optimizer.watchWindowShortcuts(window)
      // cSpell: words registerFramelessWindowIpc
      optimizer.registerFramelessWindowIpc()
    })

    // 先把库结构补齐到最新：执行 prisma/migrations 里还没跑过的 SQL。
    // 放在注册 IPC / 开窗之前，保证任何数据库访问拿到的都是最新 schema。
    try {
      const applied = runMigrations()
      if (applied > 0) {
        log.info(`数据库迁移完成，本次应用 ${applied} 个迁移`)
      }
    } catch (error: unknown) {
      // 不让迁移失败把整个应用带崩，后续数据库操作会各自报错
      log.error(`数据库迁移失败：${error instanceof Error ? error.message : String(error)}`)
    }

    /** 加载所有插件：initPluginManager 内部已经完成扫描与加载，这里不再重复 init */
    const plugins = await initPluginManager()
    registerPluginIpc(plugins)
    registerApi()

    createWindow()

    log.info(
      `应用已启动（v${app.getVersion()}，${is.dev ? "dev" : "prod"}），日志文件：${hostLog.transports.file.getFile().path}`,
    )

    app.on("activate", function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit()
  }
})

// 退出前断开 SQLite 连接，避免连接残留时数据文件被占用
app.on("before-quit", () => {
  void prisma.$disconnect().catch((error: unknown) => {
    log.warn(`关闭数据库连接失败：${error instanceof Error ? error.message : String(error)}`)
  })
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
