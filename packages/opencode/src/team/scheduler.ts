// Scheduler Loop for Autonomous Task Orchestration
// Implements continuous dependency-aware scheduling with parallel execution
// Phase 1: Event-Driven Scheduler - transforms polling to event-driven

import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamTasks } from "./tasks"
import { TeamInbox } from "./inbox"
import { ScoringEngine } from "./scorer"
import { CircuitBreaker } from "./circuitBreaker"
import { AssignmentOptimizer } from "./assignmentOptimizer"
import { Log } from "../util/log"
import { Filesystem } from "../util/filesystem"
import { getEventBus, EventBus } from "./eventBus"
import type { Event } from "./eventBus"
import * as Backpressure from "./backpressure"

const log = Log.create({ service: "team.scheduler" })

// Cache for critical path computations to avoid recomputation
const criticalPathCache = new Map<string, { length: number; timestamp: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

// ============================================================================
// Event-Driven Scheduler State
// ============================================================================

type UnsubscribeFn = () => void

export interface SchedulerOptions {
  intervalMs: number
  maxTasksPerCycle: number
  minAutoClaimScore: number
  enableLeadAssignment: boolean
  enableRetries: boolean
  maxRetries: number
  enableCircuitBreaker: boolean
  circuitBreakerConfig?: Partial<CircuitBreaker.CircuitBreakerConfig>
  enableGlobalOptimization: boolean
  optimizationThreshold: number
  enableCriticalPathPriority: boolean
  criticalPathWeight: number
  enableAdaptiveScoring: boolean
  learningRate: number
  enableEventDrivenScheduler: boolean
}

const eventDrivenSchedulers = new Map<string, EventDrivenSchedulerState>()

interface EventDrivenSchedulerState {
  teamName: string
  options: SchedulerOptions
  eventBus: EventBus
  unsubscribers: UnsubscribeFn[]
  startTime: number
  stats: {
    tasksScheduled: number
    tasksCompleted: number
    tasksFailed: number
    eventsProcessed: number
  }
}

export namespace TeamScheduler {
  // ============================================================================
  // DAG CRITICAL PATH METHOD (CPM) - Phase 2
  // ============================================================================

  export interface CriticalPathResult {
    length: number
    hasCycle: boolean
    path: string[]
  }

  export function computeCriticalPath(
    taskId: string,
    allTasks: Team.OrchestratedTask[]
  ): CriticalPathResult {
    const memo = new Map<string, { length: number; path: string[] }>()
    const visiting = new Set<string>()
    const dependents = new Map<string, string[]>()

    for (const task of allTasks) {
      dependents.set(task.id, [])
    }
    for (const task of allTasks) {
      for (const depId of task.dependsOn || []) {
        if (dependents.has(depId)) {
          dependents.get(depId)!.push(task.id)
        }
      }
    }

    function dfs(nodeId: string): { length: number; path: string[]; hasCycle: boolean } {
      if (visiting.has(nodeId)) {
        return { length: -1, path: [], hasCycle: true }
      }
      if (memo.has(nodeId)) {
        return { ...memo.get(nodeId)!, hasCycle: false }
      }
      visiting.add(nodeId)
      const nodeDependents = dependents.get(nodeId) || []

      if (nodeDependents.length === 0) {
        visiting.delete(nodeId)
        const result = { length: 0, path: [nodeId], hasCycle: false }
        memo.set(nodeId, { length: result.length, path: result.path })
        return result
      }

      let maxLength = 0
      let bestPath: string[] = [nodeId]

      for (const depId of nodeDependents) {
        const subResult = dfs(depId)
        if (subResult.hasCycle) {
          visiting.delete(nodeId)
          return { length: -1, path: [], hasCycle: true }
        }
        if (subResult.length + 1 > maxLength) {
          maxLength = subResult.length + 1
          bestPath = [nodeId, ...subResult.path]
        }
      }

      visiting.delete(nodeId)
      const result = { length: maxLength, path: bestPath, hasCycle: false }
      memo.set(nodeId, { length: result.length, path: result.path })
      return result
    }

    const result = dfs(taskId)
    return {
      length: result.hasCycle ? -1 : result.length,
      hasCycle: result.hasCycle,
      path: result.path,
    }
  }

  export function batchComputeCriticalPaths(
    taskIds: string[],
    allTasks: Team.OrchestratedTask[]
  ): Map<string, number> {
    const results = new Map<string, number>()
    for (const taskId of taskIds) {
      const cached = criticalPathCache.get(taskId)
      if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        results.set(taskId, cached.length)
        continue
      }
      const result = computeCriticalPath(taskId, allTasks)
      if (result.hasCycle) {
        log.error(`Cycle detected in dependency graph for task "${taskId}"`)
        results.set(taskId, 0)
      } else {
        results.set(taskId, result.length)
        criticalPathCache.set(taskId, { length: result.length, timestamp: Date.now() })
      }
    }
    return results
  }

  export function clearCriticalPathCache(): void {
    criticalPathCache.clear()
    log.debug("Cleared critical path cache")
  }

  export function invalidateCriticalPathCache(
    taskId: string,
    allTasks: Team.OrchestratedTask[]
  ): void {
    criticalPathCache.delete(taskId)
    for (const task of allTasks) {
      if (task.dependsOn?.includes(taskId)) {
        criticalPathCache.delete(task.id)
      }
    }
    log.debug(`Invalidated critical path cache for task "${taskId}" and its dependents`)
  }

  const activeSchedulers = new Map<string, {
    intervalId: ReturnType<typeof setInterval>
    startTime: number
    stats: {
      tasksScheduled: number
      tasksCompleted: number
      tasksFailed: number
      cycles: number
    }
  }>()

  export interface SchedulerOptions {
    intervalMs: number
    maxTasksPerCycle: number
    minAutoClaimScore: number
    enableLeadAssignment: boolean
    enableRetries: boolean
    maxRetries: number
    enableCircuitBreaker: boolean
    circuitBreakerConfig?: Partial<CircuitBreaker.CircuitBreakerConfig>
    enableGlobalOptimization: boolean
    optimizationThreshold: number
    enableCriticalPathPriority: boolean
    criticalPathWeight: number
    enableAdaptiveScoring: boolean
    learningRate: number
    enableEventDrivenScheduler: boolean
  }

  export const DEFAULT_OPTIONS: SchedulerOptions = {
    intervalMs: 5000,
    maxTasksPerCycle: 10,
    minAutoClaimScore: 0.3,
    enableLeadAssignment: true,
    enableRetries: true,
    maxRetries: 3,
    enableCircuitBreaker: true,
    enableGlobalOptimization: false,
    optimizationThreshold: 5,
    enableCriticalPathPriority: true,
    criticalPathWeight: 0.5,
    enableAdaptiveScoring: true,
    learningRate: 0.05,
    enableEventDrivenScheduler: false,
  }

  export function detectCycle(tasks: Team.OrchestratedTask[]): boolean {
    const graph = new Map<string, string[]>()
    const visited = new Set<string>()
    const recursionStack = new Set<string>()

    for (const task of tasks) {
      graph.set(task.id, task.dependsOn || [])
    }

    function hasCycle(node: string): boolean {
      visited.add(node)
      recursionStack.add(node)
      const deps = graph.get(node) || []
      for (const dep of deps) {
        if (!visited.has(dep)) {
          if (hasCycle(dep)) return true
        } else if (recursionStack.has(dep)) {
          return true
        }
      }
      recursionStack.delete(node)
      return false
    }

    for (const task of tasks) {
      if (!visited.has(task.id)) {
        if (hasCycle(task.id)) return true
      }
    }
    return false
  }

  export function topologicalSort(tasks: Team.OrchestratedTask[]): Team.OrchestratedTask[] {
    const inDegree = new Map<string, number>()
    const graph = new Map<string, string[]>()

    for (const task of tasks) {
      inDegree.set(task.id, 0)
      graph.set(task.id, [])
    }

    for (const task of tasks) {
      for (const dep of task.dependsOn || []) {
        if (graph.has(dep)) {
          graph.get(dep)!.push(task.id)
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1)
        }
      }
    }

    const queue: string[] = []
    const result: Team.OrchestratedTask[] = []

    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id)
    }

    while (queue.length > 0) {
      const id = queue.shift()!
      const task = tasks.find((t) => t.id === id)
      if (task) result.push(task)

      for (const neighbor of graph.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 0) - 1
        inDegree.set(neighbor, newDegree)
        if (newDegree === 0) queue.push(neighbor)
      }
    }

    return result
  }

  async function getPrioritizedReadyTasks(
    teamName: string,
    agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }>,
    options: SchedulerOptions = DEFAULT_OPTIONS
  ): Promise<Team.OrchestratedTask[]> {
    const tasks = await TeamTasks.getDependencyReadyTasks(teamName)
    const allTasksRanked = await TeamTasks.rankPendingTasks(teamName)
    const allAgentStats = await TeamRegistry.loadAgentStats(teamName)

    const readyTasks = allTasksRanked.filter((r) => r.ready).map((r) => r.task)
    if (readyTasks.length === 0) return []

    const allTasks = await TeamTasks.getOrchestratedTasks(teamName)
    let criticalPathLengths: Map<string, number> | null = null

    if (options.enableCriticalPathPriority) {
      try {
        if (detectCycle(allTasks)) {
          log.error("Cycle detected in dependency graph. Falling back to base priority only.")
        } else {
          criticalPathLengths = batchComputeCriticalPaths(
            readyTasks.map((t) => t.id),
            allTasks
          )
          for (const task of readyTasks) {
            const pathLength = criticalPathLengths.get(task.id) || 0
            task.criticalPathLength = pathLength
            task.criticalPathWeight = pathLength * options.criticalPathWeight
          }
        }
      } catch (error) {
        log.error(`Critical path computation failed: ${error}. Using base priority only.`)
        criticalPathLengths = null
      }
    }

    const tasksWithScores = await Promise.all(
      readyTasks.map(async (task) => {
        let bestScore = 0
        for (const { capabilities, stats } of agents) {
          const scoreResult = ScoringEngine.computeScore(
            capabilities,
            stats,
            task,
            readyTasks,
            allAgentStats
          )
          bestScore = Math.max(bestScore, scoreResult.score)
        }
        return { task, bestScore }
      })
    )

    const basePriorityWeights = { critical: 4, high: 3, normal: 2, low: 1 }
    const tasksWithEffectivePriority = tasksWithScores.map(({ task, bestScore }) => {
      const basePriorityWeight = basePriorityWeights[task.priority || "normal"]
      let effectivePriority = basePriorityWeight
      if (options.enableCriticalPathPriority && criticalPathLengths) {
        const pathLength = criticalPathLengths.get(task.id) || 0
        effectivePriority = basePriorityWeight + pathLength * options.criticalPathWeight
      }
      return { task, bestScore, effectivePriority }
    })

    tasksWithEffectivePriority.sort((a, b) => {
      const priorityDiff = b.effectivePriority - a.effectivePriority
      if (priorityDiff !== 0) return priorityDiff
      return b.bestScore - a.bestScore
    })

    return tasksWithEffectivePriority.map((t) => t.task)
  }

  async function assignHighPriorityTasks(
    teamName: string,
    tasks: Team.OrchestratedTask[],
    agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }>,
    options: SchedulerOptions
  ): Promise<number> {
    const team = await TeamRegistry.getTeam(teamName)
    if (!team || !options.enableLeadAssignment) return 0

    const highPriorityTasks = tasks.filter(
      (t) => t.priority === "critical" || t.priority === "high"
    )
    const unclaimedTasks = highPriorityTasks.filter((t) => !t.claimedBy)
    if (unclaimedTasks.length === 0) return 0

    const allAgentStats = await TeamRegistry.loadAgentStats(teamName)
    let assignments: AssignmentOptimizer.Assignment[] = []

    if (
      options.enableGlobalOptimization &&
      AssignmentOptimizer.shouldOptimize(unclaimedTasks, {
        enableGlobalOptimization: true,
        optimizationThreshold: options.optimizationThreshold,
        highPriorityThreshold: "high",
      })
    ) {
      try {
        assignments = AssignmentOptimizer.optimizeAssignments(
          unclaimedTasks,
          agents,
          tasks,
          allAgentStats,
          {
            enableGlobalOptimization: true,
            optimizationThreshold: options.optimizationThreshold,
            highPriorityThreshold: "high",
          }
        )
        if (assignments.length > 0) {
          log.info(`Global optimization assigned ${assignments.length} high-priority tasks`)
        }
      } catch (error) {
        log.warn(`Global optimization failed, falling back to greedy selection: ${error}`)
        assignments = []
      }
    }

    if (assignments.length === 0) {
      for (const task of unclaimedTasks.slice(0, options.maxTasksPerCycle)) {
        const result = ScoringEngine.selectBestAgent(task, agents, tasks)
        if (result.bestAgent) {
          assignments.push({
            taskId: task.id,
            agentName: result.bestAgent,
            score: result.score,
          })
        }
      }
    }

    let assigned = 0
    for (const assignment of assignments.slice(0, options.maxTasksPerCycle)) {
      if (options.enableCircuitBreaker) {
        const canAccept = CircuitBreaker.canAgentAcceptTasks(
          teamName,
          assignment.agentName,
          options.circuitBreakerConfig
        )
        if (!canAccept) {
          log.debug(`Skipping assignment to "${assignment.agentName}" - circuit breaker is open`)
          continue
        }
      }

      await TeamInbox.sendMessage(
        teamName,
        assignment.agentName,
        team.lead,
        JSON.stringify({
          type: "task_assignment",
          taskId: assignment.taskId,
          score: assignment.score,
        }),
        "system"
      )

      const claimResult = await TeamTasks.claimTask(teamName, assignment.taskId, assignment.agentName)
      if (claimResult.success) {
        assigned++
        log.info(`Lead assigned high-priority task "${assignment.taskId}" to "${assignment.agentName}"`)
      }
    }

    return assigned
  }

  async function autoClaimTasks(
    teamName: string,
    tasks: Team.OrchestratedTask[],
    agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }>,
    options: SchedulerOptions
  ): Promise<number> {
    const allAgentStats = await TeamRegistry.loadAgentStats(teamName)
    let claimed = 0

    for (const { capabilities, stats } of agents) {
      if (stats.activeTasks >= capabilities.maxCapacity) continue

      if (options.enableCircuitBreaker) {
        const canAccept = CircuitBreaker.canAgentAcceptTasks(
          teamName,
          capabilities.agentName,
          options.circuitBreakerConfig
        )
        if (!canAccept) {
          log.debug(`Skipping auto-claim for "${capabilities.agentName}" - circuit breaker is open`)
          continue
        }
      }

      const recommendation = ScoringEngine.shouldAutoClaim(
        capabilities,
        stats,
        tasks.filter((t) => !t.claimedBy),
        allAgentStats,
        {
          minScore: options.minAutoClaimScore,
          maxActiveTasks: capabilities.maxCapacity,
        }
      )

      if (recommendation) {
        const { task, score } = recommendation
        const result = await TeamTasks.claimTask(teamName, task.id, capabilities.agentName)
        if (result.success) {
          claimed++
          log.info(`Agent "${capabilities.agentName}" auto-claimed task "${task.id}" with score ${score.toFixed(3)}`)
        }
      }
    }

    return claimed
  }

  async function processCompletedTasks(teamName: string): Promise<number> {
    const tasks = await TeamTasks.getTasks(teamName) as Team.OrchestratedTask[]
    let unlocked = 0

    for (const task of tasks) {
      if (task.status === "completed" && task.dependsOn && task.dependsOn.length > 0) {
        const dependentTasks = tasks.filter(
          (t) => t.status === "blocked" && t.dependsOn?.includes(task.id)
        )
        for (const dep of dependentTasks) {
          const depStatus = ScoringEngine.dependencyReady(dep, tasks)
          if (depStatus.ready) {
            unlocked++
          }
        }
      }
    }

    return unlocked
  }

  async function handleFailedTasks(
    teamName: string,
    options: SchedulerOptions
  ): Promise<number> {
    const tasks = await TeamTasks.getTasks(teamName) as Team.OrchestratedTask[]
    let retried = 0

    for (const task of tasks) {
      if (task.status === "failed") {
        const attempts = task.attempts || 0
        if (options.enableRetries && attempts < options.maxRetries) {
          const updatedTasks = tasks.map((t) => {
            if (t.id === task.id) {
              return { ...t, status: "pending" as const, claimedBy: null }
            }
            return t
          })
          await TeamTasks.saveOrchestratedTasks(teamName, updatedTasks as Team.OrchestratedTask[])
          retried++
          log.info(`Task "${task.id}" queued for retry (attempt ${attempts + 1}/${options.maxRetries})`)
        } else {
          log.warn(`Task "${task.id}" failed permanently after ${attempts} attempts`)
        }
      }
    }

    return retried
  }

  // ============================================================================
  // Internal helper for saving orchestrated tasks
  // ============================================================================

  async function saveOrchestratedTasksInternal(teamName: string, tasks: Team.OrchestratedTask[]): Promise<void> {
    const tasksPath = await TeamRegistry.getTasksPath(teamName)
    await Filesystem.writeJson(tasksPath, tasks)
  }

  // ============================================================================
  // Event Handlers for Event-Driven Scheduler (Phase 1)
  // ============================================================================

  async function onTaskCreated(event: Event<"task_created">): Promise<void> {
    const { teamName, payload } = event
    log.debug(`Event handler onTaskCreated triggered for task "${payload.taskId}" in team "${teamName}"`)

    const state = eventDrivenSchedulers.get(teamName)
    if (!state) {
      log.debug(`No event-driven scheduler running for team "${teamName}"`)
      return
    }

    try {
      await schedulerTick(teamName, state.options)
      state.stats.eventsProcessed++
      log.debug(`Scheduled tasks after task_created event for "${payload.taskId}"`)
    } catch (error) {
      log.error(`Error in onTaskCreated handler for "${payload.taskId}": ${error}`)
    }
  }

  async function onTaskCompleted(event: Event<"task_completed">): Promise<void> {
    const { teamName, payload } = event
    log.debug(`Event handler onTaskCompleted triggered for task "${payload.taskId}" in team "${teamName}"`)

    const state = eventDrivenSchedulers.get(teamName)
    if (!state) {
      log.debug(`No event-driven scheduler running for team "${teamName}"`)
      return
    }

    try {
      const unlocked = await processCompletedTasks(teamName)
      if (unlocked > 0) {
        log.debug(`Unlocked ${unlocked} dependent tasks after completion of "${payload.taskId}"`)
      }
      await schedulerTick(teamName, state.options)
      state.stats.eventsProcessed++
      log.debug(`Scheduled tasks after task_completed event for "${payload.taskId}"`)
    } catch (error) {
      log.error(`Error in onTaskCompleted handler for "${payload.taskId}": ${error}`)
    }
  }

  async function onAgentAvailable(event: Event<"agent_available">): Promise<void> {
    const { teamName, payload } = event
    log.debug(`Event handler onAgentAvailable triggered for agent "${payload.agentName}" in team "${teamName}"`)

    const state = eventDrivenSchedulers.get(teamName)
    if (!state) {
      log.debug(`No event-driven scheduler running for team "${teamName}"`)
      return
    }

    try {
      const team = await TeamRegistry.getTeam(teamName)
      if (!team) {
        log.warn(`Team "${teamName}" not found in onAgentAvailable handler`)
        return
      }

      const memberConfig = team.members.find((m) => m.name === payload.agentName)
      if (!memberConfig) {
        log.warn(`Agent "${payload.agentName}" is not a member of team "${teamName}"`)
        return
      }

      const capabilities = await TeamRegistry.ensureAgentCapabilities(teamName, payload.agentName, memberConfig)
      const stats = await TeamRegistry.getAgentStat(teamName, payload.agentName) || {
        agentName: payload.agentName,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        taskTypeStats: {},
        reliabilityScore: 0.5,
        activeTasks: 0,
        circuitState: "closed" as const,
        circuitFailureCount: 0,
        updatedAt: Date.now(),
      }

      if (stats.activeTasks >= capabilities.maxCapacity) {
        log.debug(`Agent "${payload.agentName}" is at capacity (${stats.activeTasks}/${capabilities.maxCapacity})`)
        return
      }

      if (state.options.enableCircuitBreaker) {
        const canAccept = CircuitBreaker.canAgentAcceptTasks(
          teamName,
          payload.agentName,
          state.options.circuitBreakerConfig
        )
        if (!canAccept) {
          log.debug(`Skipping auto-claim for "${payload.agentName}" - circuit breaker is open`)
          return
        }
      }

      const readyTasks = await TeamTasks.getDependencyReadyTasks(teamName)
      const allAgentStats = await TeamRegistry.loadAgentStats(teamName)

      const recommendation = ScoringEngine.shouldAutoClaim(
        capabilities,
        stats,
        readyTasks.filter((t) => !t.claimedBy),
        allAgentStats,
        {
          minScore: state.options.minAutoClaimScore,
          maxActiveTasks: capabilities.maxCapacity,
        }
      )

      if (recommendation) {
        const { task, score } = recommendation
        const result = await TeamTasks.claimTask(teamName, task.id, payload.agentName)
        if (result.success) {
          log.info(`Agent "${payload.agentName}" auto-claimed task "${task.id}" with score ${score.toFixed(3)} (via agent_available event)`)
        }
      }

      state.stats.eventsProcessed++
    } catch (error) {
      log.error(`Error in onAgentAvailable handler for "${payload.agentName}": ${error}`)
    }
  }

  async function onTaskFailed(event: Event<"task_failed">): Promise<void> {
    const { teamName, payload } = event
    log.debug(`Event handler onTaskFailed triggered for task "${payload.taskId}" in team "${teamName}"`)

    const state = eventDrivenSchedulers.get(teamName)
    if (!state) {
      log.debug(`No event-driven scheduler running for team "${teamName}"`)
      return
    }

    try {
      const retried = await handleFailedTasks(teamName, state.options)
      if (retried > 0) {
        log.debug(`Retried ${retried} failed tasks after task_failed event for "${payload.taskId}"`)
      }
      await schedulerTick(teamName, state.options)
      state.stats.eventsProcessed++
      log.debug(`Scheduled tasks after task_failed event for "${payload.taskId}"`)
    } catch (error) {
      log.error(`Error in onTaskFailed handler for "${payload.taskId}": ${error}`)
    }
  }

  async function onTaskClaimed(event: Event<"task_claimed">): Promise<void> {
    const { teamName, payload } = event
    log.debug(`Event handler onTaskClaimed triggered for task "${payload.taskId}" claimed by "${payload.agentName}" in team "${teamName}"`)

    const state = eventDrivenSchedulers.get(teamName)
    if (!state) {
      log.debug(`No event-driven scheduler running for team "${teamName}"`)
      return
    }

    try {
      state.stats.tasksScheduled++
      await schedulerTick(teamName, state.options)
      state.stats.eventsProcessed++
      log.debug(`Scheduled tasks after task_claimed event for "${payload.taskId}"`)
    } catch (error) {
      log.error(`Error in onTaskClaimed handler for "${payload.taskId}": ${error}`)
    }
  }

  function registerEventHandlers(eventBus: EventBus, teamName: string, options: SchedulerOptions): UnsubscribeFn[] {
    const unsubscribers: UnsubscribeFn[] = []

    unsubscribers.push(
      eventBus.subscribe("task_created", onTaskCreated, { name: `scheduler-${teamName}-task-created` })
    )
    unsubscribers.push(
      eventBus.subscribe("task_completed", onTaskCompleted, { name: `scheduler-${teamName}-task-completed` })
    )
    unsubscribers.push(
      eventBus.subscribe("agent_available", onAgentAvailable, { name: `scheduler-${teamName}-agent-available` })
    )
    unsubscribers.push(
      eventBus.subscribe("task_failed", onTaskFailed, { name: `scheduler-${teamName}-task-failed` })
    )
    unsubscribers.push(
      eventBus.subscribe("task_claimed", onTaskClaimed, { name: `scheduler-${teamName}-task-claimed` })
    )

    log.debug(`Registered ${unsubscribers.length} event handlers for team "${teamName}"`)
    return unsubscribers
  }

  function unregisterEventHandlers(unsubscribers: UnsubscribeFn[]): void {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
  }

  export async function schedulerTick(
    teamName: string,
    options: SchedulerOptions = DEFAULT_OPTIONS
  ): Promise<{
    cycle: number
    assigned: number
    claimed: number
    completed: number
    failed: number
    retried: number
    unlocked: number
  }> {
    const scheduler = activeSchedulers.get(teamName)
    const cycle = scheduler?.stats.cycles || 0

    // Phase 4: Configure adaptive scoring at start of tick
    ScoringEngine.configureAdaptiveScoring({
      enableAdaptiveScoring: options.enableAdaptiveScoring,
      learningRate: options.learningRate,
    })

    const team = await TeamRegistry.getTeam(teamName)
    if (!team) {
      throw new Error(`Team "${teamName}" not found`)
    }

    const agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }> = []

    for (const member of team.members) {
      const capabilities = await TeamRegistry.ensureAgentCapabilities(teamName, member.name, member)
      let stats = await TeamRegistry.getAgentStat(teamName, member.name)

      if (!stats) {
        stats = {
          agentName: member.name,
          totalTasks: 0,
          successfulTasks: 0,
          failedTasks: 0,
          taskTypeStats: {},
          reliabilityScore: 0.5,
          activeTasks: 0,
          circuitState: "closed" as const,
          circuitFailureCount: 0,
          updatedAt: Date.now(),
        }
      }

      agents.push({ capabilities, stats })
    }

    const readyTasks = await getPrioritizedReadyTasks(teamName, agents, options)
    const assigned = await assignHighPriorityTasks(teamName, readyTasks, agents, options)
    const claimed = await autoClaimTasks(teamName, readyTasks, agents, options)
    const completed = await processCompletedTasks(teamName)
    const failed = (await TeamTasks.getTasks(teamName, { status: "failed" })).length
    const retried = await handleFailedTasks(teamName, options)
    const unlocked = await processCompletedTasks(teamName)

    if (scheduler) {
      scheduler.stats.cycles++
      scheduler.stats.tasksScheduled += assigned
      scheduler.stats.tasksCompleted += completed
      scheduler.stats.tasksFailed += failed
    }

    log.debug(`Scheduler tick #${cycle}: ${assigned} assigned, ${claimed} claimed, ${completed} completed`)

    return {
      cycle,
      assigned,
      claimed,
      completed,
      failed,
      retried,
      unlocked,
    }
  }

  export async function startScheduler(
    teamName: string,
    options: Partial<SchedulerOptions> = {}
  ): Promise<{ success: boolean; error?: string }> {
    if (activeSchedulers.has(teamName) || eventDrivenSchedulers.has(teamName)) {
      return { success: false, error: `Scheduler already running for team "${teamName}"` }
    }

    const team = await TeamRegistry.getTeam(teamName)
    if (!team) {
      return { success: false, error: `Team "${teamName}" not found` }
    }

    const fullOptions = { ...DEFAULT_OPTIONS, ...options }

    if (fullOptions.enableEventDrivenScheduler) {
      const eventBus = getEventBus()
      const unsubscribers = registerEventHandlers(eventBus, teamName, fullOptions)

      const schedulerState: EventDrivenSchedulerState = {
        teamName,
        options: fullOptions,
        eventBus,
        unsubscribers,
        startTime: Date.now(),
        stats: {
          tasksScheduled: 0,
          tasksCompleted: 0,
          tasksFailed: 0,
          eventsProcessed: 0,
        },
      }

      eventDrivenSchedulers.set(teamName, schedulerState)
      log.info(`Started event-driven scheduler for team "${teamName}"`)
      return { success: true }
    }

    const schedulerState = {
      intervalId: setInterval(async () => {
        try {
          await schedulerTick(teamName, fullOptions)
        } catch (error) {
          log.error(`Scheduler error for team "${teamName}": ${error}`)
        }
      }, fullOptions.intervalMs),
      startTime: Date.now(),
      stats: {
        tasksScheduled: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        cycles: 0,
      },
    }

    activeSchedulers.set(teamName, schedulerState)
    subscribeToBatchEvents(teamName, fullOptions)
    if (fullOptions.enableAdaptiveScoring) {
      subscribeToTaskOutcomeEvents(teamName, fullOptions)
    }

    log.info(`Started polling scheduler for team "${teamName}" with ${fullOptions.intervalMs}ms interval`)
    return { success: true }
  }

  export async function stopScheduler(teamName: string): Promise<{
    success: boolean
    stats?: {
      runtime: number
      cycles: number
      tasksScheduled: number
      tasksCompleted: number
      tasksFailed: number
      eventsProcessed?: number
    }
    error?: string
  }> {
    const eventDrivenState = eventDrivenSchedulers.get(teamName)
    if (eventDrivenState) {
      unregisterEventHandlers(eventDrivenState.unsubscribers)
      const stats = {
        runtime: Date.now() - eventDrivenState.startTime,
        cycles: 0,
        tasksScheduled: eventDrivenState.stats.tasksScheduled,
        tasksCompleted: eventDrivenState.stats.tasksCompleted,
        tasksFailed: eventDrivenState.stats.tasksFailed,
        eventsProcessed: eventDrivenState.stats.eventsProcessed,
      }
      eventDrivenSchedulers.delete(teamName)
      log.info(`Stopped event-driven scheduler for team "${teamName}". Processed ${stats.eventsProcessed} events`)
      return { success: true, stats }
    }

    const scheduler = activeSchedulers.get(teamName)
    if (!scheduler) {
      return { success: false, error: `Scheduler not running for team "${teamName}"` }
    }

    clearInterval(scheduler.intervalId)
    const runtime = Date.now() - scheduler.startTime
    const stats = {
      runtime,
      cycles: scheduler.stats.cycles,
      tasksScheduled: scheduler.stats.tasksScheduled,
      tasksCompleted: scheduler.stats.tasksCompleted,
      tasksFailed: scheduler.stats.tasksFailed,
    }
    activeSchedulers.delete(teamName)
    log.info(`Stopped polling scheduler for team "${teamName}". Ran for ${runtime}ms, ${stats.cycles} cycles`)
    return { success: true, stats }
  }

  export async function getSchedulerStatus(teamName: string): Promise<{
    running: boolean
    mode?: "polling" | "event-driven"
    options?: SchedulerOptions
    stats?: {
      runtime: number
      cycles: number
      tasksScheduled: number
      tasksCompleted: number
      tasksFailed: number
      eventsProcessed?: number
    }
  }> {
    const eventDrivenState = eventDrivenSchedulers.get(teamName)
    if (eventDrivenState) {
      return {
        running: true,
        mode: "event-driven",
        options: eventDrivenState.options,
        stats: {
          runtime: Date.now() - eventDrivenState.startTime,
          cycles: 0,
          tasksScheduled: eventDrivenState.stats.tasksScheduled,
          tasksCompleted: eventDrivenState.stats.tasksCompleted,
          tasksFailed: eventDrivenState.stats.tasksFailed,
          eventsProcessed: eventDrivenState.stats.eventsProcessed,
        },
      }
    }

    const scheduler = activeSchedulers.get(teamName)
    if (!scheduler) {
      return { running: false }
    }

    return {
      running: true,
      mode: "polling",
      options: DEFAULT_OPTIONS,
      stats: {
        runtime: Date.now() - scheduler.startTime,
        cycles: scheduler.stats.cycles,
        tasksScheduled: scheduler.stats.tasksScheduled,
        tasksCompleted: scheduler.stats.tasksCompleted,
        tasksFailed: scheduler.stats.tasksFailed,
      },
    }
  }

  export function getRunningSchedulers(): string[] {
    return [
      ...Array.from(activeSchedulers.keys()),
      ...Array.from(eventDrivenSchedulers.keys()),
    ]
  }

  export function getSchedulerMode(teamName: string): "polling" | "event-driven" | null {
    if (eventDrivenSchedulers.has(teamName)) return "event-driven"
    if (activeSchedulers.has(teamName)) return "polling"
    return null
  }

  export async function stopAllSchedulers(): Promise<void> {
    for (const [teamName] of activeSchedulers) {
      await stopScheduler(teamName)
    }
    for (const [teamName] of eventDrivenSchedulers) {
      await stopScheduler(teamName)
    }
  }

  const batchTriggerHandlers = new Map<string, () => void>()

  export async function onBatchCreated(
    teamName: string,
    tasks: Team.OrchestratedTask[],
    options: SchedulerOptions
  ): Promise<number> {
    if (!options.enableGlobalOptimization) {
      return 0
    }

    const readyTasks = tasks.filter((t) => t.status === "pending" && !t.claimedBy)
    if (readyTasks.length < options.optimizationThreshold) {
      log.debug(`Batch size ${readyTasks.length} below optimization threshold ${options.optimizationThreshold}`)
      return 0
    }

    const hasHighPriority = readyTasks.some(
      (t) => t.priority === "critical" || t.priority === "high"
    )

    if (readyTasks.length >= options.optimizationThreshold || hasHighPriority) {
      log.info(`Triggering batch optimization for ${readyTasks.length} tasks in team "${teamName}"`)

      const team = await TeamRegistry.getTeam(teamName)
      if (!team) {
        log.error(`Team "${teamName}" not found for batch optimization`)
        return 0
      }

      const agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }> = []
      for (const member of team.members) {
        const capabilities = await TeamRegistry.ensureAgentCapabilities(teamName, member.name, member)
        let stats = await TeamRegistry.getAgentStat(teamName, member.name)
        if (!stats) {
          stats = {
            agentName: member.name,
            totalTasks: 0,
            successfulTasks: 0,
            failedTasks: 0,
            taskTypeStats: {},
            reliabilityScore: 0.5,
            activeTasks: 0,
            circuitState: "closed" as const,
            circuitFailureCount: 0,
            updatedAt: Date.now(),
          }
        }
        agents.push({ capabilities, stats })
      }

      const assigned = await assignHighPriorityTasks(teamName, readyTasks, agents, options)
      return assigned
    }

    return 0
  }

  export function subscribeToBatchEvents(
    teamName: string,
    options: SchedulerOptions
  ): { success: boolean; error?: string } {
    const eventBus = getEventBus()

    if (batchTriggerHandlers.has(teamName)) {
      return { success: false, error: `Batch events already subscribed for team "${teamName}"` }
    }

    if (options.enableAdaptiveScoring) {
      ScoringEngine.configureAdaptiveScoring({
        enableAdaptiveScoring: true,
        learningRate: options.learningRate,
      })
    }

    const unsubscribe = eventBus.subscribe(
      "task_created",
      async (event) => {
        if (event.teamName !== teamName) return
        const tasks = await TeamTasks.getOrchestratedTasks(teamName)
        const pendingTasks = tasks.filter((t) => t.status === "pending")
        await onBatchCreated(teamName, pendingTasks, options)
      },
      { name: `batch-trigger-${teamName}` }
    )

    batchTriggerHandlers.set(teamName, unsubscribe)
    log.info(`Subscribed to batch events for team "${teamName}"`)
    return { success: true }
  }

  export function unsubscribeFromBatchEvents(teamName: string): { success: boolean; error?: string } {
    const unsubscribe = batchTriggerHandlers.get(teamName)
    if (!unsubscribe) {
      return { success: false, error: `No batch events subscription for team "${teamName}"` }
    }

    unsubscribe()
    batchTriggerHandlers.delete(teamName)
    log.info(`Unsubscribed from batch events for team "${teamName}"`)
    return { success: true }
  }

  export async function handleTaskCompletion(
    teamName: string,
    taskId: string,
    agentName: string,
    options: SchedulerOptions
  ): Promise<void> {
    if (!options.enableAdaptiveScoring) return

    const tasks = await TeamTasks.getOrchestratedTasks(teamName)
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    const completionTime = task.completedAt && task.createdAt
      ? task.completedAt - task.createdAt
      : undefined

    const result = ScoringEngine.updateWeights(
      taskId,
      agentName,
      task.taskType || "general",
      true,
      completionTime
    )

    if (result.success) {
      log.debug(`Updated scoring weights after task "${taskId}" completion`)
    } else {
      log.debug(`Failed to update weights: ${result.message}`)
    }
  }

  export async function handleTaskFailure(
    teamName: string,
    taskId: string,
    agentName: string,
    options: SchedulerOptions
  ): Promise<void> {
    if (!options.enableAdaptiveScoring) return

    const tasks = await TeamTasks.getOrchestratedTasks(teamName)
    const task = tasks.find((t) => t.id === taskId)
    if (!task) return

    const result = ScoringEngine.updateWeights(
      taskId,
      agentName,
      task.taskType || "general",
      false
    )

    if (result.success) {
      log.debug(`Updated scoring weights after task "${taskId}" failure`)
    } else {
      log.debug(`Failed to update weights: ${result.message}`)
    }
  }

  export function subscribeToTaskOutcomeEvents(
    teamName: string,
    options: SchedulerOptions
  ): { success: boolean; error?: string } {
    const eventBus = getEventBus()

    eventBus.subscribe(
      "task_completed",
      async (event) => {
        if (event.teamName !== teamName) return
        const { taskId, agentName } = event.payload
        await handleTaskCompletion(teamName, taskId, agentName, options)
      },
      { name: `adaptive-completion-${teamName}` }
    )

    eventBus.subscribe(
      "task_failed",
      async (event) => {
        if (event.teamName !== teamName) return
        const { taskId, agentName } = event.payload
        await handleTaskFailure(teamName, taskId, agentName, options)
      },
      { name: `adaptive-failure-${teamName}` }
    )

    log.info(`Subscribed to task outcome events for adaptive scoring in team "${teamName}"`)
    return { success: true }
  }

  const backpressureHandlers = new Map<string, () => void>()

  export function initializeEventDrivenScheduler(
    teamName: string,
    config?: Partial<Backpressure.BackpressureConfig>
  ): { success: boolean; error?: string } {
    const eventBus = getEventBus()

    if (backpressureHandlers.has(teamName)) {
      return { success: false, error: `Event-driven scheduler already initialized for team "${teamName}"` }
    }

    const unsubscribe = eventBus.subscribe(
      "task_created",
      async (event) => {
        const { taskId, priority } = event.payload

        if (priority !== "critical") {
          const decision = await Backpressure.canAcceptTask(teamName, priority, config)

          if (!decision.accepted) {
            log.warn({
              msg: "Task creation rejected by backpressure",
              team: teamName,
              taskId,
              priority,
              reason: decision.reason,
              queueUtilization: decision.metrics.queueUtilization.toFixed(2),
            })

            await eventBus.emit("task_failed", teamName, {
              taskId,
              agentName: "system",
              reason: `Rejected by backpressure: ${decision.reason}`,
              attempt: 0,
            })

            return
          }

          if (decision.action === "delay" && decision.delayMs) {
            log.debug({
              msg: "Task creation delayed by backpressure",
              team: teamName,
              taskId,
              priority,
              delayMs: decision.delayMs,
            })
            await Backpressure.applyDelay(decision.delayMs)
          }
        }

        log.debug({
          msg: "Task creation accepted",
          team: teamName,
          taskId,
          priority,
        })
      },
      { name: `backpressure-${teamName}` }
    )

    backpressureHandlers.set(teamName, unsubscribe)
    log.info(`Initialized event-driven scheduler with backpressure for team "${teamName}"`)
    return { success: true }
  }

  export function stopEventDrivenScheduler(teamName: string): { success: boolean; error?: string } {
    const unsubscribe = backpressureHandlers.get(teamName)

    if (!unsubscribe) {
      return { success: false, error: `Event-driven scheduler not initialized for team "${teamName}"` }
    }

    unsubscribe()
    backpressureHandlers.delete(teamName)
    log.info(`Stopped event-driven scheduler for team "${teamName}"`)
    return { success: true }
  }

  export function isEventDrivenSchedulerInitialized(teamName: string): boolean {
    return backpressureHandlers.has(teamName)
  }
}
