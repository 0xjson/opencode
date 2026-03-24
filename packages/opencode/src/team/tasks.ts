import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { ulid } from "ulid"

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
}
