export type TimelinePoint = { time: string; count: number };
export type PageId = "overview" | "rss" | "downloaders" | "subscriptions" | "activity" | "workspace" | "settings";
export type ActionResult = { ok: true } | { ok: false; message: string };
export type RunAction = (action: () => Promise<unknown>) => Promise<ActionResult>;

export const pageIds: PageId[] = ["overview", "rss", "downloaders", "subscriptions", "activity", "workspace", "settings"];
