import { Tool } from "../tool/tool"
import { z } from "zod"
import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamInbox } from "./inbox"
import { TeamTasks } from "./tasks"
import { TeamSession } from "./session"
import { Log } from "../util/log"

const log = Log.create({ service: "team.tools" })

export const TeamCreateTool = Tool.define(
  "team_create",
  async () => ({
    description: "Create a new agent team with a lead and members",
    parameters: z.object({
      team: z.string().describe("Unique name for the team"),
      description: z.string().optional().describe("Optional description of the team"),
      lead: z.string().describe("Name of the lead agent"),
      members: z
        .array(
          z.object({
            name: z.string().describe("Agent name"),
            model: z.string().optional().describe("Model to use (e.g., 'claude', 'codex', 'gemini')"),
            agentType: z
              .enum(["general-purpose", "Explore", "Plan"])
              .default("general-purpose")
              .describe("Type of agent"),
          })
        )
        .describe("List of team members"),
    }),
    execute: async (args, ctx) => {
      const config: Team.Config = {
        team: args.team,
        lead: args.lead,
        description: args.description,
        members: args.members.map((m) => ({
          name: m.name,
          agentType: m.agentType,
          model: m.model,
        })),
      }

      await TeamRegistry.createTeam(config)

      return {
        title: "Team Created",
        output: `Created team "${args.team}" with ${args.members.length} members. Lead: ${args.lead}`,
        metadata: {
          team: args.team,
          members: args.members.map((m) => m.name),
        },
      }
    },
  })
)

export const TeamMessageTool = Tool.define(
  "team_message",
  async () => ({
    description: "Send a message to a specific teammate",
    parameters: z.object({
      team: z.string().describe("Team name"),
      to: z.string().describe("Name of the recipient agent"),
      text: z.string().describe("Message content"),
    }),
    execute: async (args, ctx) => {
      const message = await TeamInbox.sendMessage(
        args.team,
        args.to,
        ctx.agent,
        args.text,
        "message"
      )

      return {
        title: "Message Sent",
        output: `Sent message to "${args.to}" in team "${args.team}" (ID: ${message.id})`,
        metadata: {
          messageId: message.id,
          to: args.to,
          timestamp: message.timestamp,
        },
      }
    },
  })
)

export const TeamBroadcastTool = Tool.define(
  "team_broadcast",
  async () => ({
    description: "Broadcast a message to all team members",
    parameters: z.object({
      team: z.string().describe("Team name"),
      text: z.string().describe("Message content"),
    }),
    execute: async (args, ctx) => {
      const messages = await TeamInbox.broadcastMessage(args.team, ctx.agent, args.text, true)

      return {
        title: "Broadcast Sent",
        output: `Broadcast sent to ${messages.length} team members in "${args.team}"`,
        metadata: {
          recipients: messages.length,
          messageIds: messages.map((m) => m.id),
        },
      }
    },
  })
)

export const TeamCheckInboxTool = Tool.define(
  "team_check_inbox",
  async () => ({
    description: "Check your team inbox for messages",
    parameters: z.object({
      team: z.string().describe("Team name"),
      unreadOnly: z.boolean().default(true).describe("Only show unread messages"),
      limit: z.number().int().positive().optional().describe("Maximum messages to return"),
    }),
    execute: async (args, ctx) => {
      const messages = await TeamInbox.getMessages(args.team, ctx.agent, {
        unreadOnly: args.unreadOnly,
        limit: args.limit,
      })

      if (messages.length === 0) {
        return {
          title: "Inbox Empty",
          output: "No messages in your inbox.",
          metadata: { count: 0 },
        }
      }

      const formatted = messages
        .map((m) => {
          const time = new Date(m.timestamp).toLocaleTimeString()
          return `[${time}] ${m.from}: ${m.text.slice(0, 100)}${m.text.length > 100 ? "..." : ""}`
        })
        .join("\n")

      return {
        title: `Inbox (${messages.length} messages)`,
        output: formatted,
        metadata: {
          count: messages.length,
          messages: messages.map((m) => ({
            id: m.id,
            from: m.from,
            timestamp: m.timestamp,
            read: m.read,
          })),
        },
      }
    },
  })
)

export const TeamMarkReadTool = Tool.define(
  "team_mark_read",
  async () => ({
    description: "Mark messages as read in your inbox",
    parameters: z.object({
      team: z.string().describe("Team name"),
      messageIds: z
        .array(z.string())
        .optional()
        .describe("Specific message IDs to mark as read (omit to mark all)"),
    }),
    execute: async (args, ctx) => {
      const count = await TeamInbox.markRead(args.team, ctx.agent, args.messageIds)

      return {
        title: "Messages Marked Read",
        output: `Marked ${count} messages as read`,
        metadata: { markedCount: count },
      }
    },
  })
)

export const TeamCreateTaskTool = Tool.define(
  "team_create_task",
  async () => ({
    description: "Create a new task for the team",
    parameters: z.object({
      team: z.string().describe("Team name"),
      description: z.string().describe("Task description"),
      dependsOn: z
        .array(z.string())
        .optional()
        .describe("IDs of tasks that must complete before this one"),
      notify: z.boolean().optional().describe("Whether to notify the team about this task").default(true),
    }),
    execute: async (args, ctx) => {
      const task = await TeamTasks.createTask(args.team, args.description, {
        dependsOn: args.dependsOn,
      })

      // Auto-broadcast to team if notify is enabled
      if (args.notify !== false) {
        try {
          const depsText = task.dependsOn?.length ? ` (depends on: ${task.dependsOn.join(", ")})` : ""
          await TeamInbox.broadcastMessage(
            args.team,
            ctx.agent,
            `📋 New task available: "${args.description}"${depsText}\nTask ID: ${task.id}\nStatus: ${task.status}`,
            true
          )
          log.info(`Auto-broadcasted new task "${task.id}" to team "${args.team}"`)
        } catch (error) {
          // Don't fail task creation if broadcast fails
          log.warn(`Failed to broadcast new task: ${error}`)
        }
      }

      return {
        title: "Task Created",
        output: `Created task "${task.id}": ${args.description}`,
        metadata: {
          taskId: task.id,
          status: task.status,
          dependsOn: task.dependsOn,
        },
      }
    },
  })
)

export const TeamClaimTaskTool = Tool.define(
  "team_claim_task",
  async () => ({
    description: "Claim a task to work on",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("ID of the task to claim"),
    }),
    execute: async (args, ctx) => {
      const result = await TeamTasks.claimTask(args.team, args.taskId, ctx.agent)

      if (!result.success) {
        return {
          title: "Claim Failed",
          output: result.error || "Failed to claim task",
          metadata: { success: false, error: result.error },
        }
      }

      return {
        title: "Task Claimed",
        output: `Successfully claimed task "${args.taskId}"`,
        metadata: {
          success: true,
          taskId: args.taskId,
          status: result.task?.status,
        },
      }
    },
  })
)

export const TeamAssignTaskTool = Tool.define(
  "team_assign_task",
  async () => ({
    description: "Assign a task to a specific team member (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("ID of the task to assign"),
      agent: z.string().describe("Name of the agent to assign the task to"),
    }),
    execute: async (args, ctx) => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can assign tasks to specific agents",
          metadata: { success: false },
        }
      }

      const tasks = await TeamTasks.getTasks(args.team)
      const task = tasks.find((t) => t.id === args.taskId)

      if (!task) {
        return {
          title: "Task Not Found",
          output: `Task "${args.taskId}" not found`,
          metadata: { success: false },
        }
      }

      if (task.status !== "pending") {
        return {
          title: "Task Not Available",
          output: `Task "${args.taskId}" is not available (status: ${task.status})`,
          metadata: { success: false },
        }
      }

      // Check if the target agent is a team member
      const isMember = team.members.some((m) => m.name === args.agent)
      if (!isMember) {
        return {
          title: "Invalid Agent",
          output: `"${args.agent}" is not a member of team "${args.team}"`,
          metadata: { success: false },
        }
      }

      // Assign the task by claiming it for the target agent
      const result = await TeamTasks.claimTask(args.team, args.taskId, args.agent)

      if (!result.success) {
        return {
          title: "Assignment Failed",
          output: result.error || "Failed to assign task",
          metadata: { success: false, error: result.error },
        }
      }

      // Notify the assigned agent
      await TeamInbox.sendMessage(
        args.team,
        args.agent,
        ctx.agent,
        `📋 You have been assigned task "${args.taskId}": ${task.description}`,
        "system"
      )

      return {
        title: "Task Assigned",
        output: `Task "${args.taskId}" assigned to "${args.agent}"`,
        metadata: {
          success: true,
          taskId: args.taskId,
          assignedTo: args.agent,
          description: task.description,
        },
      }
    },
  })
)

export const TeamCompleteTaskTool = Tool.define(
  "team_complete_task",
  async () => ({
    description: "Mark a claimed task as completed",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("ID of the task to complete"),
    }),
    execute: async (args, ctx) => {
      const result = await TeamTasks.completeTask(args.team, args.taskId, ctx.agent)

      if (!result.success) {
        return {
          title: "Completion Failed",
          output: result.error || "Failed to complete task",
          metadata: { success: false, error: result.error },
        }
      }

      return {
        title: "Task Completed",
        output: `Task "${args.taskId}" marked as completed`,
        metadata: {
          success: true,
          taskId: args.taskId,
          completedAt: result.task?.completedAt,
        },
      }
    },
  })
)

export const TeamListTasksTool = Tool.define(
  "team_list_tasks",
  async () => ({
    description: "List tasks in the team",
    parameters: z.object({
      team: z.string().describe("Team name"),
      status: z
        .enum(["pending", "in_progress", "completed", "failed", "blocked"])
        .optional()
        .describe("Filter by status"),
    }),
    execute: async (args, ctx) => {
      const tasks = await TeamTasks.getTasks(args.team, { status: args.status })

      if (tasks.length === 0) {
        return {
          title: "No Tasks",
          output: "No tasks found.",
          metadata: { count: 0 },
        }
      }

      const formatted = tasks
        .map((t) => {
          const deps = t.dependsOn?.length ? ` [deps: ${t.dependsOn.join(", ")}]` : ""
          const claimed = t.claimedBy ? ` (claimed by: ${t.claimedBy})` : ""
          return `${t.id}: ${t.status}${claimed}${deps}\n  ${t.description.slice(0, 80)}${
            t.description.length > 80 ? "..." : ""
          }`
        })
        .join("\n\n")

      return {
        title: `Tasks (${tasks.length})`,
        output: formatted,
        metadata: {
          count: tasks.length,
          tasks: tasks.map((t) => ({
            id: t.id,
            status: t.status,
            claimedBy: t.claimedBy,
          })),
        },
      }
    },
  })
)

export const TeamShutdownTool = Tool.define(
  "team_shutdown",
  async () => ({
    description: "Request shutdown of a teammate (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      agent: z.string().describe("Name of the agent to shutdown"),
    }),
    execute: async (args, ctx) => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can shutdown teammates",
          metadata: { success: false },
        }
      }

      const sessions = await TeamSession.getSessionsByAgent(args.team, args.agent)
      const activeSession = sessions.find((s) => s.status !== "shutdown" && s.status !== "error")

      if (!activeSession) {
        return {
          title: "No Active Session",
          output: `No active session found for agent "${args.agent}"`,
          metadata: { success: false },
        }
      }

      await TeamSession.requestShutdown(args.team, activeSession.sessionId)

      await TeamInbox.sendMessage(
        args.team,
        args.agent,
        ctx.agent,
        JSON.stringify({ type: "shutdown_request", reason: "Lead requested shutdown" }),
        "system"
      )

      return {
        title: "Shutdown Requested",
        output: `Shutdown requested for agent "${args.agent}"`,
        metadata: {
          success: true,
          sessionId: activeSession.sessionId,
        },
      }
    },
  })
)

export const TeamCleanupTool = Tool.define(
  "team_cleanup",
  async () => ({
    description: "Clean up old team sessions and tasks (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      maxAgeDays: z.number().int().positive().default(7).describe("Maximum age in days"),
    }),
    execute: async (args, ctx) => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can cleanup the team",
          metadata: { success: false },
        }
      }

      const maxAgeMs = args.maxAgeDays * 24 * 60 * 60 * 1000
      const removed = await TeamSession.cleanupOldSessions(args.team, maxAgeMs)

      return {
        title: "Cleanup Complete",
        output: `Cleaned up ${removed} old sessions`,
        metadata: {
          success: true,
          removedSessions: removed,
          maxAgeDays: args.maxAgeDays,
        },
      }
    },
  })
)

// Export all team tools
export const TeamTools = [
  TeamCreateTool,
  TeamMessageTool,
  TeamBroadcastTool,
  TeamCheckInboxTool,
  TeamMarkReadTool,
  TeamCreateTaskTool,
  TeamClaimTaskTool,
  TeamAssignTaskTool,
  TeamCompleteTaskTool,
  TeamListTasksTool,
  TeamShutdownTool,
  TeamCleanupTool,
]
