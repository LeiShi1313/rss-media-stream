import { redactSecrets } from "@rss-media/shared/redact";
import type { AppConfig } from "../../config.js";
import { decryptSecret } from "../../secrets.js";
import { ensureSlash, normalizeTags } from "./helpers.js";
import type { DownloaderClient, DownloaderClientConfig } from "./types.js";

export class TransmissionClient implements DownloaderClient {
  private sessionId = "";

  constructor(
    private readonly downloader: DownloaderClientConfig,
    private readonly config: AppConfig
  ) {}

  async test() {
    const body = await this.rpc("session-get", {});
    return { ok: true as const, version: body.arguments?.version };
  }

  async addTorrent(
    data: Buffer,
    options: { savePath?: string | null; category?: string | null; tags?: string[] | null }
  ) {
    const tags = normalizeTags(options.tags);
    const body = await this.rpc("torrent-add", {
      metainfo: data.toString("base64"),
      "download-dir": options.savePath || undefined,
      labels: tags ? tags.split(",").map((tag) => tag.trim()).filter(Boolean) : undefined
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
