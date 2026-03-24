import { pgTable, text, integer, index, primaryKey, jsonb, timestamp } from "drizzle-orm/pg-core"
import type { ProjectID } from "../project/schema"
import type { SessionID, MessageID, PartID } from "../session/schema"
import type { WorkspaceID } from "../control-plane/schema"
import type { AccountID, AccessToken, RefreshToken, OrgID } from "../account/schema"
import type { MessageV2 } from "../session/message-v2"
import type { Snapshot } from "../snapshot"
import type { PermissionNext } from "../permission/next"

type PartData = Omit<MessageV2.Part, "id" | "sessionID" | "messageID">
type InfoData = Omit<MessageV2.Info, "id" | "sessionID">

const Timestamps = {
  time_created: timestamp().notNull().defaultNow(),
  time_updated: timestamp()
    .notNull()
    .$onUpdate(() => new Date()),
}

export const ProjectTable = pgTable("project", {
  id: text().$type<ProjectID>().primaryKey(),
  worktree: text().notNull(),
  vcs: text(),
  name: text(),
  icon_url: text(),
  icon_color: text(),
  ...Timestamps,
  time_initialized: timestamp(),
  sandboxes: jsonb().notNull().$type<string[]>(),
  commands: jsonb().$type<{ start?: string }>(),
})

export const SessionTable = pgTable(
  "session",
  {
    id: text().$type<SessionID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    workspace_id: text().$type<WorkspaceID>(),
    parent_id: text().$type<SessionID>(),
    slug: text().notNull(),
    directory: text().notNull(),
    title: text().notNull(),
    version: text().notNull(),
    share_url: text(),
    summary_additions: integer(),
    summary_deletions: integer(),
    summary_files: integer(),
    summary_diffs: jsonb().$type<Snapshot.FileDiff[]>(),
    revert: jsonb().$type<{ messageID: MessageID; partID?: PartID; snapshot?: string; diff?: string }>(),
    permission: jsonb().$type<PermissionNext.Ruleset>(),
    ...Timestamps,
    time_compacting: timestamp(),
    time_archived: timestamp(),
  },
  (table) => [
    index("session_project_idx").on(table.project_id),
    index("session_workspace_idx").on(table.workspace_id),
    index("session_parent_idx").on(table.parent_id),
  ],
)

export const MessageTable = pgTable(
  "message",
  {
    id: text().$type<MessageID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    ...Timestamps,
    data: jsonb().notNull().$type<InfoData>(),
  },
  (table) => [index("message_session_time_created_id_idx").on(table.session_id, table.time_created, table.id)],
)

export const PartTable = pgTable(
  "part",
  {
    id: text().$type<PartID>().primaryKey(),
    message_id: text()
      .$type<MessageID>()
      .notNull()
      .references(() => MessageTable.id, { onDelete: "cascade" }),
    session_id: text().$type<SessionID>().notNull(),
    ...Timestamps,
    data: jsonb().notNull().$type<PartData>(),
  },
  (table) => [
    index("part_message_id_id_idx").on(table.message_id, table.id),
    index("part_session_idx").on(table.session_id),
  ],
)

export const TodoTable = pgTable(
  "todo",
  {
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    content: text().notNull(),
    status: text().notNull(),
    priority: text().notNull(),
    position: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.session_id, table.position] }),
    index("todo_session_idx").on(table.session_id),
  ],
)

export const PermissionTable = pgTable("permission", {
  project_id: text()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  ...Timestamps,
  data: jsonb().notNull().$type<PermissionNext.Ruleset>(),
})

export const WorkspaceTable = pgTable("workspace", {
  id: text().$type<WorkspaceID>().primaryKey(),
  type: text().notNull(),
  branch: text(),
  name: text(),
  directory: text(),
  extra: jsonb(),
  project_id: text()
    .$type<ProjectID>()
    .notNull()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
})

export const AccountTable = pgTable("account", {
  id: text().$type<AccountID>().primaryKey(),
  email: text().notNull(),
  url: text().notNull(),
  access_token: text().$type<AccessToken>().notNull(),
  refresh_token: text().$type<RefreshToken>().notNull(),
  token_expiry: integer(),
  ...Timestamps,
})

export const AccountStateTable = pgTable("account_state", {
  id: integer().primaryKey(),
  active_account_id: text()
    .$type<AccountID>()
    .references(() => AccountTable.id, { onDelete: "set null" }),
  active_org_id: text().$type<OrgID>(),
})

export const SessionShareTable = pgTable("session_share", {
  session_id: text()
    .primaryKey()
    .references(() => SessionTable.id, { onDelete: "cascade" }),
  id: text().notNull(),
  secret: text().notNull(),
  url: text().notNull(),
  ...Timestamps,
})

export const schema = {
  ProjectTable,
  SessionTable,
  MessageTable,
  PartTable,
  TodoTable,
  PermissionTable,
  WorkspaceTable,
  AccountTable,
  AccountStateTable,
  SessionShareTable,
}
