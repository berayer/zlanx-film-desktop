import { app, shell, BrowserWindow } from "electron"
import { join } from "path"
import { electronApp, optimizer, is } from "@electron-toolkit/utils"
import icon from "../../resources/icon.png?asset"
import { hostLog } from "@main/logger"
import { initPluginManager, registerPluginIpc } from "@main/plugin/index"
import { registerApi } from "@main/api"
import { prisma } from "@main/lib/db"

/** 应用级日志器（作用域 `app`，底层 electron-log） */
const log = hostLog.scope("app")

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
    },
    frame: false,
  })

  mainWindow.on("ready-to-show", () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: "deny" }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"])
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron")

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window)
    // cSpell: words registerFramelessWindowIpc
    optimizer.registerFramelessWindowIpc()
  })

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
