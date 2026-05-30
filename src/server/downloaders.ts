import type { Downloader } from "@prisma/client";
import { redactSecrets } from "../shared/redact.js";
import type { AppConfig } from "./config.js";
import { decryptSecret } from "./secrets.js";

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
  test(): Promise<{ ok: true; version?: string }>;
  addTorrent(data: Buffer, options: { savePath?: string | null; category?: string | null; tags?: string | null }): Promise<{ hash?: string }>;
  listTorrents(): Promise<TorrentSnapshot[]>;
};

export function createDownloaderClient(
  downloader: Downloader,
  config: AppConfig
): DownloaderClient {
  if (downloader.type === "QBITTORRENT") {
    return new QBittorrentClient(downloader, config);
  }
  return new TransmissionClient(downloader, config);
}

class QBittorrentClient implements DownloaderClient {
  private cookie = "";

  constructor(
    private readonly downloader: Downloader,
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
    options: { savePath?: string | null; category?: string | null; tags?: string | null }
  ) {
    await this.login();
    const form = new FormData();
    form.set("torrents", new Blob([new Uint8Array(data)]), "release.torrent");
    if (options.savePath) form.set("savepath", options.savePath);
    if (options.category) form.set("category", options.category);
    if (options.tags) form.set("tags", options.tags);
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

class TransmissionClient implements DownloaderClient {
  private sessionId = "";

  constructor(
    private readonly downloader: Downloader,
    private readonly config: AppConfig
  ) {}

  async test() {
    const body = await this.rpc("session-get", {});
    return { ok: true as const, version: body.arguments?.version };
  }

  async addTorrent(
    data: Buffer,
    options: { savePath?: string | null; category?: string | null; tags?: string | null }
  ) {
    const body = await this.rpc("torrent-add", {
      metainfo: data.toString("base64"),
      "download-dir": options.savePath || undefined,
      labels: options.tags ? options.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined
    });
    return { hash: body.arguments?.["torrent-added"]?.hashString };
  }

  async listTorrents() {
    const body = await this.rpc("torrent-get", {
      fields: ["hashString", "name", "percentDone", "status", "rateDownload", "rateUpload", "uploadRatio"]
    });
    const torrents = (body.arguments?.torrents ?? []) as Array<{
      hashString: string;
      name: string;
      percentDone: number;
      status: number;
      rateDownload: number;
      rateUpload: number;
      uploadRatio: number;
    }>;
    return torrents.map((torrent) => ({
      id: torrent.hashString,
      name: torrent.name,
      progress: torrent.percentDone,
      state: transmissionState(torrent.status),
      downloadSpeed: torrent.rateDownload,
      uploadSpeed: torrent.rateUpload,
      ratio: torrent.uploadRatio
    }));
  }

  private async rpc(
    method: string,
    args: Record<string, unknown>
  ): Promise<{ result: string; arguments?: Record<string, any> }> {
    const password = this.downloader.encryptedPassword
      ? decryptSecret(this.downloader.encryptedPassword, this.config.appSecret)
      : "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json"
    };
    if (this.sessionId) headers["X-Transmission-Session-Id"] = this.sessionId;
    if (this.downloader.username || password) {
      headers.Authorization = `Basic ${Buffer.from(
        `${this.downloader.username ?? ""}:${password}`
      ).toString("base64")}`;
    }

    const response = await fetch(this.url(), {
      method: "POST",
      headers,
      body: JSON.stringify({ method, arguments: args })
    });
    if (response.status === 409) {
      this.sessionId = response.headers.get("x-transmission-session-id") ?? "";
      return this.rpc(method, args);
    }
    if (!response.ok) {
      throw new Error(
        redactSecrets(`Transmission RPC failed with ${response.status}: ${await response.text()}`)
      );
    }
    const body = (await response.json()) as { result: string; arguments?: Record<string, any> };
    if (body.result !== "success") throw new Error(`Transmission RPC failed: ${body.result}`);
    return body;
  }

  private url() {
    return new URL("/transmission/rpc", ensureSlash(this.downloader.baseUrl)).toString();
  }
}

function ensureSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function transmissionState(status: number): string {
  return (
    {
      0: "stopped",
      1: "check-wait",
      2: "checking",
      3: "download-wait",
      4: "downloading",
      5: "seed-wait",
      6: "seeding"
    }[status] ?? "unknown"
  );
}
