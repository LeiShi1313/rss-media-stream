import { Film } from "lucide-react";

export function PosterFallback({ title }: { title: string }) {
  return (
    <span className="poster-fallback">
      <Film size={26} />
      <b>{initials(title)}</b>
    </span>
  );
}

function initials(value: string) {
  const words = value.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase()).join("") || "RM";
}
