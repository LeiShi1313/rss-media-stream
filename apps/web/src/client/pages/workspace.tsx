import { Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { User, Workspace, WorkspaceMember } from "../api.js";
import { Empty, Pill } from "../components/common/feedback.js";
import { Panel } from "../components/common/surfaces.js";

export function WorkspacePage({
  user,
  workspace,
  members,
  stats
}: {
  user: User;
  workspace: Workspace | null;
  members: WorkspaceMember[];
  stats: {
    feeds: number;
    subscriptions: number;
    downloaders: number;
    failedJobs: number;
  };
}) {
  const { t } = useTranslation();
  return (
    <div className="page-stack">
      <section className="workspace-band">
        <div>
          <span className="section-kicker">{t("workspace.current")}</span>
          <h3>{workspace?.name ?? t("nav.workspace")}</h3>
          <p>{user.name} · {user.email}</p>
        </div>
        <div className="workspace-stats">
          <Pill>{workspace?.role ?? "MEMBER"}</Pill>
          <Pill>{t("workspace.feeds", { count: stats.feeds })}</Pill>
          <Pill>{t("workspace.subscriptions", { count: stats.subscriptions })}</Pill>
          <Pill>{t("workspace.downloaders", { count: stats.downloaders })}</Pill>
          {stats.failedJobs > 0 && <Pill>{t("workspace.failedJobs", { count: stats.failedJobs })}</Pill>}
        </div>
      </section>
      <Panel title={t("workspace.members")} icon={<Users size={19} />}>
        <div className="list">
          {members.length === 0 && <Empty label={t("workspace.noMembers")} />}
          {members.map((member) => (
            <article className="row-card member-card" key={member.userId}>
              <div>
                <strong>{member.name}</strong>
                <span>{member.email}</span>
              </div>
              <Pill>{member.role}</Pill>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
