import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Plus, Search } from "lucide-react";
import type { DownloaderDto, FeedDto, ItemDto, SubscriptionDto } from "@rss-media/shared/apiContracts";
import type { RunAction } from "../types.js";
import { Empty } from "../components/common/feedback.js";
import {
  SubscriptionEditorDialog,
  type SubscriptionEditorSession
} from "../components/subscriptions/subscription-editor-dialog.js";
import { FieldLabel, FormInput, UiButton } from "../components/ui/index.js";
import { filterByQuery, ruleSummary } from "../lib/forms.js";

export function SubscriptionsPage({
  busy,
  downloaders,
  feeds,
  items,
  subscriptions,
  runAction
}: {
  busy: boolean;
  downloaders: DownloaderDto[];
  feeds: FeedDto[];
  items: ItemDto[];
  subscriptions: SubscriptionDto[];
  runAction: RunAction;
}) {
  const { t } = useTranslation();
  const [editorSession, setEditorSession] = useState<SubscriptionEditorSession | null>(null);
  const [query, setQuery] = useState("");
  const filteredSubscriptions = useMemo(
    () => filterByQuery(subscriptions, query, (subscription) => [
      subscription.title,
      subscriptionTarget(subscription, t),
      ruleSummary(subscription, t),
      subscription.downloader?.name,
      subscriptionMode(subscription, t)
    ]),
    [query, subscriptions, t]
  );
  const editorKey = editorSession?.kind === "edit"
    ? `edit:${editorSession.subscription.id}`
    : "create";

  return (
    <div className="management-workbench">
      <section className="management-command" aria-label={t("subscriptions.rules")}>
        <div className="management-command-left">
          <FieldLabel className="search-control management-search">
            <span className="sr-only">{t("subscriptions.searchSubscriptions")}</span>
            <Search size={16} />
            <FormInput
              aria-label={t("subscriptions.searchSubscriptions")}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("subscriptions.searchSubscriptions")}
              type="search"
              value={query}
            />
          </FieldLabel>
          <span className="management-count">{t("subscriptions.subscriptionCount", { count: subscriptions.length })}</span>
        </div>
        <UiButton
          className="primary"
          disabled={busy}
          onClick={() => setEditorSession({ kind: "create" })}
        >
          <Plus size={17} />
          {t("subscriptions.create")}
        </UiButton>
      </section>

      <section className="management-table" role="table" aria-label={t("subscriptions.rules")}>
        <div className="management-table-head subscription-table-head" role="row">
          <span role="columnheader">{t("subscriptions.subscription")}</span>
          <span role="columnheader">{t("subscriptions.target")}</span>
          <span role="columnheader">{t("subscriptions.rule")}</span>
          <span role="columnheader">{t("common.downloader")}</span>
          <span role="columnheader">{t("subscriptions.mode")}</span>
          <span role="columnheader">{t("subscriptions.actions")}</span>
        </div>
        {subscriptions.length === 0 && <Empty label={t("subscriptions.none")} />}
        {subscriptions.length > 0 && filteredSubscriptions.length === 0 && (
          <Empty label={t("subscriptions.noMatchingSubscriptions")} />
        )}
        {filteredSubscriptions.map((subscription) => (
          <article className="management-table-row subscription-table-row" key={subscription.id} role="row">
            <div className="management-primary-cell" role="cell">
              <strong>{subscription.title}</strong>
              <span>{subscription.enabled ? t("common.enabled") : t("common.disabled")}</span>
            </div>
            <span role="cell">{subscriptionTarget(subscription, t)}</span>
            <span role="cell">{ruleSummary(subscription, t)}</span>
            <span role="cell">{subscription.downloader?.name ?? t("common.defaultDownloader")}</span>
            <span role="cell">{subscriptionMode(subscription, t)}</span>
            <div className="row-actions" role="cell">
              <UiButton
                aria-label={t("subscriptions.editSubscriptionNamed", { name: subscription.title })}
                className="icon-button"
                disabled={busy}
                onClick={() => setEditorSession({ kind: "edit", subscription })}
                title={t("common.edit")}
              >
                <Pencil size={16} />
              </UiButton>
            </div>
          </article>
        ))}
      </section>

      {editorSession && (
        <SubscriptionEditorDialog
          key={editorKey}
          busy={busy}
          downloaders={downloaders}
          feeds={feeds}
          items={items}
          onClose={() => setEditorSession(null)}
          runAction={runAction}
          session={editorSession}
          subscriptions={subscriptions}
        />
      )}
    </div>
  );
}

function subscriptionTarget(subscription: SubscriptionDto, t: (key: string) => string) {
  return subscription.media?.title ??
    subscription.rule?.selectedProvider?.providerId ??
    subscription.rule?.titleRegex ??
    t("subscriptions.ruleOnly");
}

function subscriptionMode(subscription: SubscriptionDto, t: (key: string) => string) {
  const ruleMode = subscription.rule?.mode === "REGEX"
    ? t("subscriptions.regexMode")
    : t("subscriptions.mediaTitleMode");
  return `${ruleMode} · ${subscription.autoDownload ? t("common.auto") : t("common.manual")}`;
}
