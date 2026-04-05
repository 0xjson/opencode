import { z } from "zod"
import { ModelID, ProviderID } from "../provider/schema"

export namespace Team {
  export const MemberState = z.enum([
    "ready",
    "busy",
    "shutdown_requested",
    "shutdown",
    "error",
  ])
  export type MemberState = z.infer<typeof MemberState>

  export const ExecutionState = z.enum([
    "thinking",
    "calling_tool",
    "waiting_message",
    "responding",
    "complete",
    "cancelling",
    "idle",
  ])
  export type ExecutionState = z.infer<typeof ExecutionState>

  export const MemberConfig = z.object({
    name: z.string(),
    model: z.string().optional(),
    prompt: z.string().optional(),
    agentType: z.string(),
    color: z.string().optional(),
    planModeRequired: z.boolean().optional(),
  })
  export type MemberConfig = z.infer<typeof MemberConfig>

  export const Config = z.object({
    team: z.string(),
    lead: z.string(),
    description: z.string().optional(),
    members: z.array(MemberConfig),
    createdAt: z.number().optional(),
  })
  export type Config = z.infer<typeof Config>

  export const Session = z.object({
    sessionId: z.string(),
    agentName: z.string(),
    model: z.string(),
    teamName: z.string(),
    status: MemberState,
    executionStatus: ExecutionState,
    createdAt: z.number(),
    lastActivity: z.number().optional(),
  })
  export type Session = z.infer<typeof Session>

  export const Message = z.object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    text: z.string(),
    timestamp: z.number(),
    read: z.boolean(),
    type: z.enum(["message", "broadcast", "system", "receipt"]).default("message"),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  export type Message = z.infer<typeof Message>

  export const TaskStatus = z.enum([
    "pending",
    "in_progress",
    "completed",
    "failed",
    "blocked",
  ])
  export type TaskStatus = z.infer<typeof TaskStatus>

  export const Task = z.object({
    id: z.string(),
    description: z.string(),
    status: TaskStatus,
    claimedBy: z.string().nullable(),
    dependsOn: z.array(z.string()).default([]),
    createdAt: z.number(),
    completedAt: z.number().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
  })
  export type Task = z.infer<typeof Task>

  // ============================================================================
  // AUTONOMOUS ORCHESTRATION ENGINE - Phase 1 Extensions
  // ============================================================================

  export const TaskPriority = z.enum(["low", "normal", "high", "critical"])
  export type TaskPriority = z.infer<typeof TaskPriority>

  // Enhanced Task with orchestration metadata
  export const OrchestratedTask = z.object({
    id: z.string(),
    description: z.string(),
    status: TaskStatus,
    claimedBy: z.string().nullable(),
    dependsOn: z.array(z.string()).default([]),
    createdAt: z.number(),
    completedAt: z.number().optional(),
    metadata: z.record(z.string(), z.any()).optional(),
    // New orchestration fields
    embedding: z.array(z.number()).optional(), // Vector representation of task
    priority: TaskPriority.default("normal"),
    attempts: z.number().default(0),
    assignedHistory: z.array(z.string()).default([]), // Agents who attempted this task
    estimatedDifficulty: z.number().min(1).max(10).optional(), // 1-10 scale
    taskType: z.string().optional(), // e.g., "code", "research", "test", "review"
    // Phase 2: DAG Critical Path Priority
    criticalPathLength: z.number().default(0), // Longest path from this task to any terminal task
    criticalPathWeight: z.number().default(0), // Cached weight contribution to effective priority
  })
  export type OrchestratedTask = z.infer<typeof OrchestratedTask>

  // Agent capabilities with embedding vector
  export const AgentCapabilities = z.object({
    agentName: z.string(),
    embedding: z.array(z.number()), // Vector representing agent expertise
    expertise: z.array(z.string()).default([]), // e.g., ["typescript", "testing", "refactoring"]
    maxCapacity: z.number().default(3), // Max concurrent tasks
    agentType: z.string(), // e.g., "general-purpose", "Explore", "Plan"
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  export type AgentCapabilities = z.infer<typeof AgentCapabilities>

  // Agent performance statistics for learning
  export const AgentStats = z.object({
    agentName: z.string(),
    totalTasks: z.number().default(0),
    successfulTasks: z.number().default(0),
    failedTasks: z.number().default(0),
    // Task type specific stats
    taskTypeStats: z.record(
      z.string(), // task type
      z.object({
        attempts: z.number().default(0),
        successes: z.number().default(0),
        totalCompletionTime: z.number().default(0), // ms
        avgCompletionTime: z.number().default(0), // ms
      })
    ).default({}),
    // Reliability score (0-1)
    reliabilityScore: z.number().min(0).max(1).default(0.5),
    // Current workload
    activeTasks: z.number().default(0),
    lastActiveAt: z.number().optional(),
    updatedAt: z.number().default(() => Date.now()),
    // Circuit breaker state
    circuitState: z.enum(["closed", "open", "half_open"]).default("closed"),
    circuitFailureCount: z.number().default(0),
    circuitOpenedAt: z.number().optional(),
  })
  export type AgentStats = z.infer<typeof AgentStats>

  // ============================================================================
  // CIRCUIT BREAKER - Phase 7 Extensions
  // ============================================================================

  export const CircuitState = z.enum(["closed", "open", "half_open"])
  export type CircuitState = z.infer<typeof CircuitState>

  export const CircuitBreakerConfig = z.object({
    failureThreshold: z.number().default(0.5),
    minFailures: z.number().default(3),
    cooldownDuration: z.number().default(60000),
    halfOpenMaxTasks: z.number().default(1),
    successThreshold: z.number().default(2),
  })
  export type CircuitBreakerConfig = z.infer<typeof CircuitBreakerConfig>

  export const CircuitBreakerState = z.object({
    agentName: z.string(),
    teamName: z.string(),
    state: CircuitState,
    failureCount: z.number(),
    successCount: z.number(),
    lastFailureTime: z.number().nullable(),
    circuitOpenedAt: z.number().nullable(),
    totalTasks: z.number(),
    consecutiveSuccesses: z.number(),
  })
  export type CircuitBreakerState = z.infer<typeof CircuitBreakerState>

  // Bidding system for complex tasks
  export const TaskBid = z.object({
    agentName: z.string(),
    taskId: z.string(),
    confidence: z.number().min(0).max(1), // 0-1 confidence score
    estimatedCompletionTime: z.number(), // minutes
    bidAt: z.number(),
    // Scoring components (added in Phase 5)
    reliability: z.number().min(0).max(1).optional(), // 0-1 reliability score from AgentStats
    urgency: z.number().min(0).max(1).optional(), // 0-1 urgency based on task priority
    scoringBreakdown: z.object({
      confidence: z.number(),
      reliability: z.number(),
      urgency: z.number(),
      eta: z.number(), // minutes used in calculation
      rawScore: z.number(), // before normalization
      finalScore: z.number(), // normalized score
    }).optional(),
    rejected: z.boolean().optional(), // true if bid was rejected
    rejectionReason: z.string().optional(), // reason for rejection
  })
  export type TaskBid = z.infer<typeof TaskBid>

  // Agent state machine extensions
  export const AgentState = z.enum([
    "idle",
    "thinking",
    "working",
    "blocked",
    "reviewing",
    "shutdown",
  ])
  export type AgentState = z.infer<typeof AgentState>

  // Enhanced session with state machine
  export const OrchestratedSession = z.object({
    sessionId: z.string(),
    agentName: z.string(),
    model: z.string(),
    teamName: z.string(),
    status: MemberState,
    executionStatus: ExecutionState,
    agentState: AgentState.default("idle"),
    createdAt: z.number(),
    lastActivity: z.number().optional(),
    // Current task tracking
    currentTaskId: z.string().optional(),
    taskStartTime: z.number().optional(),
  })
  export type OrchestratedSession = z.infer<typeof OrchestratedSession>

  // ============================================================================
  // BACKPRESSURE & LOAD CONTROL - Phase 6 Extensions
  // ============================================================================

  export const ThrottlingLevel = z.enum(["none", "light", "moderate", "severe", "critical"])
  export type ThrottlingLevel = z.infer<typeof ThrottlingLevel>

  export const BackpressureConfig = z.object({
    // Maximum tasks in progress system-wide
    globalConcurrencyLimit: z.number().default(50),
    // Maximum tasks per agent (enforced via capabilities.maxCapacity)
    maxTasksPerAgent: z.number().default(3),
    // Pending tasks threshold before throttling
    queueSizeThreshold: z.number().default(100),
    // Overload duration threshold in ms before triggering warning
    overloadDurationMs: z.number().default(30000),
    // Enable strict mode (reject all non-critical when > 100% threshold)
    strictMode: z.boolean().default(false),
  })
  export type BackpressureConfig = z.infer<typeof BackpressureConfig>

  export const SystemLoadMetrics = z.object({
    timestamp: z.number(),
    totalTasks: z.number(),
    pendingTasks: z.number(),
    inProgressTasks: z.number(),
    completedTasks: z.number(),
    failedTasks: z.number(),
    systemLoadRatio: z.number(),
    queueUtilization: z.number(),
    agentLoads: z.array(z.object({
      agentName: z.string(),
      activeTasks: z.number(),
      maxCapacity: z.number(),
      utilization: z.number(),
    })),
    throttlingLevel: ThrottlingLevel,
    isOverloaded: z.boolean(),
    overloadStartedAt: z.number().nullable(),
  })
  export type SystemLoadMetrics = z.infer<typeof SystemLoadMetrics>
}
