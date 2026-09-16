import type { WindowController, PluginsApi } from "./ipc"
import type { SourceApi } from "./plugin-api"

export interface ElectronAPI {
  window: WindowController
  plugins: PluginsApi<SourceApi>
}
