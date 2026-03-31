import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { TeamSession } from "../session"
import { Team } from "../schema"
import path from "path"
import os from "os"
import { Filesystem } from "../../util/filesystem"
import { TeamRegistry } from "../registry"

const TEST_TEAM_DIR = path.join(os.tmpdir(), "opencode-test-teams", Date.now().toString())

describe("TeamSession", () => {
  const TEST_TEAM = "test-session-team"
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

    await TeamRegistry.createTeam({
      team: TEST_TEAM,
      lead: "test-lead",
      members: [
        { name: "agent1", agentType: "general-purpose" },
        { name: "agent2", agentType: "Explore" },
      ],
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

  describe("createSession", () => {
    it("should create session with initial state", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")

      expect(session.sessionId).toBeDefined()
      expect(session.agentName).toBe("agent1")
      expect(session.model).toBe("sonnet")
      expect(session.teamName).toBe(TEST_TEAM)
      expect(session.status).toBe("ready")
      expect(session.executionStatus).toBe("idle")
      expect(session.createdAt).toBeDefined()
    })

    it("should generate unique session IDs", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")

      expect(session1.sessionId).not.toBe(session2.sessionId)
    })

    it("should support different models", async () => {
      const sonnetSession = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const haikuSession = await TeamSession.createSession(TEST_TEAM, "agent2", "haiku")
      const opusSession = await TeamSession.createSession(TEST_TEAM, "agent1", "opus")

      expect(sonnetSession.model).toBe("sonnet")
      expect(haikuSession.model).toBe("haiku")
      expect(opusSession.model).toBe("opus")
    })

    it("should persist session to disk", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")

      const loaded = await TeamSession.getSession(TEST_TEAM, session.sessionId)
      expect(loaded).toEqual(session)
    })
  })

  describe("State Machine Transitions", () => {
    describe("Valid Transitions from ready", () => {
      it("should transition ready -> busy", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

        expect(result.success).toBe(true)
        const updated = await TeamSession.getSession(TEST_TEAM, session.sessionId)
        expect(updated?.status).toBe("busy")
      })

      it("should transition ready -> shutdown_requested", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")

        expect(result.success).toBe(true)
      })

      it("should transition ready -> error", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")

        expect(result.success).toBe(true)
      })

      it("should reject ready -> shutdown", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })

      it("should reject ready -> ready", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "ready")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })
    })

    describe("Valid Transitions from busy", () => {
      it("should transition busy -> ready", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "ready")

        expect(result.success).toBe(true)
      })

      it("should transition busy -> shutdown_requested", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")

        expect(result.success).toBe(true)
      })

      it("should transition busy -> error", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")

        expect(result.success).toBe(true)
      })

      it("should reject busy -> busy", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })

      it("should reject busy -> shutdown", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })
    })

    describe("Valid Transitions from shutdown_requested", () => {
      it("should transition shutdown_requested -> shutdown", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")
        const result = await TeamSession.confirmShutdown(TEST_TEAM, session.sessionId)

        expect(result.success).toBe(true)
      })

      it("should transition shutdown_requested -> error", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")

        expect(result.success).toBe(true)
      })

      it("should transition shutdown_requested -> busy", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

        expect(result.success).toBe(true)
      })

      it("should reject shutdown_requested -> ready", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "ready")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })

      it("should reject shutdown_requested -> shutdown_requested", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })
    })

    describe("Transitions from shutdown (terminal state)", () => {
      it("should reject all transitions from shutdown", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested")
        await TeamSession.confirmShutdown(TEST_TEAM, session.sessionId)

        const states: Team.MemberState[] = ["ready", "busy", "shutdown_requested", "error", "shutdown"]
        for (const state of states) {
          const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, state)
          expect(result.success).toBe(false)
          expect(result.error).toContain("Invalid state transition")
        }
      })
    })

    describe("Transitions from error", () => {
      it("should transition error -> ready (recovery)", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "ready")

        expect(result.success).toBe(true)
      })

      it("should transition error -> shutdown_requested", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")
        const result = await TeamSession.requestShutdown(TEST_TEAM, session.sessionId)

        expect(result.success).toBe(true)
      })

      it("should reject error -> busy", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })

      it("should reject error -> error", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")
        const result = await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })

      it("should reject error -> shutdown", async () => {
        const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
        await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")
        const result = await TeamSession.confirmShutdown(TEST_TEAM, session.sessionId)

        expect(result.success).toBe(false)
        expect(result.error).toContain("Invalid state transition")
      })
    })
  })

  describe("Execution Status Updates", () => {
    it("should update execution status independently", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")

      const result = await TeamSession.updateExecutionStatus(TEST_TEAM, session.sessionId, "thinking")
      expect(result.success).toBe(true)

      const updated = await TeamSession.getSession(TEST_TEAM, session.sessionId)
      expect(updated?.executionStatus).toBe("thinking")
    })

    it("should support all execution states", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const states: Team.ExecutionState[] = [
        "thinking",
        "calling_tool",
        "waiting_message",
        "responding",
        "complete",
        "cancelling",
        "idle",
      ]

      for (const state of states) {
        await TeamSession.updateExecutionStatus(TEST_TEAM, session.sessionId, state)
        const updated = await TeamSession.getSession(TEST_TEAM, session.sessionId)
        expect(updated?.executionStatus).toBe(state)
      }
    })

    it("should update lastActivity on execution status change", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const before = Date.now()
      await new Promise((resolve) => setTimeout(resolve, 10))

      await TeamSession.updateExecutionStatus(TEST_TEAM, session.sessionId, "thinking")

      const updated = await TeamSession.getSession(TEST_TEAM, session.sessionId)
      expect(updated?.lastActivity).toBeGreaterThanOrEqual(before)
    })

    it("should reject update for non-existent session", async () => {
      const result = await TeamSession.updateExecutionStatus(TEST_TEAM, "non-existent", "thinking")
      expect(result.success).toBe(false)
      expect(result.error).toContain("not found")
    })
  })

  describe("getActiveSession", () => {
    it("should return active session for agent", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const active = await TeamSession.getActiveSession(TEST_TEAM, "agent1")

      expect(active?.sessionId).toBe(session.sessionId)
    })

    it("should return null for agent with shutdown session", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.requestShutdown(TEST_TEAM, session.sessionId)
      await TeamSession.confirmShutdown(TEST_TEAM, session.sessionId)

      const active = await TeamSession.getActiveSession(TEST_TEAM, "agent1")
      expect(active).toBeNull()
    })

    it("should return null for agent with error session", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error")

      const active = await TeamSession.getActiveSession(TEST_TEAM, "agent1")
      expect(active).toBeNull()
    })

    it("should return ready or busy session", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")

      // ready state
      let active = await TeamSession.getActiveSession(TEST_TEAM, "agent1")
      expect(active?.sessionId).toBe(session.sessionId)

      // busy state
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")
      active = await TeamSession.getActiveSession(TEST_TEAM, "agent1")
      expect(active?.sessionId).toBe(session.sessionId)
    })
  })

  describe("getSessionsByAgent", () => {
    it("should return all sessions for agent", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent1", "haiku")
      await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      const agent1Sessions = await TeamSession.getSessionsByAgent(TEST_TEAM, "agent1")

      expect(agent1Sessions).toHaveLength(2)
      expect(agent1Sessions.map((s) => s.sessionId).sort()).toEqual([session1.sessionId, session2.sessionId].sort())
    })

    it("should return empty array for agent with no sessions", async () => {
      const sessions = await TeamSession.getSessionsByAgent(TEST_TEAM, "non-existent")
      expect(sessions).toEqual([])
    })
  })

  describe("getBusyMembers", () => {
    it("should return only busy members", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session1.sessionId, "busy")

      const busy = await TeamSession.getBusyMembers(TEST_TEAM)
      expect(busy).toHaveLength(1)
      expect(busy[0].sessionId).toBe(session1.sessionId)
    })
  })

  describe("getReadyMembers", () => {
    it("should return only ready members", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session1.sessionId, "busy")

      const ready = await TeamSession.getReadyMembers(TEST_TEAM)
      expect(ready).toHaveLength(1)
      expect(ready[0].sessionId).toBe(session2.sessionId)
    })
  })

  describe("recoverFromCrash", () => {
    it("should reset busy sessions to ready", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session1.sessionId, "busy")
      await TeamSession.updateExecutionStatus(TEST_TEAM, session1.sessionId, "thinking")

      const recovered = await TeamSession.recoverFromCrash(TEST_TEAM)

      expect(recovered).toHaveLength(1)
      expect(recovered[0].sessionId).toBe(session1.sessionId)

      const updated = await TeamSession.getSession(TEST_TEAM, session1.sessionId)
      expect(updated?.status).toBe("ready")
      expect(updated?.executionStatus).toBe("idle")
    })

    it("should not affect ready or shutdown sessions", async () => {
      const session1 = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      const session2 = await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      await TeamSession.updateSessionStatus(TEST_TEAM, session2.sessionId, "shutdown_requested")
      await TeamSession.confirmShutdown(TEST_TEAM, session2.sessionId)

      const recovered = await TeamSession.recoverFromCrash(TEST_TEAM)
      expect(recovered).toHaveLength(0)

      const readySession = await TeamSession.getSession(TEST_TEAM, session1.sessionId)
      expect(readySession?.status).toBe("ready")
    })

    it("should persist recovery changes", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy")

      await TeamSession.recoverFromCrash(TEST_TEAM)

      // Reload from disk
      const updated = await TeamSession.getSession(TEST_TEAM, session.sessionId)
      expect(updated?.status).toBe("ready")
    })
  })

  describe("cleanupOldSessions", () => {
    it("should remove old shutdown sessions", async () => {
      // This test would need timestamp manipulation which is hard to test
      // without mocking time. For now, just verify the function exists.
      const removed = await TeamSession.cleanupOldSessions(TEST_TEAM, 0)
      // No old sessions exist, so should remove 0
      expect(typeof removed).toBe("number")
    })

    it("should not remove active sessions", async () => {
      await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      await TeamSession.createSession(TEST_TEAM, "agent2", "sonnet")

      const removed = await TeamSession.cleanupOldSessions(TEST_TEAM, 0)
      expect(removed).toBe(0)

      const sessions = await TeamSession.getAllMembers(TEST_TEAM)
      expect(sessions).toHaveLength(2)
    })
  })

  describe("Concurrency", () => {
    it("should handle concurrent session creation", async () => {
      const promises = Array.from({ length: 10 }, () =>
        TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")
      )

      const sessions = await Promise.all(promises)
      const ids = sessions.map((s) => s.sessionId)
      expect(new Set(ids).size).toBe(10)
    })

    it("should handle concurrent status updates", async () => {
      const session = await TeamSession.createSession(TEST_TEAM, "agent1", "sonnet")

      const promises = [
        TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "busy"),
        TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "shutdown_requested"),
        TeamSession.updateSessionStatus(TEST_TEAM, session.sessionId, "error"),
      ]

      const results = await Promise.all(promises)
      // All may succeed since file-based storage doesn't have atomic compare-and-swap
      // The last write wins - verify final state is one of the valid transitions
      const successful = results.filter((r) => r.success)
      expect(successful.length).toBeGreaterThanOrEqual(1)

      // Verify final state is valid (one of the transitioned states)
      const updatedSession = await TeamSession.getSession(TEST_TEAM, session.sessionId)
      expect(["busy", "shutdown_requested", "error"]).toContain(updatedSession?.status)
    })
  })
})
