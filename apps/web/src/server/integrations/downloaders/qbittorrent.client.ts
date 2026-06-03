import type { AppConfig } from "../../config.js";
import { decryptSecret } from "../../secrets.js";
import { ensureSlash, normalizeTags } from "./helpers.js";
import type { DownloaderClient, DownloaderClientConfig } from "./types.js";

export class QBittorrentClient implements DownloaderClient {
  private cookie = "";

  constructor(
    private readonly downloader: DownloaderClientConfig,
    private readonly config: AppConfig
  ) {}

  async test() {
    await this.login();
    const response = await fetch(this.url("/api/v2/app/version"), {
      headers: this.headers()
    });
    if (!response.ok) throw new Error(`qBittorrent test failed with ${response.status}`);
    return { ok: true as const, version: await response.text() };
  }

  async addTorrent(
    data: Buffer,
    options: { savePath?: string | null; category?: string | null; tags?: string[] | null }
  ) {
    await this.login();
    const form = new FormData();
    form.set("torrents", new Blob([new Uint8Array(data)]), "release.torrent");
    if (options.savePath) form.set("savepath", options.savePath);
    if (options.category) form.set("category", options.category);
    const tags = normalizeTags(options.tags);
    if (tags) form.set("tags", tags);
    const response = await fetch(this.url("/api/v2/torrents/add"), {
      method: "POST",
      headers: this.headers(),
      body: form
    });
    if (!response.ok) {
      throw new Error(`qBittorrent add failed with ${response.status}: ${await response.text()}`);
    }
    return {};
  }

  async listTorrents() {
    await this.login();
    const response = await fetch(this.url("/api/v2/torrents/info"), {
      headers: this.headers()
    });
    if (!response.ok) throw new Error(`qBittorrent list failed with ${response.status}`);
    const torrents = (await response.json()) as Array<{
      hash: string;
      name: string;
      progress: number;
      state: string;
      dlspeed: number;
      upspeed: number;
      ratio: number;
    }>;
    return torrents.map((torrent) => ({
      id: torrent.hash,
      name: torrent.name,
      progress: torrent.progress,
      state: torrent.state,
      downloadSpeed: torrent.dlspeed,
      uploadSpeed: torrent.upspeed,
      ratio: torrent.ratio
    }));
  }

  private async login() {
    if (this.cookie) return;
    const password = this.downloader.encryptedPassword
      ? decryptSecret(this.downloader.encryptedPassword, this.config.appSecret)
      : "";
    const body = new URLSearchParams({
      username: this.downloader.username ?? "",
      password
    });
    const response = await fetch(this.url("/api/v2/auth/login"), {
      method: "POST",
      body
    });
    if (!response.ok) {
      throw new Error(`qBittorrent login failed with ${response.status}`);
    }
    this.cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  }

  private headers(): Record<string, string> {
    return this.cookie ? { Cookie: this.cookie } : {};
  }

  private url(path: string) {
    return new URL(path, ensureSlash(this.downloader.baseUrl)).toString();
  }
}
