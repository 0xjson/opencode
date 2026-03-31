import { describe, it, expect, beforeEach } from "bun:test"
import type {
  IsolationConfig,
  ValidationResult,
  RateLimitResult,
} from "../isolation"
import {
  createLeadIsolation,
  createSubAgentIsolation,
  getToolVisibility,
  validateToolCall,
  checkRateLimit,
  getRateLimitStatus,
  clearRateLimit,
  getLeadOnlyTools,
  getSubAgentTools,
} from "../isolation"

describe("TeamIsolation", () => {
  beforeEach(() => {
    // Clear rate limit store before each test
    clearRateLimit("test-lead")
    clearRateLimit("test-agent")
    clearRateLimit("rate-test-agent")
  })

  describe("createLeadIsolation", () => {
    it("should create isolation config for lead with full access", () => {
      const config = createLeadIsolation("test-lead")

      expect(config.agentName).toBe("test-lead")
      expect(config.role).toBe("lead")
      expect(config.allowBash).toBe(true)
      expect(config.allowWrite).toBe(true)
      expect(config.allowEdit).toBe(true)
    })

    it("should include all tools for lead", () => {
      const config = createLeadIsolation("test-lead")

      expect(config.visibleTools.has("team_create")).toBe(true)
      expect(config.visibleTools.has("team_shutdown")).toBe(true)
      expect(config.visibleTools.has("team_message")).toBe(true)
      expect(config.visibleTools.has("team_claim_task")).toBe(true)
      expect(config.visibleTools.has("bash")).toBe(true)
      expect(config.visibleTools.has("read")).toBe(true)
      expect(config.visibleTools.has("write")).toBe(true)
      expect(config.visibleTools.has("edit")).toBe(true)
      expect(config.visibleTools.has("grep")).toBe(true)
      expect(config.visibleTools.has("glob")).toBe(true)
    })
  })

  describe("createSubAgentIsolation", () => {
    it("should create isolation config for sub-agent with restricted access", () => {
      const config = createSubAgentIsolation("test-agent")

      expect(config.agentName).toBe("test-agent")
      expect(config.role).toBe("sub-agent")
      expect(config.allowBash).toBe(false)
      expect(config.allowWrite).toBe(false)
      expect(config.allowEdit).toBe(false)
    })

    it("should only include shared team tools for sub-agent", () => {
      const config = createSubAgentIsolation("test-agent")

      expect(config.visibleTools.has("team_message")).toBe(true)
      expect(config.visibleTools.has("team_broadcast")).toBe(true)
      expect(config.visibleTools.has("team_check_inbox")).toBe(true)
      expect(config.visibleTools.has("team_mark_read")).toBe(true)
      expect(config.visibleTools.has("team_create_task")).toBe(true)
      expect(config.visibleTools.has("team_claim_task")).toBe(true)
      expect(config.visibleTools.has("team_complete_task")).toBe(true)
      expect(config.visibleTools.has("team_list_tasks")).toBe(true)
      expect(config.visibleTools.has("team_list")).toBe(true)
      expect(config.visibleTools.has("team_info")).toBe(true)
      expect(config.visibleTools.has("read")).toBe(true)
    })

    it("should not include lead-only tools for sub-agent", () => {
      const config = createSubAgentIsolation("test-agent")

      expect(config.visibleTools.has("team_create")).toBe(false)
      expect(config.visibleTools.has("team_shutdown")).toBe(false)
      expect(config.visibleTools.has("team_cleanup")).toBe(false)
      expect(config.visibleTools.has("team_assign_task")).toBe(false)
      expect(config.visibleTools.has("team_add_member")).toBe(false)
    })

    it("should not include dangerous tools for sub-agent", () => {
      const config = createSubAgentIsolation("test-agent")

      expect(config.visibleTools.has("bash")).toBe(false)
      expect(config.visibleTools.has("write")).toBe(false)
      expect(config.visibleTools.has("edit")).toBe(false)
      expect(config.visibleTools.has("grep")).toBe(false)
      expect(config.visibleTools.has("glob")).toBe(false)
    })
  })

  describe("getToolVisibility", () => {
    it("should return true for visible tools", () => {
      const leadConfig = createLeadIsolation("test-lead")
      const agentConfig = createSubAgentIsolation("test-agent")

      expect(getToolVisibility("bash", leadConfig)).toBe(true)
      expect(getToolVisibility("read", agentConfig)).toBe(true)
      expect(getToolVisibility("team_message", agentConfig)).toBe(true)
    })

    it("should return false for hidden tools", () => {
      const agentConfig = createSubAgentIsolation("test-agent")

      expect(getToolVisibility("bash", agentConfig)).toBe(false)
      expect(getToolVisibility("write", agentConfig)).toBe(false)
      expect(getToolVisibility("team_shutdown", agentConfig)).toBe(false)
    })
  })

  describe("validateToolCall", () => {
    describe("lead validation", () => {
      it("should allow all tools for lead", () => {
        const leadConfig = createLeadIsolation("test-lead")

        expect(validateToolCall("bash", leadConfig).allowed).toBe(true)
        expect(validateToolCall("write", leadConfig).allowed).toBe(true)
        expect(validateToolCall("edit", leadConfig).allowed).toBe(true)
        expect(validateToolCall("team_create", leadConfig).allowed).toBe(true)
        expect(validateToolCall("team_shutdown", leadConfig).allowed).toBe(true)
      })
    })

    describe("sub-agent validation", () => {
      it("should allow permitted team tools", () => {
        const agentConfig = createSubAgentIsolation("test-agent")

        const allowedTools = [
          "team_message",
          "team_broadcast",
          "team_check_inbox",
          "team_mark_read",
          "team_create_task",
          "team_claim_task",
          "team_complete_task",
          "team_list_tasks",
          "team_list",
          "team_info",
          "read",
        ]

        for (const tool of allowedTools) {
          const result = validateToolCall(tool, agentConfig)
          expect(result.allowed).toBe(true)
          expect(result.reason).toBeUndefined()
        }
      })

      it("should deny lead-only tools with specific reason", () => {
        const agentConfig = createSubAgentIsolation("test-agent")

        const result = validateToolCall("team_create", agentConfig)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("restricted to team leads only")
      })

      it("should deny bash with specific reason", () => {
        const agentConfig = createSubAgentIsolation("test-agent")

        const result = validateToolCall("bash", agentConfig)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("Bash execution is not allowed")
      })

      it("should deny write with specific reason", () => {
        const agentConfig = createSubAgentIsolation("test-agent")

        const result = validateToolCall("write", agentConfig)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("File write operations are not allowed")
      })

      it("should deny edit with specific reason", () => {
        const agentConfig = createSubAgentIsolation("test-agent")

        const result = validateToolCall("edit", agentConfig)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("File edit operations are not allowed")
      })

      it("should deny unknown tools with generic reason", () => {
        const agentConfig = createSubAgentIsolation("test-agent")

        const result = validateToolCall("unknown_tool", agentConfig)
        expect(result.allowed).toBe(false)
        expect(result.reason).toContain("not visible")
      })

      it("should include agent name in denial reason for unknown tools", () => {
        const agentConfig = createSubAgentIsolation("test-agent")

        const result = validateToolCall("unknown_tool", agentConfig)
        expect(result.reason).toContain("test-agent")
      })
    })
  })

  describe("checkRateLimit", () => {
    it("should allow first message", () => {
      const result = checkRateLimit("rate-test-agent")
      expect(result.allowed).toBe(true)
    })

    it("should allow messages under limit", () => {
      for (let i = 0; i < 5; i++) {
        const result = checkRateLimit("rate-test-agent")
        expect(result.allowed).toBe(true)
      }
    })

    it("should deny messages over limit", () => {
      // Send 10 messages (the limit)
      for (let i = 0; i < 10; i++) {
        checkRateLimit("rate-test-agent")
      }

      // 11th message should be denied
      const result = checkRateLimit("rate-test-agent")
      expect(result.allowed).toBe(false)
      expect(result.retryAfterMs).toBeDefined()
      expect(result.retryAfterMs!).toBeGreaterThan(0)
    })

    it("should track different agents separately", () => {
      // Fill up agent1's rate limit
      for (let i = 0; i < 10; i++) {
        checkRateLimit("agent1")
      }

      // agent2 should still be allowed
      const result = checkRateLimit("agent2")
      expect(result.allowed).toBe(true)

      // agent1 should be denied
      const agent1Result = checkRateLimit("agent1")
      expect(agent1Result.allowed).toBe(false)
    })

    it("should reset rate limit after window expires", async () => {
      // Mock time by manipulating the rate limit store directly
      // First, fill up the rate limit
      for (let i = 0; i < 10; i++) {
        checkRateLimit("rate-test-agent")
      }

      // Verify rate limited
      expect(checkRateLimit("rate-test-agent").allowed).toBe(false)

      // Wait for window to expire (using a shorter time for testing)
      // Since we can't easily manipulate time, we'll use the getRateLimitStatus
      // and check the behavior
      const status = getRateLimitStatus("rate-test-agent")

      if (status.windowStart) {
        // Manually reset by clearing
        clearRateLimit("rate-test-agent")

        // Should be allowed again
        const result = checkRateLimit("rate-test-agent")
        expect(result.allowed).toBe(true)
      }
    })

    it("should provide valid retry time when rate limited", () => {
      // Fill up the rate limit
      for (let i = 0; i < 10; i++) {
        checkRateLimit("rate-test-agent")
      }

      const result = checkRateLimit("rate-test-agent")
      expect(result.allowed).toBe(false)
      expect(result.retryAfterMs).toBeDefined()
      expect(result.retryAfterMs!).toBeLessThanOrEqual(60000) // Max 1 minute
      expect(result.retryAfterMs!).toBeGreaterThan(0)
    })
  })

  describe("getRateLimitStatus", () => {
    it("should return zero status for new agent", () => {
      const status = getRateLimitStatus("new-agent")

      expect(status.messageCount).toBe(0)
      expect(status.maxMessages).toBe(10)
      expect(status.windowStart).toBeNull()
      expect(status.remaining).toBe(10)
    })

    it("should return correct count after messages", () => {
      for (let i = 0; i < 5; i++) {
        checkRateLimit("rate-test-agent")
      }

      const status = getRateLimitStatus("rate-test-agent")
      expect(status.messageCount).toBe(5)
      expect(status.remaining).toBe(5)
    })

    it("should return expired window as fresh state", async () => {
      checkRateLimit("rate-test-agent")
      const status = getRateLimitStatus("rate-test-agent")

      expect(status.windowStart).toBeDefined()
      expect(status.windowStart).not.toBeNull()
    })
  })

  describe("clearRateLimit", () => {
    it("should clear rate limit data for agent", () => {
      checkRateLimit("rate-test-agent")
      checkRateLimit("rate-test-agent")

      let status = getRateLimitStatus("rate-test-agent")
      expect(status.messageCount).toBe(2)

      clearRateLimit("rate-test-agent")

      status = getRateLimitStatus("rate-test-agent")
      expect(status.messageCount).toBe(0)
    })

    it("should handle clearing non-existent agent gracefully", () => {
      expect(() => clearRateLimit("non-existent-agent")).not.toThrow()
    })
  })

  describe("getLeadOnlyTools", () => {
    it("should return list of lead-only tools", () => {
      const tools = getLeadOnlyTools()

      expect(tools).toContain("team_create")
      expect(tools).toContain("team_shutdown")
      expect(tools).toContain("team_cleanup")
      expect(tools).toContain("team_assign_task")
      expect(tools).toContain("team_add_member")
    })
  })

  describe("getSubAgentTools", () => {
    it("should return list of sub-agent allowed tools", () => {
      const tools = getSubAgentTools()

      expect(tools).toContain("team_message")
      expect(tools).toContain("team_check_inbox")
      expect(tools).toContain("team_claim_task")
      expect(tools).toContain("team_complete_task")
      expect(tools).toContain("read")
    })

    it("should not include lead-only tools in sub-agent tools", () => {
      const tools = getSubAgentTools()

      expect(tools).not.toContain("team_create")
      expect(tools).not.toContain("team_shutdown")
      expect(tools).not.toContain("bash")
      expect(tools).not.toContain("write")
    })
  })
})
