import type { WindowController, PluginsApi } from "./ipc"
import type { SourceApi } from "./plugin-api"
import type { DB_API } from "./db-api"

export interface ElectronAPI {
  window: WindowController
  plugins: PluginsApi<SourceApi>
  api: DB_API
}
