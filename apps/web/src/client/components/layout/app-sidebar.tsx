import {
  Activity,
  Film,
  Globe2,
  HardDrive,
  ListFilter,
  LogOut,
  Rss,
  Settings,
  Users,
  type LucideIcon
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { PageId } from "../../types.js";
import { IconSelectMenu, UiButton, type SelectOption } from "../ui/index.js";

const navigationItems: ReadonlyArray<{
  page: PageId;
  labelKey: `nav.${PageId}`;
  icon: LucideIcon;
}> = [
  { page: "overview", labelKey: "nav.overview", icon: Activity },
  { page: "rss", labelKey: "nav.rss", icon: Rss },
  { page: "downloaders", labelKey: "nav.downloaders", icon: HardDrive },
  { page: "subscriptions", labelKey: "nav.subscriptions", icon: Film },
  { page: "activity", labelKey: "nav.activity", icon: ListFilter },
  { page: "workspace", labelKey: "nav.workspace", icon: Users },
  { page: "settings", labelKey: "nav.settings", icon: Settings }
];

const languageOptions: SelectOption[] = [
  { value: "en-US", label: "EN" },
  { value: "zh-CN", label: "中文" }
];

export function AppSidebar({
  activePage,
  accountEmail,
  contextLabel,
  language,
  onLanguageChange,
  onLogout
}: {
  activePage: PageId;
  accountEmail: string;
  contextLabel: string;
  language: string;
  onLanguageChange: (value: string) => void;
  onLogout: () => void;
}) {
  const { t } = useTranslation();

  return (
    <aside className="app-sidebar">
      <div className="app-sidebar-brand brand-row">
        <Rss aria-hidden="true" size={26} />
        <div>
          <strong className="app-sidebar-product">{t("app.brandShort")}</strong>
          <p>{contextLabel}</p>
        </div>
      </div>

      <nav aria-label={t("nav.primary")} className="app-sidebar-nav">
        {navigationItems.map(({ page, labelKey, icon: Icon }) => {
          const active = activePage === page;
          return (
            <a
              aria-current={active ? "page" : undefined}
              className={active ? "active" : undefined}
              href={`#${page}`}
              key={page}
            >
              <Icon aria-hidden="true" size={18} />
              <span>{t(labelKey)}</span>
            </a>
          );
        })}
      </nav>

      <footer className="app-sidebar-footer">
        <div className="app-sidebar-account">
          <div className="app-sidebar-account-row">
            <span className="app-sidebar-email" title={accountEmail}>{accountEmail}</span>
            <IconSelectMenu
              align="end"
              className="icon-button app-sidebar-language"
              icon={<Globe2 aria-hidden="true" size={18} />}
              label={t("common.language")}
              onValueChange={onLanguageChange}
              options={languageOptions}
              side="top"
              value={language}
            />
          </div>
          <UiButton
            aria-label={t("app.signOut")}
            className="ghost app-sidebar-signout"
            onClick={onLogout}
            title={t("app.signOut")}
          >
            <LogOut aria-hidden="true" size={18} />
            <span className="app-sidebar-signout-label">{t("app.signOut")}</span>
          </UiButton>
        </div>
      </footer>
    </aside>
  );
}
