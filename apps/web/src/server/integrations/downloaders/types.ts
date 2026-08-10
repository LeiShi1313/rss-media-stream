import type { DownloaderTestDto } from "@rss-media/shared/apiContracts";

export type TorrentSnapshot = {
  id: string;
  name: string;
  progress: number;
  state: string;
  downloadSpeed?: number;
  uploadSpeed?: number;
  ratio?: number;
};

export type DownloaderClient = {
  test(): Promise<DownloaderTestDto>;
  addTorrent(
    data: Buffer,
    options: { savePath?: string | null; category?: string | null; tags?: string[] | null }
  ): Promise<{ hash?: string }>;
  listTorrents(): Promise<TorrentSnapshot[]>;
};

export type DownloaderClientConfig = {
  type: "QBITTORRENT" | "TRANSMISSION";
  baseUrl: string;
  username?: string | null;
  encryptedPassword?: string | null;
  defaultSavePath?: string | null;
  category?: string | null;
  tags?: string[] | null;
};
