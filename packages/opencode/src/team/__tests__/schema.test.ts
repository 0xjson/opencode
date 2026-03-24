import { describe, it, expect } from "bun:test"
import { Team } from "../schema"
import { z } from "zod"

describe("Team Schema", () => {
  describe("MemberState", () => {
    it("should validate valid member states", () => {
      const validStates = ["ready", "busy", "shutdown_requested", "shutdown", "error"] as const
      for (const state of validStates) {
        expect(Team.MemberState.parse(state)).toBe(state)
      }
    })

    it("should reject invalid member states", () => {
      expect(() => Team.MemberState.parse("invalid_state")).toThrow()
    })
  })

  describe("ExecutionState", () => {
    it("should validate valid execution states", () => {
      const validStates = [
        "thinking",
        "calling_tool",
        "waiting_message",
        "responding",
        "complete",
        "cancelling",
        "idle",
      ] as const
      for (const state of validStates) {
        expect(Team.ExecutionState.parse(state)).toBe(state)
      }
    })

    it("should reject invalid execution states", () => {
      expect(() => Team.ExecutionState.parse("unknown")).toThrow()
    })
  })

  describe("TaskStatus", () => {
    it("should validate valid task statuses", () => {
      const validStatuses = ["pending", "in_progress", "completed", "failed", "blocked"] as const
      for (const status of validStatuses) {
        expect(Team.TaskStatus.parse(status)).toBe(status)
      }
    })

    it("should reject invalid task statuses", () => {
      expect(() => Team.TaskStatus.parse("unknown")).toThrow()
    })
  })

  describe("MemberConfig", () => {
    it("should validate minimal member config", () => {
      const config = {
        name: "test-agent",
        agentType: "general-purpose",
      }
      expect(Team.MemberConfig.parse(config)).toEqual(config)
    })

    it("should validate full member config", () => {
      const config = {
        name: "test-agent",
        model: "sonnet",
        prompt: "Test prompt",
        agentType: "Explore",
        color: "#ff0000",
        planModeRequired: true,
      }
      expect(Team.MemberConfig.parse(config)).toEqual(config)
    })

    it("should reject missing required fields", () => {
      expect(() => Team.MemberConfig.parse({})).toThrow()
      expect(() => Team.MemberConfig.parse({ name: "test" })).toThrow()
    })
  })

  describe("Config", () => {
    it("should validate minimal team config", () => {
      const config = {
        team: "my-team",
        lead: "leader",
        members: [{ name: "member1", agentType: "general-purpose" }],
      }
      expect(Team.Config.parse(config)).toEqual(config)
    })

    it("should validate full team config", () => {
      const config = {
        team: "my-team",
        lead: "leader",
        description: "Test team",
        members: [
          { name: "member1", agentType: "general-purpose" },
          { name: "member2", agentType: "Explore", model: "haiku" },
        ],
        createdAt: Date.now(),
      }
      expect(Team.Config.parse(config)).toEqual(config)
    })

    it("should reject invalid team config", () => {
      expect(() => Team.Config.parse({})).toThrow()
      expect(() => Team.Config.parse({ team: "test" })).toThrow()
    })
  })

  describe("Session", () => {
    it("should validate session", () => {
      const session = {
        sessionId: "sess-123",
        agentName: "agent1",
        model: "sonnet",
        teamName: "my-team",
        status: "ready" as const,
        executionStatus: "idle" as const,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      }
      expect(Team.Session.parse(session)).toEqual(session)
    })

    it("should allow optional lastActivity", () => {
      const session = {
        sessionId: "sess-123",
        agentName: "agent1",
        model: "sonnet",
        teamName: "my-team",
        status: "ready" as const,
        executionStatus: "idle" as const,
        createdAt: Date.now(),
      }
      expect(Team.Session.parse(session)).toEqual(session)
    })
  })

  describe("Message", () => {
    it("should validate minimal message", () => {
      const message = {
        id: "msg-123",
        from: "sender",
        to: "recipient",
        text: "Hello",
        timestamp: Date.now(),
        read: false,
      }
      expect(Team.Message.parse(message)).toEqual({ ...message, type: "message" })
    })

    it("should validate full message", () => {
      const message = {
        id: "msg-123",
        from: "sender",
        to: "recipient",
        text: "Hello",
        timestamp: Date.now(),
        read: true,
        type: "broadcast" as const,
        metadata: { priority: "high" },
      }
      expect(Team.Message.parse(message)).toEqual(message)
    })

    it("should validate message types", () => {
      const types = ["message", "broadcast", "system", "receipt"] as const
      for (const type of types) {
        const message = {
          id: "msg-123",
          from: "sender",
          to: "recipient",
          text: "Hello",
          timestamp: Date.now(),
          read: false,
          type: type,
        }
        expect(Team.Message.parse(message).type).toBe(type)
      }
    })
  })

  describe("Task", () => {
    it("should validate minimal task", () => {
      const task = {
        id: "task-123",
        description: "Do something",
        status: "pending" as const,
        claimedBy: null,
        dependsOn: [],
        createdAt: Date.now(),
      }
      expect(Team.Task.parse(task)).toEqual(task)
    })

    it("should validate full task", () => {
      const task = {
        id: "task-123",
        description: "Do something",
        status: "in_progress" as const,
        claimedBy: "agent1",
        dependsOn: ["task-456", "task-789"],
        createdAt: Date.now(),
        completedAt: Date.now(),
        metadata: { priority: "high" },
      }
      expect(Team.Task.parse(task)).toEqual(task)
    })

    it("should validate task with dependencies", () => {
      const task = {
        id: "task-123",
        description: "Do something",
        status: "pending" as const,
        claimedBy: null,
        dependsOn: ["task-456"],
        createdAt: Date.now(),
      }
      const parsed = Team.Task.parse(task)
      expect(parsed.dependsOn).toEqual(["task-456"])
    })
  })
})
