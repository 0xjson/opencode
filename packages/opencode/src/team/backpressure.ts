// Backpressure & Load Control Module for Multi-Agent Team System
// Implements queueing theory-based flow control to prevent system overload

import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamTasks } from "./tasks"
import { Log } from "../util/log"

const log = Log.create({ service: "team.backpressure" })

/**
 * Backpressure configuration options
 */
export interface BackpressureConfig {
  // Maximum tasks in progress system-wide (default: 50)
  globalConcurrencyLimit: number
  // Maximum tasks per agent (enforced via capabilities.maxCapacity)
  maxTasksPerAgent: number
  // Pending tasks threshold before throttling (default: 100)
  queueSizeThreshold: number
  // Overload duration threshold in ms before triggering warning (default: 30000)
  overloadDurationMs: number
  // Enable strict mode (reject all non-critical when > 100% threshold)
  strictMode: boolean
}

export const DEFAULT_BACKPRESSURE_CONFIG: BackpressureConfig = {
  globalConcurrencyLimit: 50,
  maxTasksPerAgent: 3,
  queueSizeThreshold: 100,
  overloadDurationMs: 30000,
  strictMode: false,
}

/**
 * System load metrics for observability
 */
export interface SystemLoadMetrics {
  // Current state
  timestamp: number
  totalTasks: number
  pendingTasks: number
  inProgressTasks: number
  completedTasks: number
  failedTasks: number
  systemLoadRatio: number // 0-1 ratio of current/max concurrency

  // Queue depth analysis
  queueUtilization: number // 0-1 ratio of queue size to threshold

  // Per-agent metrics
  agentLoads: Array<{
    agentName: string
    activeTasks: number
    maxCapacity: number
    utilization: number // 0-1 ratio
  }>

  // Throttling state
  throttlingLevel: ThrottlingLevel
  isOverloaded: boolean
  overloadStartedAt: number | null
}

/**
 * Throttling severity levels
 */
export type ThrottlingLevel = "none" | "light" | "moderate" | "severe" | "critical"

/**
 * Decision result for task acceptance
 */
export interface AcceptanceDecision {
  accepted: boolean
  action: "accept" | "delay" | "reject"
  delayMs?: number
  reason: string
  metrics: SystemLoadMetrics
}

/**
 * Decision result for task assignment
 */
export interface AssignmentDecision {
  canAssign: boolean
  reason?: string
  suggestedAlternative?: string
}

// Module state
const loadHistory: Array<{
  timestamp: number
  loadRatio: number
  queueUtilization: number
}> = []
const MAX_HISTORY_SIZE = 1000
let overloadStartTime: number | null = null
let lastOverloadWarning: number | null = null

/**
 * Calculate current system load metrics
 */
export async function getSystemLoadMetrics(
  teamName: string,
  config: Partial<BackpressureConfig> = {}
): Promise<SystemLoadMetrics> {
  const fullConfig = { ...DEFAULT_BACKPRESSURE_CONFIG, ...config }

  // Get all tasks
  const allTasks = await TeamTasks.getTasks(teamName)
  const pendingTasks = allTasks.filter((t) => t.status === "pending").length
  const inProgressTasks = allTasks.filter((t) => t.status === "in_progress").length
  const completedTasks = allTasks.filter((t) => t.status === "completed").length
  const failedTasks = allTasks.filter((t) => t.status === "failed").length

  // Get agent stats
  const agentStats = await TeamRegistry.loadAgentStats(teamName)
  const agentLoads = await Promise.all(
    agentStats.map(async (stats) => {
      const capabilities = await TeamRegistry.getAgentCapabilities(teamName, stats.agentName)
      const maxCapacity = capabilities?.maxCapacity || fullConfig.maxTasksPerAgent
      return {
        agentName: stats.agentName,
        activeTasks: stats.activeTasks || 0,
        maxCapacity,
        utilization: (stats.activeTasks || 0) / maxCapacity,
      }
    })
  )

  // Calculate system-wide load
  const systemLoadRatio = inProgressTasks / fullConfig.globalConcurrencyLimit
  const queueUtilization = pendingTasks / fullConfig.queueSizeThreshold

  // Determine throttling level
  const throttlingLevel = calculateThrottlingLevel(queueUtilization, systemLoadRatio)

  // Track overload state
  const isOverloaded = queueUtilization > 1.0 || systemLoadRatio >= 1.0
  if (isOverloaded && !overloadStartTime) {
    overloadStartTime = Date.now()
  } else if (!isOverloaded) {
    overloadStartTime = null
  }

  // Record history
  const now = Date.now()
  loadHistory.push({
    timestamp: now,
    loadRatio: systemLoadRatio,
    queueUtilization,
  })
  if (loadHistory.length > MAX_HISTORY_SIZE) {
    loadHistory.shift()
  }

  return {
    timestamp: now,
    totalTasks: allTasks.length,
    pendingTasks,
    inProgressTasks,
    completedTasks,
    failedTasks,
    systemLoadRatio,
    queueUtilization,
    agentLoads,
    throttlingLevel,
    isOverloaded,
    overloadStartedAt: overloadStartTime,
  }
}

/**
 * Calculate throttling level based on queue utilization and system load
 * Uses multiple thresholds for graceful degradation
 */
function calculateThrottlingLevel(
  queueUtilization: number,
  systemLoadRatio: number
): ThrottlingLevel {
  // Priority: queue utilization takes precedence
  if (queueUtilization > 1.0 || systemLoadRatio >= 1.0) {
    return "critical"
  }
  if (queueUtilization >= 0.75) {
    return "severe"
  }
  if (queueUtilization >= 0.5) {
    return "moderate"
  }
  if (queueUtilization >= 0.25 || systemLoadRatio >= 0.8) {
    return "light"
  }
  return "none"
}

/**
 * Check if a new task can be accepted into the system
 * Implements tiered throttling strategy based on queue depth
 */
export async function canAcceptTask(
  teamName: string,
  priority: Team.TaskPriority = "normal",
  config: Partial<BackpressureConfig> = {}
): Promise<AcceptanceDecision> {
  const fullConfig = { ...DEFAULT_BACKPRESSURE_CONFIG, ...config }
  const metrics = await getSystemLoadMetrics(teamName, fullConfig)

  // CRITICAL: Never block critical tasks
  if (priority === "critical") {
    return {
      accepted: true,
      action: "accept",
      reason: "Critical tasks bypass all backpressure checks",
      metrics,
    }
  }

  const { queueUtilization, systemLoadRatio, throttlingLevel } = metrics

  // Check for extended overload condition
  if (metrics.isOverloaded && metrics.overloadStartedAt) {
    const overloadDuration = Date.now() - metrics.overloadStartedAt
    if (overloadDuration > fullConfig.overloadDurationMs) {
      // Trigger overload warning (once per minute)
      if (!lastOverloadWarning || Date.now() - lastOverloadWarning > 60000) {
        log.warn({
          msg: "System overload detected",
          team: teamName,
          overloadDuration,
          queueUtilization: queueUtilization.toFixed(2),
          systemLoadRatio: systemLoadRatio.toFixed(2),
          pendingTasks: metrics.pendingTasks,
          inProgressTasks: metrics.inProgressTasks,
        })
        lastOverloadWarning = Date.now()
      }
    }
  }

  // Tiered throttling based on queue utilization
  // Reference: Queueing Theory - M/M/c with finite buffer
  // As queue approaches capacity, we apply backpressure

  // >100% threshold: Reject all except critical (handled above)
  if (queueUtilization > 1.0) {
    return {
      accepted: false,
      action: "reject",
      reason: `Queue full: ${metrics.pendingTasks} pending (threshold: ${fullConfig.queueSizeThreshold})`,
      metrics,
    }
  }

  // 75-100% threshold: Delay normal tasks, reject low priority
  if (queueUtilization >= 0.75) {
    if (priority === "low") {
      return {
        accepted: false,
        action: "reject",
        reason: `Queue near capacity: ${metrics.pendingTasks} pending - low priority rejected`,
        metrics,
      }
    }
    // Normal/high tasks delayed by 5s
    return {
      accepted: true,
      action: "delay",
      delayMs: 5000,
      reason: `Queue high: ${metrics.pendingTasks} pending - delaying ${priority} task by 5s`,
      metrics,
    }
  }

  // 50-75% threshold: Delay normal tasks by 1s
  if (queueUtilization >= 0.5) {
    if (priority === "normal") {
      return {
        accepted: true,
        action: "delay",
        delayMs: 1000,
        reason: `Queue elevated: ${metrics.pendingTasks} pending - delaying normal task by 1s`,
        metrics,
      }
    }
    // High priority tasks pass through with light throttle
    return {
      accepted: true,
      action: "accept",
      reason: `Queue elevated but accepting ${priority} task`,
      metrics,
    }
  }

  // <50% threshold: Normal operation
  return {
    accepted: true,
    action: "accept",
    reason: `Queue healthy: ${metrics.pendingTasks} pending`,
    metrics,
  }
}

/**
 * Check if a task can be assigned to a specific agent
 * Enforces per-agent concurrency limits
 */
export async function canAssignToAgent(
  teamName: string,
  agentName: string,
  config: Partial<BackpressureConfig> = {}
): Promise<AssignmentDecision> {
  const fullConfig = { ...DEFAULT_BACKPRESSURE_CONFIG, ...config }

  // Get agent capabilities and stats
  const capabilities = await TeamRegistry.getAgentCapabilities(teamName, agentName)
  const stats = await TeamRegistry.getAgentStat(teamName, agentName)

  if (!capabilities) {
    return {
      canAssign: false,
      reason: `Agent "${agentName}" capabilities not found`,
    }
  }

  const maxCapacity = capabilities.maxCapacity || fullConfig.maxTasksPerAgent
  const activeTasks = stats?.activeTasks || 0

  // Check if agent is at capacity
  if (activeTasks >= maxCapacity) {
    return {
      canAssign: false,
      reason: `Agent "${agentName}" at capacity (${activeTasks}/${maxCapacity})`,
    }
  }

  // Check global concurrency limit
  const allTasks = await TeamTasks.getTasks(teamName)
  const inProgressTasks = allTasks.filter((t) => t.status === "in_progress").length

  if (inProgressTasks >= fullConfig.globalConcurrencyLimit) {
    return {
      canAssign: false,
      reason: `Global concurrency limit reached (${inProgressTasks}/${fullConfig.globalConcurrencyLimit})`,
    }
  }

  return {
    canAssign: true,
    reason: `Agent available (${activeTasks}/${maxCapacity}), global load ${inProgressTasks}/${fullConfig.globalConcurrencyLimit}`,
  }
}

/**
 * Find the least loaded agent for task assignment
 * Useful when preferred agent is unavailable
 */
export async function findLeastLoadedAgent(
  teamName: string,
  excludeAgent?: string,
  config: Partial<BackpressureConfig> = {}
): Promise<string | null> {
  const agentStats = await TeamRegistry.loadAgentStats(teamName)
  const candidates: Array<{ name: string; load: number; maxCapacity: number }> = []

  for (const stats of agentStats) {
    if (stats.agentName === excludeAgent) continue

    const capabilities = await TeamRegistry.getAgentCapabilities(teamName, stats.agentName)
    if (!capabilities) continue

    const maxCapacity = capabilities.maxCapacity || config.maxTasksPerAgent || DEFAULT_BACKPRESSURE_CONFIG.maxTasksPerAgent
    const activeTasks = stats.activeTasks || 0

    // Skip agents at capacity
    if (activeTasks >= maxCapacity) continue

    candidates.push({
      name: stats.agentName,
      load: activeTasks / maxCapacity,
      maxCapacity,
    })
  }

  // Sort by load (ascending) - pick least loaded
  candidates.sort((a, b) => a.load - b.load)

  return candidates.length > 0 ? candidates[0].name : null
}

/**
 * Apply delay if needed (non-blocking)
 */
export function applyDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

/**
 * Get load history for analysis
 */
export function getLoadHistory(): Array<{
  timestamp: number
  loadRatio: number
  queueUtilization: number
}> {
  return [...loadHistory]
}

/**
 * Clear load history (useful for testing)
 */
export function clearLoadHistory(): void {
  loadHistory.length = 0
  overloadStartTime = null
  lastOverloadWarning = null
}

/**
 * Calculate average load over a time window
 */
export function getAverageLoad(windowMs: number = 60000): {
  avgLoadRatio: number
  avgQueueUtilization: number
  peakLoadRatio: number
  peakQueueUtilization: number
} {
  const cutoff = Date.now() - windowMs
  const relevant = loadHistory.filter((h) => h.timestamp >= cutoff)

  if (relevant.length === 0) {
    return {
      avgLoadRatio: 0,
      avgQueueUtilization: 0,
      peakLoadRatio: 0,
      peakQueueUtilization: 0,
    }
  }

  const avgLoadRatio = relevant.reduce((sum, h) => sum + h.loadRatio, 0) / relevant.length
  const avgQueueUtilization = relevant.reduce((sum, h) => sum + h.queueUtilization, 0) / relevant.length
  const peakLoadRatio = Math.max(...relevant.map((h) => h.loadRatio))
  const peakQueueUtilization = Math.max(...relevant.map((h) => h.queueUtilization))

  return {
    avgLoadRatio,
    avgQueueUtilization,
    peakLoadRatio,
    peakQueueUtilization,
  }
}

/**
 * Check if system is currently overloaded
 */
export async function isSystemOverloaded(
  teamName: string,
  config: Partial<BackpressureConfig> = {}
): Promise<boolean> {
  const metrics = await getSystemLoadMetrics(teamName, config)
  return metrics.isOverloaded
}

/**
 * Get recommended intake rate reduction factor
 * Returns value between 0 and 1 (1 = full rate, 0.5 = half rate)
 */
export async function getIntakeRateFactor(
  teamName: string,
  config: Partial<BackpressureConfig> = {}
): Promise<number> {
  const fullConfig = { ...DEFAULT_BACKPRESSURE_CONFIG, ...config }
  const metrics = await getSystemLoadMetrics(teamName, fullConfig)

  // If overload has persisted, reduce intake
  if (metrics.isOverloaded && metrics.overloadStartedAt) {
    const overloadDuration = Date.now() - metrics.overloadStartedAt
    if (overloadDuration > fullConfig.overloadDurationMs) {
      return 0.5 // Reduce intake by 50%
    }
  }

  // Otherwise use queue utilization
  if (metrics.queueUtilization > 0.9) return 0.5
  if (metrics.queueUtilization > 0.75) return 0.75
  if (metrics.queueUtilization > 0.5) return 0.9

  return 1.0
}

/**
 * Backpressure-aware task creation wrapper
 * Automatically applies delays or rejects based on system load
 */
export async function createTaskWithBackpressure<T>(
  teamName: string,
  priority: Team.TaskPriority,
  createFn: () => Promise<T>,
  config: Partial<BackpressureConfig> = {}
): Promise<{
  success: boolean
  result?: T
  error?: string
  metrics: SystemLoadMetrics
}> {
  const decision = await canAcceptTask(teamName, priority, config)

  if (!decision.accepted) {
    log.warn({
      msg: "Task rejected by backpressure",
      team: teamName,
      priority,
      reason: decision.reason,
      queueUtilization: decision.metrics.queueUtilization.toFixed(2),
    })
    return {
      success: false,
      error: decision.reason,
      metrics: decision.metrics,
    }
  }

  // Apply delay if needed
  if (decision.action === "delay" && decision.delayMs) {
    log.debug({
      msg: "Task delayed by backpressure",
      team: teamName,
      priority,
      delayMs: decision.delayMs,
      reason: decision.reason,
    })
    await applyDelay(decision.delayMs)
  }

  try {
    const result = await createFn()
    return {
      success: true,
      result,
      metrics: decision.metrics,
    }
  } catch (error) {
    return {
      success: false,
      error: String(error),
      metrics: decision.metrics,
    }
  }
}
