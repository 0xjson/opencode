import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { TeamTasks } from "../tasks"
import { Team } from "../schema"
import path from "path"
import os from "os"
import { Filesystem } from "../../util/filesystem"
import { TeamRegistry } from "../registry"

const TEST_TEAM_DIR = path.join(os.tmpdir(), "opencode-test-teams", Date.now().toString())

describe("TeamTasks", () => {
  const TEST_TEAM = "test-task-team"
  const originalEnv = process.env.OPENCODE_TEAMS_DIR

  beforeEach(async () => {
    // Set test isolation environment variable
    process.env.OPENCODE_TEAMS_DIR = TEST_TEAM_DIR

    try {
      await Filesystem.rmdir(TEST_TEAM_DIR, { recursive: true })
    } catch {
      // Directory might not exist
    }
    await Filesystem.mkdirp(TEST_TEAM_DIR)

    // Create a test team first
    await TeamRegistry.createTeam({
      team: TEST_TEAM,
      lead: "test-lead",
      members: [{ name: "agent1", agentType: "general-purpose" }],
    })
  })

  afterEach(async () => {
    try {
      await Filesystem.rmdir(TEST_TEAM_DIR, { recursive: true })
    } catch {
      // Directory might not exist
    }
    // Restore original environment variable
    process.env.OPENCODE_TEAMS_DIR = originalEnv
  })

  describe("createTask", () => {
    it("should create a task with pending status", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Test task")

      expect(task.description).toBe("Test task")
      expect(task.status).toBe("pending")
      expect(task.claimedBy).toBeNull()
      expect(task.id).toBeDefined()
      expect(task.createdAt).toBeDefined()
    })

    it("should create a task with dependencies", async () => {
      const depTask = await TeamTasks.createTask(TEST_TEAM, "Dependency")
      const task = await TeamTasks.createTask(TEST_TEAM, "Dependent task", {
        dependsOn: [depTask.id],
      })

      expect(task.dependsOn).toContain(depTask.id)
    })

    it("should create a task with metadata", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Task with metadata", {
        metadata: { priority: "high", category: "bug" },
      })

      expect(task.metadata).toEqual({ priority: "high", category: "bug" })
    })

    it("should generate unique task IDs", async () => {
      const task1 = await TeamTasks.createTask(TEST_TEAM, "Task 1")
      const task2 = await TeamTasks.createTask(TEST_TEAM, "Task 2")

      expect(task1.id).not.toBe(task2.id)
    })
  })

  describe("claimTask - Atomicity Tests", () => {
    it("should successfully claim a pending task", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Claimable task")

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe("in_progress")
      expect(result.task?.claimedBy).toBe("agent1")
    })

    it("should reject claim for non-existent task", async () => {
      const result = await TeamTasks.claimTask(TEST_TEAM, "non-existent-id", "agent1")

      expect(result.success).toBe(false)
      expect(result.error).toContain("not found")
    })

    it("should reject claim for already claimed task", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Already claimed")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent2")

      expect(result.success).toBe(false)
      expect(result.error).toContain("not available")
    })

    it("should reject claim for completed task", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Completed task")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent2")

      expect(result.success).toBe(false)
      expect(result.error).toContain("not available")
    })

    it("should reject claim for failed task", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Failed task")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")
      await TeamTasks.failTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent2")

      expect(result.success).toBe(false)
      expect(result.error).toContain("not available")
    })

    it("should enforce dependency completion before claim", async () => {
      const depTask = await TeamTasks.createTask(TEST_TEAM, "Dependency")
      const task = await TeamTasks.createTask(TEST_TEAM, "Has dependency", {
        dependsOn: [depTask.id],
      })

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(false)
      expect(result.error).toContain("incomplete dependencies")
      expect(result.error).toContain(depTask.id)
    })

    it("should allow claim when all dependencies are completed", async () => {
      const depTask = await TeamTasks.createTask(TEST_TEAM, "Dependency")
      const task = await TeamTasks.createTask(TEST_TEAM, "Has dependency", {
        dependsOn: [depTask.id],
      })

      await TeamTasks.claimTask(TEST_TEAM, depTask.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, depTask.id, "agent1")

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(true)
    })

    it("should handle multiple dependencies", async () => {
      const dep1 = await TeamTasks.createTask(TEST_TEAM, "Dependency 1")
      const dep2 = await TeamTasks.createTask(TEST_TEAM, "Dependency 2")
      const task = await TeamTasks.createTask(TEST_TEAM, "Multiple deps", {
        dependsOn: [dep1.id, dep2.id],
      })

      // Complete only one dependency
      await TeamTasks.claimTask(TEST_TEAM, dep1.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, dep1.id, "agent1")

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")
      expect(result.success).toBe(false)
      expect(result.error).toContain(dep2.id)

      // Complete second dependency
      await TeamTasks.claimTask(TEST_TEAM, dep2.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, dep2.id, "agent1")

      const result2 = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")
      expect(result2.success).toBe(true)
    })

    it("should handle dependency on non-existent task", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Broken dependency", {
        dependsOn: ["non-existent-dep"],
      })

      const result = await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(false)
      expect(result.error).toContain("non-existent-dep")
    })

    it("should persist task state after claim", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Persistence test")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      // Reload tasks from disk
      const loadedTask = await TeamTasks.getTask(TEST_TEAM, task.id)
      expect(loadedTask?.status).toBe("in_progress")
      expect(loadedTask?.claimedBy).toBe("agent1")
    })
  })

  describe("completeTask - State Transitions", () => {
    it("should transition from in_progress to completed", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Complete test")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.completeTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe("completed")
      expect(result.task?.completedAt).toBeDefined()
    })

    it("should reject completion by non-claimant", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Wrong agent")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.completeTask(TEST_TEAM, task.id, "agent2")

      expect(result.success).toBe(false)
      expect(result.error).toContain("claimed by")
    })

    it("should reject completion of pending task", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Not claimed")

      const result = await TeamTasks.completeTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(false)
      expect(result.error).toContain("not in progress")
    })

    it("should reject completion of already completed task", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Already done")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.completeTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(false)
      expect(result.error).toContain("not in progress")
    })
  })

  describe("failTask", () => {
    it("should transition from in_progress to failed", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Fail test")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.failTask(TEST_TEAM, task.id, "agent1", "Something went wrong")

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe("failed")
      expect(result.task?.metadata?.failureReason).toBe("Something went wrong")
    })

    it("should fail without reason", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Fail without reason")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.failTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe("failed")
      expect(result.task?.metadata?.failureReason).toBeUndefined()
    })

    it("should reject failure by non-claimant", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Wrong agent fail")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.failTask(TEST_TEAM, task.id, "agent2")

      expect(result.success).toBe(false)
      expect(result.error).toContain("claimed by")
    })
  })

  describe("releaseTask", () => {
    it("should release claimed task back to pending", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Release test")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.releaseTask(TEST_TEAM, task.id, "agent1")

      expect(result.success).toBe(true)
      expect(result.task?.status).toBe("pending")
      expect(result.task?.claimedBy).toBeNull()
    })

    it("should reject release by non-claimant", async () => {
      const task = await TeamTasks.createTask(TEST_TEAM, "Wrong agent release")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")

      const result = await TeamTasks.releaseTask(TEST_TEAM, task.id, "agent2")

      expect(result.success).toBe(false)
      expect(result.error).toContain("claimed by")
    })
  })

  describe("getAvailableTasks", () => {
    it("should return only pending tasks with satisfied dependencies", async () => {
      // Create tasks
      const freeTask = await TeamTasks.createTask(TEST_TEAM, "Free task")
      const depTask = await TeamTasks.createTask(TEST_TEAM, "Dependency")
      const blockedTask = await TeamTasks.createTask(TEST_TEAM, "Blocked task", {
        dependsOn: [depTask.id],
      })
      const claimedTask = await TeamTasks.createTask(TEST_TEAM, "Claimed task")
      await TeamTasks.claimTask(TEST_TEAM, claimedTask.id, "agent1")

      const available = await TeamTasks.getAvailableTasks(TEST_TEAM)

      // freeTask and depTask are both pending with no dependencies
      expect(available).toHaveLength(2)
      expect(available.map((t) => t.id)).toContain(freeTask.id)
      expect(available.map((t) => t.id)).toContain(depTask.id)
    })

    it("should return empty array when all tasks are blocked", async () => {
      const task1 = await TeamTasks.createTask(TEST_TEAM, "Task 1")
      const task2 = await TeamTasks.createTask(TEST_TEAM, "Task 2", {
        dependsOn: [task1.id],
      })

      // Only task1 is available (task2 depends on task1)
      const available = await TeamTasks.getAvailableTasks(TEST_TEAM)
      expect(available).toHaveLength(1)
      expect(available[0].id).toBe(task1.id)

      // Claim task1, task2 should now be blocked (dependency not completed)
      await TeamTasks.claimTask(TEST_TEAM, task1.id, "agent1")

      const availableAfter = await TeamTasks.getAvailableTasks(TEST_TEAM)
      expect(availableAfter).toHaveLength(0) // Task1 claimed, Task2 blocked
    })
  })

  describe("getBlockedTasks", () => {
    it("should return tasks with incomplete dependencies", async () => {
      const depTask = await TeamTasks.createTask(TEST_TEAM, "Dependency")
      const blockedTask = await TeamTasks.createTask(TEST_TEAM, "Blocked task", {
        dependsOn: [depTask.id],
      })

      const blocked = await TeamTasks.getBlockedTasks(TEST_TEAM)

      expect(blocked).toHaveLength(1)
      expect(blocked[0].id).toBe(blockedTask.id)
    })

    it("should return empty array when no tasks are blocked", async () => {
      await TeamTasks.createTask(TEST_TEAM, "Free task 1")
      await TeamTasks.createTask(TEST_TEAM, "Free task 2")

      const blocked = await TeamTasks.getBlockedTasks(TEST_TEAM)
      expect(blocked).toHaveLength(0)
    })

    it("should exclude completed tasks even if they had dependencies", async () => {
      const depTask = await TeamTasks.createTask(TEST_TEAM, "Dependency")
      const task = await TeamTasks.createTask(TEST_TEAM, "Task", {
        dependsOn: [depTask.id],
      })

      // Complete dependency and task
      await TeamTasks.claimTask(TEST_TEAM, depTask.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, depTask.id, "agent1")
      await TeamTasks.claimTask(TEST_TEAM, task.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, task.id, "agent1")

      const blocked = await TeamTasks.getBlockedTasks(TEST_TEAM)
      expect(blocked).toHaveLength(0)
    })
  })

  describe("getTasks", () => {
    it("should filter by status", async () => {
      const task1 = await TeamTasks.createTask(TEST_TEAM, "Task 1")
      const task2 = await TeamTasks.createTask(TEST_TEAM, "Task 2")
      await TeamTasks.claimTask(TEST_TEAM, task2.id, "agent1")

      const pending = await TeamTasks.getTasks(TEST_TEAM, { status: "pending" })
      const inProgress = await TeamTasks.getTasks(TEST_TEAM, { status: "in_progress" })

      expect(pending).toHaveLength(1)
      expect(pending[0].id).toBe(task1.id)
      expect(inProgress).toHaveLength(1)
      expect(inProgress[0].id).toBe(task2.id)
    })

    it("should filter by claimedBy", async () => {
      const task1 = await TeamTasks.createTask(TEST_TEAM, "Task 1")
      const task2 = await TeamTasks.createTask(TEST_TEAM, "Task 2")
      await TeamTasks.claimTask(TEST_TEAM, task1.id, "agent1")
      await TeamTasks.claimTask(TEST_TEAM, task2.id, "agent2")

      const agent1Tasks = await TeamTasks.getTasks(TEST_TEAM, { claimedBy: "agent1" })

      expect(agent1Tasks).toHaveLength(1)
      expect(agent1Tasks[0].id).toBe(task1.id)
    })

    it("should combine filters", async () => {
      const task1 = await TeamTasks.createTask(TEST_TEAM, "Task 1")
      const task2 = await TeamTasks.createTask(TEST_TEAM, "Task 2")
      await TeamTasks.claimTask(TEST_TEAM, task1.id, "agent1")
      await TeamTasks.claimTask(TEST_TEAM, task2.id, "agent1")
      await TeamTasks.completeTask(TEST_TEAM, task2.id, "agent1")

      const completedByAgent1 = await TeamTasks.getTasks(TEST_TEAM, {
        status: "completed",
        claimedBy: "agent1",
      })

      expect(completedByAgent1).toHaveLength(1)
      expect(completedByAgent1[0].id).toBe(task2.id)
    })
  })

  describe("Concurrent Operations", () => {
    it("should handle concurrent task creation", async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        TeamTasks.createTask(TEST_TEAM, `Concurrent task ${i}`)
      )

      const tasks = await Promise.all(promises)

      expect(tasks).toHaveLength(10)
      const ids = tasks.map((t) => t.id)
      expect(new Set(ids).size).toBe(10) // All IDs unique
    })
  })
})
