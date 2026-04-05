import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { ulid } from "ulid"
import { EmbeddingService } from "./embedding"
import { ScoringEngine } from "./scorer"
import { CircuitBreaker } from "./circuitBreaker"
import { getEventBus } from "./eventBus"

const log = Log.create({ service: "team.tasks" })

export namespace TeamTasks {
  async function loadTasks(teamName: string): Promise<Team.Task[]> {
    const tasksPath = await TeamRegistry.getTasksPath(teamName)
    const exists = await Filesystem.exists(tasksPath)
    if (!exists) return []

    try {
      const content = await Filesystem.readJson<Team.Task[]>(tasksPath)
      return content || []
    } catch {
      return []
    }
  }

  async function saveTasks(teamName: string, tasks: Team.Task[]): Promise<void> {
    const tasksPath = await TeamRegistry.getTasksPath(teamName)
    await Filesystem.writeJson(tasksPath, tasks)
  }

  export async function createTask(
    teamName: string,
    description: string,
    options: {
      dependsOn?: string[]
      metadata?: Record<string, any>
    } = {}
  ): Promise<Team.Task> {
    const tasks = await loadTasks(teamName)

    const task: Team.Task = {
      id: ulid(),
      description,
      status: "pending",
      claimedBy: null,
      dependsOn: options.dependsOn || [],
      createdAt: Date.now(),
      metadata: options.metadata,
    }

    tasks.push(task)
    await saveTasks(teamName, tasks)

    log.info(`Created task "${task.id}" in team "${teamName}"`)
    return task
  }

  export async function claimTask(
    teamName: string,
    taskId: string,
    agentName: string
  ): Promise<{ success: boolean; task?: Team.Task; error?: string }> {
    const tasks = await loadTasks(teamName)
    const taskIndex = tasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    const task = tasks[taskIndex]

    if (task.status !== "pending") {
      return { success: false, error: `Task "${taskId}" is not available (status: ${task.status})` }
    }

    // Check dependencies
    if (task.dependsOn && task.dependsOn.length > 0) {
      const incompleteDeps = task.dependsOn.filter((depId) => {
        const dep = tasks.find((t) => t.id === depId)
        return !dep || dep.status !== "completed"
      })

      if (incompleteDeps.length > 0) {
        return {
          success: false,
          error: `Task "${taskId}" has incomplete dependencies: ${incompleteDeps.join(", ")}`,
        }
      }
    }

    // Atomic claim - re-verify status hasn't changed before writing
    const currentTasks = await loadTasks(teamName)
    const currentTaskIndex = currentTasks.findIndex((t) => t.id === taskId)
    if (currentTaskIndex === -1 || currentTasks[currentTaskIndex].status !== "pending") {
      return { success: false, error: `Task "${taskId}" was claimed by another agent` }
    }

    // Perform atomic update
    currentTasks[currentTaskIndex].status = "in_progress"
    currentTasks[currentTaskIndex].claimedBy = agentName
    await saveTasks(teamName, currentTasks)

    // Phase 1: Emit task_claimed event
    const eventBus = getEventBus()
    await eventBus.emit("task_claimed", teamName, {
      taskId,
      agentName,
      claimedAt: Date.now(),
    })

    log.info(`Task "${taskId}" claimed by "${agentName}" in team "${teamName}"`)
    return { success: true, task: currentTasks[currentTaskIndex] }
  }

  export async function completeTask(
    teamName: string,
    taskId: string,
    agentName: string
  ): Promise<{ success: boolean; task?: Team.Task; error?: string }> {
    const tasks = await loadTasks(teamName)
    const taskIndex = tasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    const task = tasks[taskIndex]

    if (task.status !== "in_progress") {
      return { success: false, error: `Task "${taskId}" is not in progress (status: ${task.status})` }
    }

    if (task.claimedBy !== agentName) {
      return {
        success: false,
        error: `Task "${taskId}" is claimed by "${task.claimedBy}", not "${agentName}"`,
      }
    }

    task.status = "completed"
    task.completedAt = Date.now()
    tasks[taskIndex] = task
    await saveTasks(teamName, tasks)

    log.info(`Task "${taskId}" completed by "${agentName}" in team "${teamName}"`)
    return { success: true, task }
  }

  export async function failTask(
    teamName: string,
    taskId: string,
    agentName: string,
    reason?: string
  ): Promise<{ success: boolean; task?: Team.Task; error?: string }> {
    const tasks = await loadTasks(teamName)
    const taskIndex = tasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    const task = tasks[taskIndex]

    if (task.status !== "in_progress") {
      return { success: false, error: `Task "${taskId}" is not in progress (status: ${task.status})` }
    }

    if (task.claimedBy !== agentName) {
      return {
        success: false,
        error: `Task "${taskId}" is claimed by "${task.claimedBy}", not "${agentName}"`,
      }
    }

    task.status = "failed"
    task.completedAt = Date.now()
    if (reason) {
      task.metadata = { ...task.metadata, failureReason: reason }
    }
    tasks[taskIndex] = task
    await saveTasks(teamName, tasks)

    log.info(`Task "${taskId}" failed by "${agentName}" in team "${teamName}": ${reason}`)
    return { success: true, task }
  }

  export async function getTask(teamName: string, taskId: string): Promise<Team.Task | null> {
    const tasks = await loadTasks(teamName)
    return tasks.find((t) => t.id === taskId) || null
  }

  export async function getTasks(
    teamName: string,
    options: {
      status?: Team.TaskStatus
      claimedBy?: string
    } = {}
  ): Promise<Team.Task[]> {
    let tasks = await loadTasks(teamName)

    if (options.status) {
      tasks = tasks.filter((t) => t.status === options.status)
    }

    if (options.claimedBy) {
      tasks = tasks.filter((t) => t.claimedBy === options.claimedBy)
    }

    return tasks
  }

  export async function releaseTask(
    teamName: string,
    taskId: string,
    agentName: string
  ): Promise<{ success: boolean; task?: Team.Task; error?: string }> {
    const tasks = await loadTasks(teamName)
    const taskIndex = tasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    const task = tasks[taskIndex]

    if (task.claimedBy !== agentName) {
      return {
        success: false,
        error: `Task "${taskId}" is claimed by "${task.claimedBy}", not "${agentName}"`,
      }
    }

    task.status = "pending"
    task.claimedBy = null
    tasks[taskIndex] = task
    await saveTasks(teamName, tasks)

    log.info(`Task "${taskId}" released by "${agentName}" in team "${teamName}"`)
    return { success: true, task }
  }

  export async function getBlockedTasks(teamName: string): Promise<Team.Task[]> {
    const tasks = await loadTasks(teamName)
    return tasks.filter((t) => {
      if (t.status !== "pending") return false
      if (!t.dependsOn || t.dependsOn.length === 0) return false

      return t.dependsOn.some((depId) => {
        const dep = tasks.find((task) => task.id === depId)
        return !dep || dep.status !== "completed"
      })
    })
  }

  export async function getAvailableTasks(teamName: string): Promise<Team.Task[]> {
    const tasks = await loadTasks(teamName)
    return tasks.filter((t) => {
      if (t.status !== "pending") return false
      if (!t.dependsOn || t.dependsOn.length === 0) return true

      return t.dependsOn.every((depId) => {
        const dep = tasks.find((task) => task.id === depId)
        return dep && dep.status === "completed"
      })
    })
  }

  // ============================================================================
  // ORCHESTRATION ENGINE FUNCTIONS
  // ============================================================================

  /**
   * Create an orchestrated task with automatic embedding generation
   */
  export async function createOrchestratedTask(
    teamName: string,
    description: string,
    options: {
      dependsOn?: string[]
      metadata?: Record<string, any>
      priority?: Team.TaskPriority
      taskType?: string
      estimatedDifficulty?: number
    } = {}
  ): Promise<Team.OrchestratedTask> {
    const tasks = await loadOrchestratedTasks(teamName)

    // Generate embedding and infer metadata
    const embedding = EmbeddingService.generateTaskEmbedding({
      description,
      taskType: options.taskType,
      metadata: options.metadata,
    })

    const inferredType = options.taskType || EmbeddingService.inferTaskType(description)
    const inferredDifficulty = options.estimatedDifficulty || EmbeddingService.estimateTaskDifficulty(description)

    const task: Team.OrchestratedTask = {
      id: ulid(),
      description,
      status: "pending",
      claimedBy: null,
      dependsOn: options.dependsOn || [],
      createdAt: Date.now(),
      metadata: options.metadata,
      embedding,
      priority: options.priority || "normal",
      attempts: 0,
      assignedHistory: [],
      estimatedDifficulty: inferredDifficulty,
      taskType: inferredType,
    }

    tasks.push(task)
    await saveOrchestratedTasks(teamName, tasks)

    // Phase 1: Emit task_created event for event-driven scheduler
    const eventBus = getEventBus()
    await eventBus.emit("task_created", teamName, {
      taskId: task.id,
      description: task.description,
      taskType: task.taskType || "general",
      priority: task.priority || "normal",
      dependsOn: task.dependsOn || [],
    })

    log.info(`Created orchestrated task "${task.id}" (type: ${inferredType}, difficulty: ${inferredDifficulty}) in team "${teamName}"`)
    return task
  }

  async function loadOrchestratedTasks(teamName: string): Promise<Team.OrchestratedTask[]> {
    const tasksPath = await TeamRegistry.getTasksPath(teamName)
    const exists = await Filesystem.exists(tasksPath)
    if (!exists) return []

    try {
      const content = await Filesystem.readJson<Team.OrchestratedTask[]>(tasksPath)
      return content || []
    } catch {
      return []
    }
  }

  export async function saveOrchestratedTasks(teamName: string, tasks: Team.OrchestratedTask[]): Promise<void> {
    const tasksPath = await TeamRegistry.getTasksPath(teamName)
    await Filesystem.writeJson(tasksPath, tasks)
  }

  /**
   * Select the best agent for a task using the scoring engine
   */
  export async function selectBestAgent(
    teamName: string,
    taskId: string
  ): Promise<{
    bestAgent: string | null
    score: number
    allScores: Array<{ agentName: string; score: number; components: any }>
    error?: string
  }> {
    // Load task
    const tasks = await loadOrchestratedTasks(teamName)
    const task = tasks.find((t) => t.id === taskId)

    if (!task) {
      return { bestAgent: null, score: 0, allScores: [], error: `Task "${taskId}" not found` }
    }

    // Load team config
    const team = await TeamRegistry.getTeam(teamName)
    if (!team) {
      return { bestAgent: null, score: 0, allScores: [], error: `Team "${teamName}" not found` }
    }

    // Load all agent capabilities and stats
    const agents: Array<{
      capabilities: Team.AgentCapabilities
      stats: Team.AgentStats
    }> = []

    for (const member of team.members) {
      const capabilities = await TeamRegistry.ensureAgentCapabilities(teamName, member.name, member)
      const stats = await TeamRegistry.getAgentStat(teamName, member.name) || {
        agentName: member.name,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        taskTypeStats: {},
        reliabilityScore: 0.5,
        activeTasks: 0,
        updatedAt: Date.now(),
      }
      agents.push({ capabilities, stats })
    }

    // Use scoring engine to select best agent
    const result = ScoringEngine.selectBestAgent(task, agents, tasks)

    return {
      bestAgent: result.bestAgent,
      score: result.score,
      allScores: result.scores.map((s) => ({
        agentName: s.agentName,
        score: s.score,
        components: s.result.components,
      })),
    }
  }

  /**
   * Auto-claim the best available task for an agent
   */
  export async function autoClaimTask(
    teamName: string,
    agentName: string,
    options: {
      minScore?: number
      maxActiveTasks?: number
    } = {}
  ): Promise<{
    success: boolean
    task?: Team.OrchestratedTask
    score?: number
    components?: any
    error?: string
  }> {
    // Load team config
    const team = await TeamRegistry.getTeam(teamName)
    if (!team) {
      return { success: false, error: `Team "${teamName}" not found` }
    }

    // Find agent config
    const memberConfig = team.members.find((m) => m.name === agentName)
    if (!memberConfig) {
      return { success: false, error: `Agent "${agentName}" is not a member of team "${teamName}"` }
    }

    // Load agent capabilities and stats
    const capabilities = await TeamRegistry.ensureAgentCapabilities(teamName, agentName, memberConfig)
    const stats = await TeamRegistry.getAgentStat(teamName, agentName) || {
      agentName,
      totalTasks: 0,
      successfulTasks: 0,
      failedTasks: 0,
      taskTypeStats: {},
      reliabilityScore: 0.5,
      activeTasks: 0,
      updatedAt: Date.now(),
    }

    // Load available tasks
    const tasks = await loadOrchestratedTasks(teamName)
    const availableTasks = tasks.filter((t) => t.status === "pending")

    // Load all agent stats for exploration bonus calculation
    const allAgentStats = await TeamRegistry.loadAgentStats(teamName)

    // Use scoring engine to find best task
    const recommendation = ScoringEngine.shouldAutoClaim(
      capabilities,
      stats,
      availableTasks,
      allAgentStats,
      options
    )

    if (!recommendation) {
      return { success: false, error: "No suitable task found" }
    }

    const { task, score, result } = recommendation

    // Attempt to claim the task
    const claimResult = await claimTask(teamName, task.id, agentName)

    if (!claimResult.success) {
      return { success: false, error: claimResult.error || "Failed to claim task" }
    }

    // Update task with assignment history
    const updatedTasks = await loadOrchestratedTasks(teamName)
    const taskIndex = updatedTasks.findIndex((t) => t.id === task.id)
    if (taskIndex >= 0) {
      updatedTasks[taskIndex].attempts = (updatedTasks[taskIndex].attempts || 0) + 1
      updatedTasks[taskIndex].assignedHistory = [...(updatedTasks[taskIndex].assignedHistory || []), agentName]
      await saveOrchestratedTasks(teamName, updatedTasks)
    }

    // Update agent stats
    await TeamRegistry.updateAgentStat(teamName, agentName, (s) => ({
      ...s,
      activeTasks: (s.activeTasks || 0) + 1,
      lastActiveAt: Date.now(),
    }))

    log.info(`Auto-claimed task "${task.id}" for agent "${agentName}" with score ${score.toFixed(3)}`)

    return {
      success: true,
      task: updatedTasks[taskIndex] || task,
      score,
      components: result.components,
    }
  }

  /**
   * Complete a task and update agent stats
   */
  export async function completeOrchestratedTask(
    teamName: string,
    taskId: string,
    agentName: string
  ): Promise<{ success: boolean; task?: Team.OrchestratedTask; error?: string }> {
    const tasks = await loadOrchestratedTasks(teamName)
    const taskIndex = tasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    const task = tasks[taskIndex]

    if (task.status !== "in_progress") {
      return { success: false, error: `Task "${taskId}" is not in progress (status: ${task.status})` }
    }

    if (task.claimedBy !== agentName) {
      return {
        success: false,
        error: `Task "${taskId}" is claimed by "${task.claimedBy}", not "${agentName}"`,
      }
    }

    const completionTime = Date.now() - (task.createdAt || Date.now())

    // Update task
    task.status = "completed"
    task.completedAt = Date.now()
    tasks[taskIndex] = task
    await saveOrchestratedTasks(teamName, tasks)

    // Update agent stats
    await TeamRegistry.updateAgentStat(teamName, agentName, (stats) => {
      const taskType = task.taskType || "general"
      const typeStats = stats.taskTypeStats[taskType] || {
        attempts: 0,
        successes: 0,
        totalCompletionTime: 0,
        avgCompletionTime: 0,
      }

      const newSuccesses = typeStats.successes + 1
      const newTotalTime = typeStats.totalCompletionTime + completionTime

      return {
        ...stats,
        totalTasks: (stats.totalTasks || 0) + 1,
        successfulTasks: (stats.successfulTasks || 0) + 1,
        activeTasks: Math.max(0, (stats.activeTasks || 0) - 1),
        reliabilityScore: Math.min(1, stats.reliabilityScore + 0.02), // Small boost on success
        taskTypeStats: {
          ...stats.taskTypeStats,
          [taskType]: {
            attempts: typeStats.attempts + 1,
            successes: newSuccesses,
            totalCompletionTime: newTotalTime,
            avgCompletionTime: newTotalTime / newSuccesses,
          },
        },
        updatedAt: Date.now(),
      }
    })

    // Record success with circuit breaker
    CircuitBreaker.recordTaskOutcome(teamName, agentName, true)

    // Phase 4: Update adaptive scoring weights on success
    const { ScoringEngine } = await import("./scorer")
    ScoringEngine.updateWeights(taskId, agentName, task.taskType || "general", true, completionTime)

    // Phase 1: Emit task_completed event
    const eventBus = getEventBus()
    await eventBus.emit("task_completed", teamName, {
      taskId,
      agentName,
      completionTime,
      taskType: task.taskType || "general",
    })

    log.info(`Orchestrated task "${taskId}" completed by "${agentName}" in ${completionTime}ms`)
    return { success: true, task }
  }

  /**
   * Fail a task and update agent stats with penalty
   */
  export async function failOrchestratedTask(
    teamName: string,
    taskId: string,
    agentName: string,
    reason?: string
  ): Promise<{ success: boolean; task?: Team.OrchestratedTask; error?: string }> {
    const tasks = await loadOrchestratedTasks(teamName)
    const taskIndex = tasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    const task = tasks[taskIndex]

    if (task.status !== "in_progress") {
      return { success: false, error: `Task "${taskId}" is not in progress (status: ${task.status})` }
    }

    if (task.claimedBy !== agentName) {
      return {
        success: false,
        error: `Task "${taskId}" is claimed by "${task.claimedBy}", not "${agentName}"`,
      }
    }

    // Update task - mark as failed but allow retry
    task.status = "failed"
    task.completedAt = Date.now()
    task.metadata = {
      ...task.metadata,
      failureReason: reason,
      failedAt: Date.now(),
      failedBy: agentName,
    }
    tasks[taskIndex] = task

    // If attempts < 3, requeue for retry by resetting to pending
    const maxAttempts = 3
    if ((task.attempts || 0) < maxAttempts) {
      // Create a new task copy for retry (or reset this one)
      task.status = "pending"
      task.claimedBy = null
      tasks[taskIndex] = task
      log.info(`Task "${taskId}" failed but will be retried (attempt ${task.attempts}/${maxAttempts})`)
    }

    await saveOrchestratedTasks(teamName, tasks)

    // Update agent stats with penalty
    await TeamRegistry.updateAgentStat(teamName, agentName, (stats) => ({
      ...stats,
      totalTasks: (stats.totalTasks || 0) + 1,
      failedTasks: (stats.failedTasks || 0) + 1,
      activeTasks: Math.max(0, (stats.activeTasks || 0) - 1),
      reliabilityScore: Math.max(0, stats.reliabilityScore - 0.05), // Penalty on failure
      updatedAt: Date.now(),
    }))

    // Record failure with circuit breaker
    CircuitBreaker.recordTaskOutcome(teamName, agentName, false)

    // Phase 4: Update adaptive scoring weights on failure
    const { ScoringEngine } = await import("./scorer")
    ScoringEngine.updateWeights(taskId, agentName, task.taskType || "general", false)

    // Phase 1: Emit task_failed event
    const eventBus = getEventBus()
    await eventBus.emit("task_failed", teamName, {
      taskId,
      agentName,
      reason,
      attempt: task.attempts || 1,
    })

    log.info(`Orchestrated task "${taskId}" failed by "${agentName}": ${reason}`)
    return { success: true, task }
  }

  /**
   * Get all orchestrated tasks for a team
   */
  export async function getOrchestratedTasks(teamName: string): Promise<Team.OrchestratedTask[]> {
    return await loadOrchestratedTasks(teamName)
  }

  /**
   * Get tasks that are ready for execution (dependencies satisfied)
   */
  export async function getDependencyReadyTasks(teamName: string): Promise<Team.OrchestratedTask[]> {
    const tasks = await loadOrchestratedTasks(teamName)
    return tasks.filter((t) => {
      if (t.status !== "pending") return false

      const depStatus = ScoringEngine.dependencyReady(t, tasks)
      return depStatus.ready
    })
  }

  /**
   * Rank all pending tasks by priority and readiness
   */
  export async function rankPendingTasks(
    teamName: string
  ): Promise<Array<{ task: Team.OrchestratedTask; priorityScore: number; ready: boolean }>> {
    const tasks = await loadOrchestratedTasks(teamName)
    const pendingTasks = tasks.filter((t) => t.status === "pending")

    const priorityWeights: Record<Team.TaskPriority, number> = {
      low: 1,
      normal: 2,
      high: 4,
      critical: 8,
    }

    return pendingTasks.map((task) => {
      const depStatus = ScoringEngine.dependencyReady(task, tasks)
      const priorityScore = priorityWeights[task.priority || "normal"] * (depStatus.ready ? 2 : 1)

      return {
        task,
        priorityScore,
        ready: depStatus.ready,
      }
    }).sort((a, b) => b.priorityScore - a.priorityScore)
  }

  /**
   * Update critical path lengths for tasks (Phase 2: DAG Critical Path Priority)
   * Called by scheduler to persist computed critical path lengths
   */
  export async function updateTasksCriticalPath(
    teamName: string,
    tasksToUpdate: Team.OrchestratedTask[]
  ): Promise<void> {
    if (tasksToUpdate.length === 0) return

    const tasks = await loadOrchestratedTasks(teamName)
    let modified = false

    for (const updatedTask of tasksToUpdate) {
      const taskIndex = tasks.findIndex((t) => t.id === updatedTask.id)
      if (taskIndex >= 0) {
        tasks[taskIndex].criticalPathLength = updatedTask.criticalPathLength
        tasks[taskIndex].criticalPathWeight = updatedTask.criticalPathWeight
        modified = true
      }
    }

    if (modified) {
      await saveOrchestratedTasks(teamName, tasks)
    }
  }

  /**
   * Update task dependencies and invalidate critical path cache
   * Phase 2: Cache invalidation when dependencies change
   */
  export async function updateTaskDependencies(
    teamName: string,
    taskId: string,
    newDependencies: string[]
  ): Promise<{ success: boolean; error?: string }> {
    const tasks = await loadOrchestratedTasks(teamName)
    const taskIndex = tasks.findIndex((t) => t.id === taskId)

    if (taskIndex === -1) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    const oldDependencies = tasks[taskIndex].dependsOn || []

    // Check if dependencies actually changed
    const depsChanged =
      oldDependencies.length !== newDependencies.length ||
      oldDependencies.some((dep) => !newDependencies.includes(dep))

    if (!depsChanged) {
      return { success: true }
    }

    // Update dependencies
    tasks[taskIndex].dependsOn = newDependencies
    await saveOrchestratedTasks(teamName, tasks)

    // Import and invalidate critical path cache for this task and its dependents
    const { TeamScheduler } = await import("./scheduler")
    TeamScheduler.invalidateCriticalPathCache(taskId, tasks)

    log.info(`Updated dependencies for task "${taskId}" and invalidated critical path cache`)
    return { success: true }
  }
}
