// Team coordination system for OpenCode
// Enables multi-agent teams with messaging, task coordination, and state management

export { Team } from "./schema"
export { TeamRegistry } from "./registry"
export { TeamInbox } from "./inbox"
export { TeamTasks } from "./tasks"
export { TeamSession } from "./session"
export { TeamRecovery } from "./recovery"
export { TeamIsolation } from "./isolation"
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
