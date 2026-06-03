import type { AppConfig } from "../../config.js";
import { QBittorrentClient } from "./qbittorrent.client.js";
import { TransmissionClient } from "./transmission.client.js";
import type { DownloaderClient, DownloaderClientConfig } from "./types.js";

export type { DownloaderClient, DownloaderClientConfig, TorrentSnapshot } from "./types.js";

export function createDownloaderClient(
  downloader: DownloaderClientConfig,
  config: AppConfig
): DownloaderClient {
  if (downloader.type === "QBITTORRENT") {
    return new QBittorrentClient(downloader, config);
  }
  return new TransmissionClient(downloader, config);
}
