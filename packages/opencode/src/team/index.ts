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

// Autonomous Orchestration Engine - Phase 1: Event-Driven Scheduler
export { EventBus, getEventBus, on, emit, off } from "./eventBus"
export { EmbeddingService } from "./embedding"
export { ScoringEngine } from "./scorer"

// Autonomous Orchestration Engine - Phase 2: DAG Critical Path & Event-Driven Scheduling
export { TeamScheduler } from "./scheduler"

// Autonomous Orchestration Engine - Phase 3: Global Assignment Optimization & Bidding
export { TeamBidding } from "./bidding"
export { AssignmentOptimizer } from "./assignmentOptimizer"

// Autonomous Orchestration Engine - Phase 6: Backpressure & Load Control
export * as Backpressure from "./backpressure"

// Autonomous Orchestration Engine - Phase 7: Circuit Breaker
export { CircuitBreaker } from "./circuitBreaker"

// Autonomous Orchestration Engine - Phase 8: Memory Optimization
export { VectorIndex } from "./vectorIndex"
