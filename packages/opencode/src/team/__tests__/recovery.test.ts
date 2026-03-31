import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import type { RecoveryStatus, RecoveryResult } from "../recovery"
import { TeamRecovery } from "../recovery"
import { TeamSession } from "../session"
import { TeamInbox } from "../inbox"
import { TeamRegistry } from "../registry"
import { Team } from "../schema"
import path from "path"
import os from "os"
import { Filesystem } from "../../util/filesystem"

const TEST_TEAM_DIR = path.join(os.tmpdir(), "opencode-test-recovery-teams", Date.now().toString())

describe("TeamRecovery", () => {
  const TEST_TEAM = "test-recovery-team"
  const originalEnv = process.env.OPENCODE_TEAMS_DIR

  beforeEach(async () => {
    process.env.OPENCODE_TEAMS_DIR = TEST_TEAM_DIR

    try {
      await Filesystem.rmdir(TEST_TEAM_DIR, { recursive: true })
    } catch {
      // Directory might not exist
    }
    await Filesystem.mkdirp(TEST_TEAM_DIR)

    await TeamRegistry.createTeam({
      team: TEST_TEAM,
      lead: "test-lead",
      members: [
        { name: "agent1", agentType: "general-purpose" },
        { name: "agent2", agentType: "Explore" },
        { name: "agent3", agentType: "Plan" },
      ],
    })
  })

  afterEach(async () => {
    try {
      await Filesystem.rmdir(TEST_TEAM_DIR, { recursive: true })
    } catch {
      // Directory might not exist
    }
    process.env.OPENCODE_TEAMS_DIR = originalEnv
  })

  describe("getRecoveryStatus", () => {
    it("should return correct counts for all session states", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")
      const session3 = await TeamSession.createSession(TEST_TEAM, "agent3", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session1.sessionId, "busy")
      await TeamSession.updateSessionStatus(TEST_TEAM, session2.sessionId, "error")
      await TeamSession.requestShutdown(TEST_TEAM, session3.sessionId)
      await TeamSession.confirmShutdown(TEST_TEAM, session3.sessionId)

      const status = await TeamRecovery.getRecoveryStatus(TEST_TEAM)

      expect(status.teamName).toBe(TEST_TEAM)
      expect(status.ready).toBe(0)
      expect(status.busy).toBe(1)
      expect(status.error).toBe(1)
      expect(status.shutdown).toBe(1)
      expect(status.total).toBe(3)
      expect(status.healthy).toBe(false)
    })

    it("should report healthy when no error sessions", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session1.sessionId, "busy")

      const status = await TeamRecovery.getRecoveryStatus(TEST_TEAM)

      expect(status.healthy).toBe(true)
      expect(status.ready).toBe(1)
      expect(status.busy).toBe(1)
      expect(status.error).toBe(0)
    })

    it("should count shutdown_requested state correctly", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.requestShutdown(TEST_TEAM, session1.sessionId)

      const status = await TeamRecovery.getRecoveryStatus(TEST_TEAM)

      expect(status.shutdownRequested).toBe(1)
      expect(status.shutdown).toBe(0)
    })

    it("should throw error for non-existent team", async () => {
      await expect(TeamRecovery.getRecoveryStatus("non-existent-team")).rejects.toThrow('Team "non-existent-team" not found')
    })
  })

  describe("recoverTeam", () => {
    it("should recover busy sessions to ready state", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session1.sessionId, "busy")
      await TeamSession.updateExecutionStatus(TEST_TEAM, session1.sessionId, "thinking")

      const result = await TeamRecovery.recoverTeam(TEST_TEAM)

      expect(result.teamName).toBe(TEST_TEAM)
      expect(result.recoveryCount).toBe(1)
      expect(result.recoveredSessions).toHaveLength(1)
      expect(result.recoveredSessions[0].sessionId).toBe(session1.sessionId)

      const recovered = await TeamSession.getSession(TEST_TEAM, session1.sessionId)
      expect(recovered?.status).toBe("ready")
      expect(recovered?.executionStatus).toBe("idle")

      const unchanged = await TeamSession.getSession(TEST_TEAM, session2.sessionId)
      expect(unchanged?.status).toBe("ready")
    })

    it("should return empty result when no busy sessions", async () => {
      await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      const result = await TeamRecovery.recoverTeam(TEST_TEAM)

      expect(result.recoveryCount).toBe(0)
      expect(result.recoveredSessions).toHaveLength(0)
    })

    it("should throw error for non-existent team", async () => {
      await expect(TeamRecovery.recoverTeam("non-existent-team")).rejects.toThrow('Team "non-existent-team" not found')
    })

    it("should persist recovery changes to disk", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

      await TeamRecovery.recoverTeam(TEST_TEAM)

      // Reload from disk
      const updated = await TeamSession.getSession(TEST_TEAM, session.sessionId)
      expect(updated?.status).toBe("ready")
      expect(updated?.executionStatus).toBe("idle")
    })
  })

  describe("scanAndRecover", () => {
    it("should scan all teams and recover crashed sessions", async () => {
      const TEST_TEAM_2 = "test-recovery-team-2"
      await TeamRegistry.createTeam({
        team: TEST_TEAM_2,
        lead: "test-lead-2",
        members: [{ name: "agent1", agentType: "general-purpose" }],
      })

      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM_2, "agent1", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session1.sessionId, "busy")
      await TeamSession.updateSessionStatus(TEST_TEAM_2, session2.sessionId, "busy")

      const results = await TeamRecovery.scanAndRecover()

      expect(results).toHaveLength(2)

      const team1Result = results.find(r => r.teamName === TEST_TEAM)
      const team2Result = results.find(r => r.teamName === TEST_TEAM_2)

      expect(team1Result?.recoveryCount).toBe(1)
      expect(team2Result?.recoveryCount).toBe(1)
    })

    it("should handle empty team list", async () => {
      // Clean up the test team
      await TeamRegistry.deleteTeam(TEST_TEAM)

      const results = await TeamRecovery.scanAndRecover()

      expect(results).toHaveLength(0)
    })

    it("should continue recovery even if one team fails", async () => {
      const TEST_TEAM_2 = "test-recovery-team-2"
      await TeamRegistry.createTeam({
        team: TEST_TEAM_2,
        lead: "test-lead-2",
        members: [{ name: "agent1", agentType: "general-purpose" }],
      })

      // Create a session in team 2
      const session = await TeamSession.createSession(TEST_TEAM_2, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM_2, session.sessionId, "busy")

      // Delete team 1's directory to simulate corruption
      await TeamRegistry.deleteTeam(TEST_TEAM)

      const results = await TeamRecovery.scanAndRecover()

      expect(results).toHaveLength(1)
      expect(results[0].teamName).toBe(TEST_TEAM_2)
      expect(results[0].recoveryCount).toBe(1)
    })
  })

  describe("markTeamForRecovery", () => {
    it("should mark team for recovery with reason", async () => {
      await TeamRecovery.markTeamForRecovery(TEST_TEAM, "High memory usage detected")

      const hasMetadata = await TeamRecovery.hasRecoveryMetadata(TEST_TEAM)
      expect(hasMetadata).toBe(true)

      const metadata = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)
      expect(metadata).not.toBeNull()
      expect(metadata?.reason).toBe("High memory usage detected")
      expect(metadata?.markedAt).toBeGreaterThan(0)
      expect(metadata?.recoveryId).toBeDefined()
    })

    it("should throw error for non-existent team", async () => {
      await expect(TeamRecovery.markTeamForRecovery("non-existent-team", "test")).rejects.toThrow(
        'Team "non-existent-team" not found'
      )
    })

    it("should generate unique recovery IDs", async () => {
      await TeamRecovery.markTeamForRecovery(TEST_TEAM, "reason1")
      const metadata1 = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)

      await TeamRecovery.markTeamForRecovery(TEST_TEAM, "reason2")
      const metadata2 = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)

      expect(metadata1?.recoveryId).not.toBe(metadata2?.recoveryId)
    })
  })

  describe("recovery metadata management", () => {
    it("should return false for hasRecoveryMetadata when no metadata", async () => {
      const hasMetadata = await TeamRecovery.hasRecoveryMetadata(TEST_TEAM)
      expect(hasMetadata).toBe(false)
    })

    it("should return null for getRecoveryMetadata when no metadata", async () => {
      const metadata = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)
      expect(metadata).toBeNull()
    })

    it("should clear recovery metadata", async () => {
      await TeamRecovery.markTeamForRecovery(TEST_TEAM, "test reason")
      expect(await TeamRecovery.hasRecoveryMetadata(TEST_TEAM)).toBe(true)

      await TeamRecovery.clearRecoveryMetadata(TEST_TEAM)
      expect(await TeamRecovery.hasRecoveryMetadata(TEST_TEAM)).toBe(false)
    })

    it("should handle clearing non-existent metadata gracefully", async () => {
      await expect(TeamRecovery.clearRecoveryMetadata(TEST_TEAM)).resolves.toBeUndefined()
    })
  })

  describe("recovery notification to lead", () => {
    it("should send recovery notification to lead when sessions recovered", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

      await TeamRecovery.recoverTeam(TEST_TEAM)

      const messages = await TeamInbox.getMessages(TEST_TEAM, "test-lead")
      const recoveryMessages = messages.filter(m => m.metadata?.type === "recovery_notification")

      expect(recoveryMessages.length).toBeGreaterThan(0)
      expect(recoveryMessages[0].text).toContain("Recovery completed")
      expect(recoveryMessages[0].metadata?.recoveryCount).toBe(1)
    })

    it("should include recovered session details in notification", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

      await TeamRecovery.recoverTeam(TEST_TEAM)

      const messages = await TeamInbox.getMessages(TEST_TEAM, "test-lead")
      const recoveryMessage = messages.find(m => m.metadata?.type === "recovery_notification")

      expect(recoveryMessage?.text).toContain("agent1")
      expect(recoveryMessage?.text).toContain(session.sessionId)
    })

    it("should send notification when team is marked for recovery", async () => {
      await TeamRecovery.markTeamForRecovery(TEST_TEAM, "Manual recovery request")

      const messages = await TeamInbox.getMessages(TEST_TEAM, "test-lead")
      const markedMessages = messages.filter(m => m.metadata?.type === "recovery_marked")

      expect(markedMessages.length).toBeGreaterThan(0)
      expect(markedMessages[0].text).toContain("marked for recovery")
      expect(markedMessages[0].metadata?.reason).toBe("Manual recovery request")
    })

    it("should not send notification when no sessions to recover", async () => {
      await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")

      const beforeMessages = await TeamInbox.getMessages(TEST_TEAM, "test-lead")

      await TeamRecovery.recoverTeam(TEST_TEAM)

      const afterMessages = await TeamInbox.getMessages(TEST_TEAM, "test-lead")

      // No new recovery notification should be sent
      const recoveryNotifications = afterMessages.filter(m => m.metadata?.type === "recovery_notification")
      expect(recoveryNotifications).toHaveLength(0)
    })
  })

  describe("recovery metadata persistence", () => {
    it("should update recovery metadata after recovery", async () => {
      await TeamRecovery.markTeamForRecovery(TEST_TEAM, "Initial mark")
      const beforeMetadata = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)

      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

      await TeamRecovery.recoverTeam(TEST_TEAM)

      const afterMetadata = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)
      expect(afterMetadata?.recoveredAt).toBeDefined()
      expect(afterMetadata?.recoveredAt).toBeGreaterThanOrEqual(beforeMetadata!.markedAt)
    })

    it("should preserve markedAt timestamp through recovery", async () => {
      await TeamRecovery.markTeamForRecovery(TEST_TEAM, "test")
      const beforeMetadata = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)
      const originalMarkedAt = beforeMetadata!.markedAt

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 10))

      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")
      await TeamRecovery.recoverTeam(TEST_TEAM)

      const afterMetadata = await TeamRecovery.getRecoveryMetadata(TEST_TEAM)
      expect(afterMetadata?.markedAt).toBe(originalMarkedAt)
    })
  })
})
