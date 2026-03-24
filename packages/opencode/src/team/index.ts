// Team coordination system for OpenCode
// Enables multi-agent teams with messaging, task coordination, and state management

export { Team } from "./schema"
export { TeamRegistry } from "./registry"
export { TeamInbox } from "./inbox"
export { TeamTasks } from "./tasks"
export { TeamSession } from "./session"
export { TeamRecovery } from "./recovery"
export { TeamAutowake } from "./autowake"
export {
  TeamIsolation,
  TEAM_TOOLS,
  SUBAGENT_ALLOWED_TOOLS,
} from "./isolation"
export {
  TeamCreateTool,
  TeamMessageTool,
  TeamBroadcastTool,
  TeamCheckInboxTool,
  TeamMarkReadTool,
  TeamCreateTaskTool,
  TeamClaimTaskTool,
  TeamCompleteTaskTool,
  TeamListTasksTool,
  TeamShutdownTool,
  TeamCleanupTool,
  TeamTools,
} from "./tools"
export type {
  RoleTemplate,
  TeamPresetId,
} from "./templates"
export {
  RoleTemplates,
  getRoleTemplate,
  createMemberConfig,
  TeamPresets,
  createTeamFromPreset,
  ExploreTemplate,
  PlannerTemplate,
  GeneralPurposeTemplate,
  CodeReviewerTemplate,
  TesterTemplate,
  DocumentationTemplate,
  SecurityReviewerTemplate,
  ArchitectTemplate,
  BackendDevTemplate,
  TradingLogicDevTemplate,
} from "./templates"
export type {
  ModelConfig,
} from "./model-router"
export {
  parseModelString,
  getMemberModel,
  resolveMemberModel,
  getRecommendedModel,
  ModelRecommendations,
} from "./model-router"
