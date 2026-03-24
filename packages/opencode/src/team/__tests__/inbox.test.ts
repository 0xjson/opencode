import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { TeamInbox } from "../inbox"
import path from "path"
import os from "os"
import { Filesystem } from "../../util/filesystem"
import { TeamRegistry } from "../registry"

const TEST_TEAM_DIR = path.join(os.tmpdir(), "opencode-test-teams", Date.now().toString())

describe("TeamInbox", () => {
  const TEST_TEAM = "test-inbox-team"

  beforeEach(async () => {
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
        { name: "agent2", agentType: "general-purpose" },
      ],
    })
  })

  afterEach(async () => {
    try {
      await Filesystem.rmdir(TEST_TEAM_DIR, { recursive: true })
    } catch {
      // Directory might not exist
    }
  })

  describe("sendMessage", () => {
    it("should deliver message to recipient inbox", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Hello agent2!")

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages).toHaveLength(1)
      expect(messages[0].text).toBe("Hello agent2!")
      expect(messages[0].from).toBe("agent1")
      expect(messages[0].to).toBe("agent2")
      expect(messages[0].read).toBe(false)
      expect(messages[0].type).toBe("message")
    })

    it("should assign unique message IDs", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 1")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 2")

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages[0].id).not.toBe(messages[1].id)
    })

    it("should assign timestamps", async () => {
      const before = Date.now()
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Timestamped")
      const after = Date.now()

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages[0].timestamp).toBeGreaterThanOrEqual(before)
      expect(messages[0].timestamp).toBeLessThanOrEqual(after)
    })

    it("should support different message types", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Broadcast message", { type: "broadcast" })
      await TeamInbox.sendMessage(TEST_TEAM, "system", "agent2", "System message", { type: "system" })

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages[0].type).toBe("broadcast")
      expect(messages[1].type).toBe("system")
    })

    it("should support metadata", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "With metadata", {
        metadata: { taskId: "task-123", priority: "high" },
      })

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages[0].metadata).toEqual({ taskId: "task-123", priority: "high" })
    })
  })

  describe("broadcast", () => {
    it("should send message to all team members except sender", async () => {
      await TeamInbox.broadcast(TEST_TEAM, "agent1", "Team announcement!")

      const agent2Messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      const leadMessages = await TeamInbox.getMessages(TEST_TEAM, "test-lead")

      expect(agent2Messages).toHaveLength(1)
      expect(agent2Messages[0].text).toBe("Team announcement!")
      expect(agent2Messages[0].type).toBe("broadcast")

      expect(leadMessages).toHaveLength(1)
      expect(leadMessages[0].text).toBe("Team announcement!")
    })

    it("should not send to sender", async () => {
      await TeamInbox.broadcast(TEST_TEAM, "agent1", "Broadcast")

      const agent1Messages = await TeamInbox.getMessages(TEST_TEAM, "agent1")
      expect(agent1Messages).toHaveLength(0)
    })

    it("should handle single-member teams", async () => {
      // Create single-member team
      const singleTeam = "single-member-team"
      await TeamRegistry.createTeam({
        team: singleTeam,
        lead: "leader",
        members: [{ name: "only-member", agentType: "general-purpose" }],
      })

      await TeamInbox.broadcast(singleTeam, "leader", "Hello?")

      // No exceptions, no messages delivered
      const messages = await TeamInbox.getMessages(singleTeam, "only-member")
      expect(messages).toHaveLength(0)
    })
  })

  describe("getMessages", () => {
    it("should return all messages by default", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 1")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 2")
      await TeamInbox.sendMessage(TEST_TEAM, "test-lead", "agent2", "Message 3")

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages).toHaveLength(3)
    })

    it("should filter by unread status", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Unread")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Will be read")
      await TeamInbox.markRead(TEST_TEAM, "agent2")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Also unread")

      const unreadMessages = await TeamInbox.getMessages(TEST_TEAM, "agent2", { unreadOnly: true })
      expect(unreadMessages).toHaveLength(2)
      expect(unreadMessages.map((m) => m.text)).toContain("Unread")
      expect(unreadMessages.map((m) => m.text)).toContain("Also unread")
    })

    it("should filter by sender", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "From agent1")
      await TeamInbox.sendMessage(TEST_TEAM, "test-lead", "agent2", "From lead")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "From agent1 again")

      const fromAgent1 = await TeamInbox.getMessages(TEST_TEAM, "agent2", { from: "agent1" })
      expect(fromAgent1).toHaveLength(2)
      expect(fromAgent1.every((m) => m.from === "agent1")).toBe(true)
    })

    it("should limit results", async () => {
      for (let i = 0; i < 10; i++) {
        await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", `Message ${i}`)
      }

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2", { limit: 3 })
      expect(messages).toHaveLength(3)
    })

    it("should combine filters", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Old unread from agent1")
      await TeamInbox.markRead(TEST_TEAM, "agent2")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "New unread from agent1")
      await TeamInbox.sendMessage(TEST_TEAM, "test-lead", "agent2", "Unread from lead")

      const filtered = await TeamInbox.getMessages(TEST_TEAM, "agent2", {
        from: "agent1",
        unreadOnly: true,
        limit: 1,
      })

      expect(filtered).toHaveLength(1)
      expect(filtered[0].text).toBe("New unread from agent1")
    })

    it("should return empty array for no messages", async () => {
      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages).toEqual([])
    })
  })

  describe("markRead", () => {
    it("should mark all messages as read by default", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 1")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 2")

      const markedCount = await TeamInbox.markRead(TEST_TEAM, "agent2")

      expect(markedCount).toBe(2)
      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages.every((m) => m.read)).toBe(true)
    })

    it("should mark only specific message IDs", async () => {
      const msg1 = await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 1")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 2")

      const markedCount = await TeamInbox.markRead(TEST_TEAM, "agent2", { messageIds: [msg1.id] })

      expect(markedCount).toBe(1)
      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      const msg1Status = messages.find((m) => m.id === msg1.id)?.read
      const msg2Status = messages.find((m) => m.text === "Message 2")?.read
      expect(msg1Status).toBe(true)
      expect(msg2Status).toBe(false)
    })

    it("should return 0 when no messages to mark", async () => {
      const markedCount = await TeamInbox.markRead(TEST_TEAM, "agent2")
      expect(markedCount).toBe(0)
    })

    it("should persist read status", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Test")
      await TeamInbox.markRead(TEST_TEAM, "agent2")

      // Reload from disk
      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages[0].read).toBe(true)
    })
  })

  describe("hasUnread", () => {
    it("should return true when unread messages exist", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Unread")
      expect(await TeamInbox.hasUnread(TEST_TEAM, "agent2")).toBe(true)
    })

    it("should return false when all messages are read", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Read")
      await TeamInbox.markRead(TEST_TEAM, "agent2")
      expect(await TeamInbox.hasUnread(TEST_TEAM, "agent2")).toBe(false)
    })

    it("should return false when no messages exist", async () => {
      expect(await TeamInbox.hasUnread(TEST_TEAM, "agent2")).toBe(false)
    })
  })

  describe("countUnread", () => {
    it("should count unread messages", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Unread 1")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Unread 2")
      await TeamInbox.markRead(TEST_TEAM, "agent2")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Unread 3")

      expect(await TeamInbox.countUnread(TEST_TEAM, "agent2")).toBe(1)
    })

    it("should return 0 when no unread messages", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Read")
      await TeamInbox.markRead(TEST_TEAM, "agent2")
      expect(await TeamInbox.countUnread(TEST_TEAM, "agent2")).toBe(0)
    })
  })

  describe("clearInbox", () => {
    it("should remove all messages", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 1")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Message 2")

      await TeamInbox.clearInbox(TEST_TEAM, "agent2")

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages).toHaveLength(0)
    })

    it("should only clear specified agent inbox", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "For agent2")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "test-lead", "For lead")

      await TeamInbox.clearInbox(TEST_TEAM, "agent2")

      const agent2Messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      const leadMessages = await TeamInbox.getMessages(TEST_TEAM, "test-lead")

      expect(agent2Messages).toHaveLength(0)
      expect(leadMessages).toHaveLength(1)
    })
  })

  describe("JSONL Persistence", () => {
    it("should store messages in JSONL format", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "JSONL test")

      const inboxPath = path.join(TEST_TEAM_DIR, TEST_TEAM, "inboxes", "agent2.jsonl")
      const content = await Filesystem.readText(inboxPath)

      expect(content).toContain("JSONL test")
      const lines = content.trim().split("\n")
      expect(lines.length).toBe(1)

      // Should be valid JSON
      const parsed = JSON.parse(lines[0])
      expect(parsed.text).toBe("JSONL test")
    })

    it("should append new messages to existing file", async () => {
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Line 1")
      await TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", "Line 2")

      const inboxPath = path.join(TEST_TEAM_DIR, TEST_TEAM, "inboxes", "agent2.jsonl")
      const content = await Filesystem.readText(inboxPath)
      const lines = content.trim().split("\n")

      expect(lines.length).toBe(2)
    })

    it("should handle corrupted inbox gracefully", async () => {
      // Manually create corrupted inbox file
      const inboxPath = path.join(TEST_TEAM_DIR, TEST_TEAM, "inboxes", "agent2.jsonl")
      await Filesystem.mkdirp(path.dirname(inboxPath))
      await Filesystem.writeText(inboxPath, "{invalid json\n{valid: json}")

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages).toEqual([])
    })
  })

  describe("Concurrent Operations", () => {
    it("should handle concurrent message sends", async () => {
      const promises = Array.from({ length: 20 }, (_, i) =>
        TeamInbox.sendMessage(TEST_TEAM, "agent1", "agent2", `Message ${i}`)
      )

      await Promise.all(promises)

      const messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(messages).toHaveLength(20)
    })

    it("should handle concurrent broadcasts", async () => {
      await Promise.all([
        TeamInbox.broadcast(TEST_TEAM, "agent1", "Broadcast 1"),
        TeamInbox.broadcast(TEST_TEAM, "agent1", "Broadcast 2"),
        TeamInbox.broadcast(TEST_TEAM, "agent1", "Broadcast 3"),
      ])

      const agent2Messages = await TeamInbox.getMessages(TEST_TEAM, "agent2")
      expect(agent2Messages).toHaveLength(3)
    })
  })
})
