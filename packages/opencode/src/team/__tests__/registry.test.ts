import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { TeamRegistry } from "../registry"
import path from "path"
import os from "os"
import { Filesystem } from "../../util/filesystem"

const TEST_TEAM_DIR = path.join(os.tmpdir(), "opencode-test-teams", Date.now().toString())

describe("TeamRegistry", () => {
  const testTeam = {
    team: "test-team",
    lead: "test-lead",
    description: "Test team for unit tests",
    members: [
      { name: "member1", agentType: "general-purpose" },
      { name: "member2", agentType: "Explore", model: "haiku" },
    ],
  }

  beforeEach(async () => {
    // Clean up any existing test directory
    try {
      await Filesystem.rmdir(TEST_TEAM_DIR, { recursive: true })
    } catch {
      // Directory might not exist
    }
    await Filesystem.mkdirp(TEST_TEAM_DIR)

    // Monkey-patch the TEAM_DIR constant
    const originalModule = await import("../registry")
    Object.defineProperty(originalModule.TeamRegistry, "TEAM_DIR", {
      value: TEST_TEAM_DIR,
      writable: true,
    })
  })

  afterEach(async () => {
    try {
      await Filesystem.rmdir(TEST_TEAM_DIR, { recursive: true })
    } catch {
      // Directory might not exist
    }
  })

  describe("createTeam", () => {
    it("should create a new team", async () => {
      await TeamRegistry.createTeam(testTeam)

      const configPath = path.join(TEST_TEAM_DIR, "test-team", "config.json")
      const exists = await Filesystem.exists(configPath)
      expect(exists).toBe(true)
    })

    it("should throw if team already exists", async () => {
      await TeamRegistry.createTeam(testTeam)
      await expect(TeamRegistry.createTeam(testTeam)).rejects.toThrow('Team "test-team" already exists')
    })

    it("should add createdAt timestamp", async () => {
      await TeamRegistry.createTeam(testTeam)
      const team = await TeamRegistry.getTeam("test-team")
      expect(team?.createdAt).toBeDefined()
      expect(typeof team?.createdAt).toBe("number")
    })
  })

  describe("getTeam", () => {
    it("should retrieve existing team", async () => {
      await TeamRegistry.createTeam(testTeam)
      const team = await TeamRegistry.getTeam("test-team")

      expect(team).toBeDefined()
      expect(team?.team).toBe("test-team")
      expect(team?.lead).toBe("test-lead")
      expect(team?.members).toHaveLength(2)
    })

    it("should return null for non-existent team", async () => {
      const team = await TeamRegistry.getTeam("non-existent")
      expect(team).toBeNull()
    })

    it("should handle corrupted config gracefully", async () => {
      const teamDir = path.join(TEST_TEAM_DIR, "corrupted-team")
      await Filesystem.mkdirp(teamDir)
      await Filesystem.writeText(path.join(teamDir, "config.json"), "invalid json")

      const team = await TeamRegistry.getTeam("corrupted-team")
      expect(team).toBeNull()
    })
  })

  describe("listTeams", () => {
    it("should return empty array when no teams exist", async () => {
      const teams = await TeamRegistry.listTeams()
      expect(teams).toEqual([])
    })

    it("should list all created teams", async () => {
      await TeamRegistry.createTeam({ ...testTeam, team: "team-1" })
      await TeamRegistry.createTeam({ ...testTeam, team: "team-2" })
      await TeamRegistry.createTeam({ ...testTeam, team: "team-3" })

      const teams = await TeamRegistry.listTeams()
      expect(teams).toHaveLength(3)
      expect(teams.sort()).toEqual(["team-1", "team-2", "team-3"])
    })

    it("should ignore directories without config.json", async () => {
      await TeamRegistry.createTeam(testTeam)
      await Filesystem.mkdirp(path.join(TEST_TEAM_DIR, "empty-team"))

      const teams = await TeamRegistry.listTeams()
      expect(teams).toEqual(["test-team"])
    })
  })

  describe("teamExists", () => {
    it("should return true for existing team", async () => {
      await TeamRegistry.createTeam(testTeam)
      expect(await TeamRegistry.teamExists("test-team")).toBe(true)
    })

    it("should return false for non-existent team", async () => {
      expect(await TeamRegistry.teamExists("non-existent")).toBe(false)
    })
  })

  describe("updateTeam", () => {
    it("should update team properties", async () => {
      await TeamRegistry.createTeam(testTeam)
      await TeamRegistry.updateTeam("test-team", { description: "Updated description" })

      const team = await TeamRegistry.getTeam("test-team")
      expect(team?.description).toBe("Updated description")
    })

    it("should preserve other properties when updating", async () => {
      await TeamRegistry.createTeam(testTeam)
      await TeamRegistry.updateTeam("test-team", { description: "Updated" })

      const team = await TeamRegistry.getTeam("test-team")
      expect(team?.team).toBe("test-team")
      expect(team?.lead).toBe("test-lead")
      expect(team?.members).toHaveLength(2)
    })

    it("should throw for non-existent team", async () => {
      await expect(TeamRegistry.updateTeam("non-existent", { description: "Updated" })).rejects.toThrow(
        'Team "non-existent" not found'
      )
    })
  })

  describe("deleteTeam", () => {
    it("should delete existing team", async () => {
      await TeamRegistry.createTeam(testTeam)
      await TeamRegistry.deleteTeam("test-team")

      const exists = await TeamRegistry.teamExists("test-team")
      expect(exists).toBe(false)
    })

    it("should throw for non-existent team", async () => {
      await expect(TeamRegistry.deleteTeam("non-existent")).rejects.toThrow('Team "non-existent" not found')
    })
  })

  describe("path utilities", () => {
    it("should return correct team config path", async () => {
      const configPath = await TeamRegistry.getTeamConfigPath("my-team")
      expect(configPath).toContain("my-team")
      expect(configPath).toContain("config.json")
    })

    it("should return correct inbox path", async () => {
      const inboxPath = await TeamRegistry.getInboxPath("my-team", "agent1")
      expect(inboxPath).toContain("my-team")
      expect(inboxPath).toContain("inboxes")
      expect(inboxPath).toContain("agent1.jsonl")
    })

    it("should return correct tasks path", async () => {
      const tasksPath = await TeamRegistry.getTasksPath("my-team")
      expect(tasksPath).toContain("my-team")
      expect(tasksPath).toContain("tasks.json")
    })

    it("should return correct sessions path", async () => {
      const sessionsPath = await TeamRegistry.getSessionsPath("my-team")
      expect(sessionsPath).toContain("my-team")
      expect(sessionsPath).toContain("sessions.json")
    })
  })
})
