import { DownloadCloud } from "lucide-react";
import { useEffect, useState } from "react";
import type { Downloader } from "../../api.js";
import { SelectField, UiButton } from "../ui/index.js";

export function ManualDownload({
  disabled,
  downloaders,
  onDownload
}: {
  disabled: boolean;
  downloaders: Downloader[];
  onDownload: (downloaderId: string) => void;
}) {
  const [downloaderId, setDownloaderId] = useState("");
  useEffect(() => {
    if (!downloaderId && downloaders[0]) setDownloaderId(downloaders[0].id);
  }, [downloaders, downloaderId]);
  return (
    <div className="download-control">
      <SelectField
        value={downloaderId}
        onValueChange={setDownloaderId}
        disabled={disabled}
        options={downloaders.map((downloader) => ({ value: downloader.id, label: downloader.name }))}
        placeholder="Downloader"
      />
      <UiButton className="primary" disabled={disabled || !downloaderId} onClick={() => onDownload(downloaderId)}>
        <DownloadCloud size={17} />
        Send
      </UiButton>
    </div>
  );
}
