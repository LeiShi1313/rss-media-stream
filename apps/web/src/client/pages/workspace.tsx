import { Activity, HardDrive, Rss, Users } from "lucide-react";
import type { User, Workspace, WorkspaceMember } from "../api.js";
import { Empty, StatusPill } from "../components/common/feedback.js";
import { Metric, Panel } from "../components/common/surfaces.js";

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
  return (
    <div className="page-stack">
      <section className="workspace-band">
        <div>
          <span className="section-kicker">Current workspace</span>
          <h3>{workspace?.name ?? "Workspace"}</h3>
          <p>{user.name} · {user.email}</p>
        </div>
        <div className="workspace-stats">
          <Pill>{workspace?.role ?? "MEMBER"}</Pill>
          <Pill>{stats.feeds} feeds</Pill>
          <Pill>{stats.subscriptions} subscriptions</Pill>
          <Pill>{stats.downloaders} downloaders</Pill>
          {stats.failedJobs > 0 && <Pill>{stats.failedJobs} failed jobs</Pill>}
        </div>
      </section>
      <Panel title="Members" icon={<Users size={19} />}>
        <div className="list">
          {members.length === 0 && <Empty label="No members loaded" />}
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

