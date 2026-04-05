import { Tool } from "../tool/tool"
import { z } from "zod"
import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamInbox } from "./inbox"
import { TeamTasks } from "./tasks"
import { TeamSession } from "./session"
import { TeamScheduler } from "./scheduler"
import { TeamBidding } from "./bidding"
import { EmbeddingService } from "./embedding"
import { ScoringEngine } from "./scorer"
import { CircuitBreaker } from "./circuitBreaker"
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

      const formatted = messages
        .map((m) => {
          const time = new Date(m.timestamp).toLocaleTimeString()
          return `[${time}] ${m.from}: ${m.text.slice(0, 100)}${m.text.length > 100 ? "..." : ""}`
        })
        .join("\n")

      return {
        title: messages.length === 0 ? "Inbox Empty" : `Inbox (${messages.length} messages)`,
        output: messages.length === 0 ? "No messages in your inbox." : formatted,
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
      const count = await TeamInbox.markRead(args.team, ctx.agent, { messageIds: args.messageIds })

      return {
        title: "Messages Marked Read",
        output: `Marked ${count} messages as read`,
        metadata: { success: true, markedCount: count },
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

      return {
        title: result.success ? "Task Claimed" : "Claim Failed",
        output: result.success
          ? `Successfully claimed task "${args.taskId}"`
          : result.error || "Failed to claim task",
        metadata: {
          success: result.success,
          error: result.success ? undefined : result.error,
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
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        success: boolean
        taskId: string
        assignedTo: string | undefined
        description: string | undefined
      }
    }> => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, taskId: args.taskId, assignedTo: undefined, description: undefined },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can assign tasks to specific agents",
          metadata: { success: false, taskId: args.taskId, assignedTo: undefined, description: undefined },
        }
      }

      const tasks = await TeamTasks.getTasks(args.team)
      const task = tasks.find((t) => t.id === args.taskId)

      if (!task) {
        return {
          title: "Task Not Found",
          output: `Task "${args.taskId}" not found`,
          metadata: { success: false, taskId: args.taskId, assignedTo: undefined, description: undefined },
        }
      }

      if (task.status !== "pending") {
        return {
          title: "Task Not Available",
          output: `Task "${args.taskId}" is not available (status: ${task.status})`,
          metadata: { success: false, taskId: args.taskId, assignedTo: undefined, description: undefined },
        }
      }

      // Check if the target agent is a team member
      const isMember = team.members.some((m) => m.name === args.agent)
      if (!isMember) {
        return {
          title: "Invalid Agent",
          output: `"${args.agent}" is not a member of team "${args.team}"`,
          metadata: { success: false, taskId: args.taskId, assignedTo: undefined, description: undefined },
        }
      }

      // Assign the task by claiming it for the target agent
      const result = await TeamTasks.claimTask(args.team, args.taskId, args.agent)

      if (!result.success) {
        return {
          title: "Assignment Failed",
          output: result.error || "Failed to assign task",
          metadata: { success: false, taskId: args.taskId, assignedTo: undefined, description: undefined },
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

      return {
        title: result.success ? "Task Completed" : "Completion Failed",
        output: result.success
          ? `Task "${args.taskId}" marked as completed`
          : result.error || "Failed to complete task",
        metadata: {
          success: result.success,
          error: result.success ? undefined : result.error,
          taskId: args.taskId,
          completedAt: result.success ? result.task?.completedAt : undefined,
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
        title: tasks.length === 0 ? "No Tasks" : `Tasks (${tasks.length})`,
        output: tasks.length === 0 ? "No tasks found." : formatted,
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
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        success: boolean
        sessionId: string | undefined
      }
    }> => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, sessionId: undefined },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can shutdown teammates",
          metadata: { success: false, sessionId: undefined },
        }
      }

      const sessions = await TeamSession.getSessionsByAgent(args.team, args.agent)
      const activeSession = sessions.find((s) => s.status !== "shutdown" && s.status !== "error")

      if (!activeSession) {
        return {
          title: "No Active Session",
          output: `No active session found for agent "${args.agent}"`,
          metadata: { success: false, sessionId: undefined },
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
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        success: boolean
        removedSessions: number | undefined
        maxAgeDays: number | undefined
      }
    }> => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, removedSessions: undefined, maxAgeDays: undefined },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can cleanup the team",
          metadata: { success: false, removedSessions: undefined, maxAgeDays: undefined },
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

export const TeamListTool = Tool.define(
  "team_list",
  async () => ({
    description: "List all available teams",
    parameters: z.object({}),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        teams: string[]
        count: number
      }
    }> => {
      const teams = await TeamRegistry.listTeams()

      const formatted = teams.length === 0
        ? "No teams found."
        : teams.map((t) => `  - ${t}`).join("\n")

      return {
        title: teams.length === 0 ? "No Teams" : `${teams.length} Team(s)`,
        output: formatted,
        metadata: {
          teams,
          count: teams.length,
        },
      }
    },
  })
)

export const TeamInfoTool = Tool.define(
  "team_info",
  async () => ({
    description: "Get information about a team",
    parameters: z.object({
      team: z.string().describe("Team name"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        team: string
        lead: string
        members: string[]
        description?: string
        createdAt?: number
      }
    }> => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { team: args.team, lead: "", members: [] },
        }
      }

      const memberList = team.members.map((m) => `  - ${m.name} (${m.agentType})`).join("\n")
      const output = `Team: ${team.team}\nLead: ${team.lead}\nMembers:\n${memberList}`

      return {
        title: `Team: ${team.team}`,
        output,
        metadata: {
          team: team.team,
          lead: team.lead,
          members: team.members.map((m) => m.name),
          description: team.description,
          createdAt: team.createdAt,
        },
      }
    },
  })
)

export const TeamAddMemberTool = Tool.define(
  "team_add_member",
  async () => ({
    description: "Add a member to a team (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      name: z.string().describe("Name of the new member"),
      agentType: z.enum(["general-purpose", "Explore", "Plan"]).default("general-purpose").describe("Type of agent"),
      model: z.string().optional().describe("Model to use (e.g., 'claude', 'codex', 'gemini')"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        success: boolean
        team: string
        member: string
      }
    }> => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, team: args.team, member: args.name },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can add members",
          metadata: { success: false, team: args.team, member: args.name },
        }
      }

      // Check if member already exists
      if (team.members.some((m) => m.name === args.name)) {
        return {
          title: "Member Already Exists",
          output: `Member "${args.name}" is already in team "${args.team}"`,
          metadata: { success: false, team: args.team, member: args.name },
        }
      }

      const newMember: Team.MemberConfig = {
        name: args.name,
        agentType: args.agentType,
        model: args.model,
      }

      team.members.push(newMember)
      await TeamRegistry.updateTeam(args.team, { members: team.members })

      // Notify the new member
      await TeamInbox.sendMessage(
        args.team,
        args.name,
        ctx.agent,
        `👋 Welcome to team "${args.team}"! You've been added as a member.`,
        "system"
      )

      return {
        title: "Member Added",
        output: `Added "${args.name}" to team "${args.team}"`,
        metadata: { success: true, team: args.team, member: args.name },
      }
    },
  })
)

// ============================================================================
// ORCHESTRATION ENGINE TOOLS - Phase 1
// ============================================================================

export const TeamAutoClaimTool = Tool.define(
  "team_auto_claim",
  async () => ({
    description: "Automatically find and claim the best matching task based on agent capabilities",
    parameters: z.object({
      team: z.string().describe("Team name"),
      minScore: z.number().min(0).max(1).optional().describe("Minimum score threshold (0-1)"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        success: boolean
        error?: string
        taskId?: string
        score?: number
        components?: any
        taskType?: string
        difficulty?: number
      }
    }> => {
      const result = await TeamTasks.autoClaimTask(args.team, ctx.agent, {
        minScore: args.minScore ?? 0.3,
      })

      if (!result.success) {
        return {
          title: "Auto-Claim Failed",
          output: result.error || "No suitable task found",
          metadata: { success: false, error: result.error },
        }
      }

      const components = result.components
      const componentBreakdown = components
        ? `
Score Components:
  - Semantic Similarity: ${(components.semanticSimilarity * 100).toFixed(1)}%
  - Availability: ${(components.availability * 100).toFixed(1)}%
  - Dependency Ready: ${(components.dependencyReady * 100).toFixed(1)}%
  - Reliability: ${(components.reliability * 100).toFixed(1)}%
  - Latency Efficiency: ${(components.latencyEfficiency * 100).toFixed(1)}%
  - Exploration Bonus: ${(components.explorationBonus * 100).toFixed(1)}%`
        : ""

      return {
        title: "Task Auto-Claimed",
        output: `Successfully claimed task "${result.task?.id}" with score ${(result.score! * 100).toFixed(1)}%

Task: ${result.task?.description.slice(0, 100)}${result.task!.description.length > 100 ? "..." : ""}
Type: ${result.task?.taskType || "general"}
Difficulty: ${result.task?.estimatedDifficulty || "unknown"}/10${componentBreakdown}`,
        metadata: {
          success: true,
          taskId: result.task?.id,
          score: result.score,
          components: result.components,
          taskType: result.task?.taskType,
          difficulty: result.task?.estimatedDifficulty,
        },
      }
    },
  })
)

export const TeamSelectBestAgentTool = Tool.define(
  "team_select_best_agent",
  async () => ({
    description: "Find the best agent for a specific task (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("ID of the task to find best agent for"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        success: boolean
        error?: string
        bestAgent?: string
        score?: number
        allScores?: any[]
      }
    }> => {
      // Verify caller is lead
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
          output: "Only the team lead can use agent selection",
          metadata: { success: false },
        }
      }

      const result = await TeamTasks.selectBestAgent(args.team, args.taskId)

      if (result.error) {
        return {
          title: "Selection Failed",
          output: result.error,
          metadata: { success: false, error: result.error },
        }
      }

      const scoresText = result.allScores
        .slice(0, 5)
        .map((s, i) => {
          const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "  "
          return `${medal} ${s.agentName}: ${(s.score * 100).toFixed(1)}%`
        })
        .join("\n")

      return {
        title: result.bestAgent ? `Best Agent: ${result.bestAgent}` : "No Suitable Agent",
        output: result.bestAgent
          ? `Best agent for task "${args.taskId}" is "${result.bestAgent}" with score ${(result.score * 100).toFixed(1)}%\n\nTop Matches:\n${scoresText}`
          : "No agent meets the minimum score threshold for this task",
        metadata: {
          success: true,
          bestAgent: result.bestAgent || undefined,
          score: result.score,
          allScores: result.allScores,
        },
      }
    },
  })
)

export const TeamGetAgentStatsTool = Tool.define(
  "team_get_agent_stats",
  async () => ({
    description: "Get performance statistics for team agents",
    parameters: z.object({
      team: z.string().describe("Team name"),
      agent: z.string().optional().describe("Specific agent name (omit for all agents)"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        success: boolean
        error?: string
      }
    }> => {
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, error: "Team not found" },
        }
      }

      // Allow members to see their own stats, lead to see all
      const isLead = team.lead === ctx.agent
      const targetAgent = args.agent || ctx.agent

      if (!isLead && targetAgent !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "You can only view your own stats",
          metadata: { success: false, error: "Permission denied" },
        }
      }

      const stats = await TeamRegistry.loadAgentStats(args.team)

      if (targetAgent) {
        const agentStats = stats.find((s) => s.agentName === targetAgent)
        if (!agentStats) {
          return {
            title: "No Stats Found",
            output: `No statistics found for agent "${targetAgent}"`,
            metadata: { success: false, error: "No stats found" },
          }
        }

        const successRate = agentStats.totalTasks > 0
          ? ((agentStats.successfulTasks / agentStats.totalTasks) * 100).toFixed(1)
          : "N/A"

        const taskTypeBreakdown = Object.entries(agentStats.taskTypeStats)
          .map(([type, s]) => {
            const rate = s.attempts > 0 ? ((s.successes / s.attempts) * 100).toFixed(0) : "0"
            const avgTime = s.avgCompletionTime > 0
              ? `${(s.avgCompletionTime / 60000).toFixed(1)}m`
              : "N/A"
            return `  ${type}: ${s.attempts} tasks, ${rate}% success, avg ${avgTime}`
          })
          .join("\n")

        return {
          title: `Stats: ${targetAgent}`,
          output: `Performance Statistics for "${targetAgent}":

Overall:
  Total Tasks: ${agentStats.totalTasks}
  Successful: ${agentStats.successfulTasks}
  Failed: ${agentStats.failedTasks}
  Success Rate: ${successRate}%
  Reliability Score: ${((agentStats.reliabilityScore || 0.5) * 100).toFixed(1)}%
  Active Tasks: ${agentStats.activeTasks || 0}

By Task Type:
${taskTypeBreakdown || "  No task type data yet"}`,
          metadata: { success: true },
        }
      }

      // Return summary for all agents
      const summary = stats.map((s) => {
        const rate = s.totalTasks > 0 ? ((s.successfulTasks / s.totalTasks) * 100).toFixed(0) : "0"
        return `  ${s.agentName}: ${s.totalTasks} tasks, ${rate}% success, ${s.activeTasks || 0} active`
      }).join("\n")

      return {
        title: `Team Stats (${stats.length} agents)`,
        output: `Agent Performance Summary:\n${summary || "  No statistics available"}`,
        metadata: { success: true },
      }
    },
  })
)

export const TeamGetReadyTasksTool = Tool.define(
  "team_get_ready_tasks",
  async () => ({
    description: "Get tasks that are ready for execution (dependencies satisfied)",
    parameters: z.object({
      team: z.string().describe("Team name"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: {
        count: number
        tasks: any[]
      }
    }> => {
      const readyTasks = await TeamTasks.getDependencyReadyTasks(args.team)
      const rankedTasks = await TeamTasks.rankPendingTasks(args.team)

      const formatted = rankedTasks
        .filter((r) => r.ready)
        .slice(0, 20)
        .map((r) => {
          const t = r.task
          const type = t.taskType ? `[${t.taskType}] ` : ""
          const priority = t.priority !== "normal" ? `(${t.priority}) ` : ""
          return `${t.id}: ${priority}${type}${t.description.slice(0, 60)}${t.description.length > 60 ? "..." : ""}`
        })
        .join("\n")

      return {
        title: `${readyTasks.length} Ready Tasks`,
        output: readyTasks.length === 0
          ? "No tasks are ready for execution (dependencies not satisfied or all tasks claimed)"
          : `Tasks ready for execution:\n${formatted}`,
        metadata: {
          count: readyTasks.length,
          tasks: readyTasks.map((t) => ({
            id: t.id,
            description: t.description.slice(0, 100),
            taskType: t.taskType,
            priority: t.priority,
            difficulty: t.estimatedDifficulty,
          })),
        },
      }
    },
  })
)

// ============================================================================
// SCHEDULER TOOLS - Phase 2
// ============================================================================

export const TeamStartSchedulerTool = Tool.define(
  "team_start_scheduler",
  async () => ({
    description: "Start the autonomous task scheduler for a team (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      intervalMs: z.number().min(1000).max(60000).optional().describe("Interval between scheduler ticks in ms (default: 5000)"),
      maxTasksPerCycle: z.number().min(1).max(50).optional().describe("Max tasks to assign per cycle (default: 10)"),
      minAutoClaimScore: z.number().min(0).max(1).optional().describe("Minimum score for auto-claim (default: 0.3)"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; error?: string }
    }> => {
      // Verify caller is lead
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, error: "Team not found" },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can start the scheduler",
          metadata: { success: false, error: "Permission denied" },
        }
      }

      const result = await TeamScheduler.startScheduler(args.team, {
        intervalMs: args.intervalMs,
        maxTasksPerCycle: args.maxTasksPerCycle,
        minAutoClaimScore: args.minAutoClaimScore,
      })

      return {
        title: result.success ? "Scheduler Started" : "Start Failed",
        output: result.success
          ? `Autonomous scheduler started for team "${args.team}". Tasks will be automatically assigned based on agent capabilities.`
          : result.error || "Failed to start scheduler",
        metadata: { success: result.success, error: result.error },
      }
    },
  })
)

export const TeamStopSchedulerTool = Tool.define(
  "team_stop_scheduler",
  async () => ({
    description: "Stop the autonomous task scheduler for a team (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; stats?: any; error?: string }
    }> => {
      // Verify caller is lead
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, error: "Team not found" },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can stop the scheduler",
          metadata: { success: false, error: "Permission denied" },
        }
      }

      const result = await TeamScheduler.stopScheduler(args.team)

      if (!result.success) {
        return {
          title: "Stop Failed",
          output: result.error || "Failed to stop scheduler",
          metadata: { success: false, error: result.error },
        }
      }

      const stats = result.stats!
      const runtime = Math.floor(stats.runtime / 1000)
      const minutes = Math.floor(runtime / 60)
      const seconds = runtime % 60

      return {
        title: "Scheduler Stopped",
        output: `Scheduler stopped for team "${args.team}".

Runtime: ${minutes}m ${seconds}s
Cycles: ${stats.cycles}
Tasks Scheduled: ${stats.tasksScheduled}
Tasks Completed: ${stats.tasksCompleted}
Tasks Failed: ${stats.tasksFailed}`,
        metadata: { success: true, stats: result.stats },
      }
    },
  })
)

export const TeamSchedulerStatusTool = Tool.define(
  "team_scheduler_status",
  async () => ({
    description: "Get the status of the autonomous task scheduler",
    parameters: z.object({
      team: z.string().describe("Team name"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { running: boolean; stats?: any }
    }> => {
      const status = await TeamScheduler.getSchedulerStatus(args.team)

      if (!status.running) {
        return {
          title: "Scheduler Not Running",
          output: `The scheduler is not currently running for team "${args.team}".

Use team_start_scheduler to begin autonomous task assignment.`,
          metadata: { running: false },
        }
      }

      const stats = status.stats!
      const runtime = Math.floor(stats.runtime / 1000)
      const minutes = Math.floor(runtime / 60)
      const seconds = runtime % 60

      return {
        title: "Scheduler Running",
        output: `Scheduler is running for team "${args.team}".

Runtime: ${minutes}m ${seconds}s
Cycles: ${stats.cycles}
Tasks Scheduled: ${stats.tasksScheduled}
Tasks Completed: ${stats.tasksCompleted}
Tasks Failed: ${stats.tasksFailed}

Interval: ${status.options?.intervalMs}ms
Max Tasks/Cycle: ${status.options?.maxTasksPerCycle}`,
        metadata: { running: true, stats: status.stats },
      }
    },
  })
)

export const TeamRunSchedulerTickTool = Tool.define(
  "team_run_scheduler_tick",
  async () => ({
    description: "Run a single scheduler tick manually (for testing/debugging)",
    parameters: z.object({
      team: z.string().describe("Team name"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; results?: any; error?: string }
    }> => {
      try {
        const results = await TeamScheduler.schedulerTick(args.team)

        return {
          title: `Scheduler Tick #${results.cycle}`,
          output: `Scheduler tick completed:

Tasks assigned by lead: ${results.assigned}
Tasks auto-claimed: ${results.claimed}
Tasks completed: ${results.completed}
Tasks failed: ${results.failed}
Tasks retried: ${results.retried}
Tasks unlocked: ${results.unlocked}`,
          metadata: { success: true, results },
        }
      } catch (error) {
        return {
          title: "Tick Failed",
          output: `Scheduler tick failed: ${error}`,
          metadata: { success: false, error: String(error) },
        }
      }
    },
  })
)

// ============================================================================
// BIDDING SYSTEM TOOLS - Phase 3
// ============================================================================

export const TeamStartBiddingTool = Tool.define(
  "team_start_bidding",
  async () => ({
    description: "Start a bidding phase for a complex task (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("Task ID to bid on"),
      durationMs: z.number().min(5000).max(300000).optional().describe("Bidding duration in ms (default: 30000)"),
      minConfidence: z.number().min(0).max(1).optional().describe("Minimum confidence required (default: 0.5)"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; biddingId?: string; deadline?: number; error?: string }
    }> => {
      // Verify caller is lead
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, error: "Team not found" },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can start bidding",
          metadata: { success: false, error: "Permission denied" },
        }
      }

      const result = await TeamBidding.startBiddingPhase(args.team, args.taskId, {
        durationMs: args.durationMs,
        minConfidence: args.minConfidence,
      })

      if (!result.success) {
        return {
          title: "Bidding Failed",
          output: result.error || "Failed to start bidding",
          metadata: { success: false, error: result.error },
        }
      }

      const deadline = new Date(result.deadline!).toLocaleTimeString()

      return {
        title: "Bidding Started",
        output: `Bidding phase started for task "${args.taskId}".

Deadline: ${deadline}
Bidding ID: ${result.biddingId}

Agents can now submit bids using team_submit_bid.`,
        metadata: {
          success: true,
          biddingId: result.biddingId,
          deadline: result.deadline,
        },
      }
    },
  })
)

export const TeamSubmitBidTool = Tool.define(
  "team_submit_bid",
  async () => ({
    description: "Submit a bid for a task in bidding phase",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("Task ID to bid on"),
      confidence: z.number().min(0).max(1).describe("Confidence level (0-1)"),
      estimatedMinutes: z.number().min(1).describe("Estimated completion time in minutes"),
      reasoning: z.string().optional().describe("Optional reasoning for bid"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; rank?: number; totalBids?: number; error?: string }
    }> => {
      const result = await TeamBidding.submitBid(
        args.team,
        args.taskId,
        ctx.agent,
        {
          confidence: args.confidence,
          estimatedCompletionTime: args.estimatedMinutes,
          reasoning: args.reasoning,
        }
      )

      if (!result.success) {
        return {
          title: "Bid Failed",
          output: result.error || "Failed to submit bid",
          metadata: { success: false, error: result.error },
        }
      }

      return {
        title: "Bid Submitted",
        output: `Your bid for task "${args.taskId}" has been submitted.

Confidence: ${(args.confidence * 100).toFixed(0)}%
Estimated Time: ${args.estimatedMinutes} minutes

Current Rank: #${result.rank} of ${result.totalBids} bids`,
        metadata: {
          success: true,
          rank: result.rank,
          totalBids: result.totalBids,
        },
      }
    },
  })
)

export const TeamGetBidsTool = Tool.define(
  "team_get_bids",
  async () => ({
    description: "View current bids for a task in bidding phase",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("Task ID"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { active: boolean; bidCount?: number; error?: string }
    }> => {
      const status = await TeamBidding.getBiddingStatus(args.team, args.taskId)

      if (status.error) {
        return {
          title: "Error",
          output: status.error,
          metadata: { active: false, error: status.error },
        }
      }

      if (!status.active) {
        return {
          title: "No Active Bidding",
          output: status.status
            ? `Bidding for task "${args.taskId}" is ${status.status}.`
            : `No active bidding for task "${args.taskId}".`,
          metadata: { active: false },
        }
      }

      const timeRemaining = Math.floor((status.timeRemainingMs || 0) / 1000)
      const minutes = Math.floor(timeRemaining / 60)
      const seconds = timeRemaining % 60

      const bidsText = status.rankedBids
        ?.slice(0, 10)
        .map((b) => {
          const medal = b.rank === 1 ? "🥇" : b.rank === 2 ? "🥈" : b.rank === 3 ? "🥉" : "  "
          return `${medal} #${b.rank} ${b.agentName}: ${(b.confidence * 100).toFixed(0)}% confidence, ${b.estimatedCompletionTime}m (score: ${b.score.toFixed(2)})`
        })
        .join("\n") || "No bids yet"

      return {
        title: `Bidding Active (${status.bids?.length || 0} bids)`,
        output: `Bidding status for task "${args.taskId}":

Status: ${status.status}
Time Remaining: ${minutes}m ${seconds}s

Top Bids:
${bidsText}`,
        metadata: {
          active: true,
          bidCount: status.bids?.length || 0,
        },
      }
    },
  })
)

export const TeamResolveBiddingTool = Tool.define(
  "team_resolve_bidding",
  async () => ({
    description: "Resolve bidding and assign task to winner (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("Task ID to resolve"),
      manualWinner: z.string().optional().describe("Optional: manually specify winner instead of auto-selection"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; winner?: string; totalBids?: number; error?: string }
    }> => {
      // Verify caller is lead
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, error: "Team not found" },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can resolve bidding",
          metadata: { success: false, error: "Permission denied" },
        }
      }

      const result = await TeamBidding.resolveBidding(args.team, args.taskId, {
        manualWinner: args.manualWinner,
      })

      if (!result.success) {
        return {
          title: "Resolution Failed",
          output: result.error || "Failed to resolve bidding",
          metadata: { success: false, error: result.error },
        }
      }

      return {
        title: "Bidding Resolved",
        output: `Task "${args.taskId}" has been awarded to "${result.winner}".

Winner Confidence: ${(result.bid!.confidence * 100).toFixed(0)}%
Winner ETA: ${result.bid!.estimatedCompletionTime} minutes
Total Bidders: ${result.allBids!.length}

All bids:
${result.allBids!
  .sort((a, b) => TeamBidding["calculateBidScore"](b) - TeamBidding["calculateBidScore"](a))
  .map((b, i) => `${i + 1}. ${b.agentName}: ${(b.confidence * 100).toFixed(0)}% confidence, ${b.estimatedCompletionTime}m`)
  .join("\n")}`,
        metadata: {
          success: true,
          winner: result.winner,
          totalBids: result.allBids?.length,
        },
      }
    },
  })
)

export const TeamCancelBiddingTool = Tool.define(
  "team_cancel_bidding",
  async () => ({
    description: "Cancel bidding for a task (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      taskId: z.string().describe("Task ID to cancel"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; bidsDiscarded?: number; error?: string }
    }> => {
      // Verify caller is lead
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, error: "Team not found" },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can cancel bidding",
          metadata: { success: false, error: "Permission denied" },
        }
      }

      const result = await TeamBidding.cancelBidding(args.team, args.taskId)

      if (!result.success) {
        return {
          title: "Cancel Failed",
          output: result.error || "Failed to cancel bidding",
          metadata: { success: false, error: result.error },
        }
      }

      return {
        title: "Bidding Cancelled",
        output: `Bidding for task "${args.taskId}" has been cancelled.

${result.bids?.length || 0} bids have been discarded.`,
        metadata: {
          success: true,
          bidsDiscarded: result.bids?.length,
        },
      }
    },
  })
)

// Phase 7: Circuit Breaker Tools

import { CircuitBreaker } from "./circuitBreaker"

export const TeamGetCircuitStatusTool = Tool.define(
  "team_get_circuit_status",
  async () => ({
    description: "Get circuit breaker status for agents",
    parameters: z.object({
      team: z.string().describe("Team name"),
      agent: z.string().optional().describe("Agent name (optional, get all if omitted)"),
    }),
    execute: async (args): Promise<{
      title: string
      output: string
      metadata: { circuits: CircuitBreaker.CircuitBreakerState[] }
    }> => {
      let circuits: CircuitBreaker.CircuitBreakerState[]

      if (args.agent) {
        const state = CircuitBreaker.getCircuitState(args.team, args.agent)
        circuits = state ? [state] : []
      } else {
        circuits = CircuitBreaker.getAllCircuitStates(args.team)
      }

      if (circuits.length === 0) {
        return {
          title: "No Circuit Data",
          output: `No circuit breaker data available for team "${args.team}"`,
          metadata: { circuits: [] },
        }
      }

      const circuitLines = circuits.map((c) => {
        const status = c.state === CircuitBreaker.CircuitState.CLOSED ? "✅ CLOSED" :
                      c.state === CircuitBreaker.CircuitState.OPEN ? "❌ OPEN" : "⚠️ HALF_OPEN"
        return `${c.agentName}: ${status} (${c.failureCount} failures, ${c.successCount} successes)`
      })

      return {
        title: "Circuit Breaker Status",
        output: `Circuit breaker status for team "${args.team}":

${circuitLines.join("\n")}`,
        metadata: { circuits },
      }
    },
  })
)

export const TeamResetCircuitTool = Tool.define(
  "team_reset_circuit",
  async () => ({
    description: "Reset circuit breaker for an agent (lead only)",
    parameters: z.object({
      team: z.string().describe("Team name"),
      agent: z.string().describe("Agent name to reset"),
    }),
    execute: async (args, ctx): Promise<{
      title: string
      output: string
      metadata: { success: boolean; error?: string }
    }> => {
      // Verify caller is lead
      const team = await TeamRegistry.getTeam(args.team)
      if (!team) {
        return {
          title: "Team Not Found",
          output: `Team "${args.team}" does not exist`,
          metadata: { success: false, error: "Team not found" },
        }
      }

      if (team.lead !== ctx.agent) {
        return {
          title: "Permission Denied",
          output: "Only the team lead can reset circuit breakers",
          metadata: { success: false, error: "Permission denied" },
        }
      }

      CircuitBreaker.resetCircuitBreaker(args.team, args.agent)

      return {
        title: "Circuit Reset",
        output: `Circuit breaker for agent "${args.agent}" has been reset.`,
        metadata: { success: true },
      }
    },
  })
)

// Export all team tools
export const TeamTools = [
  TeamCreateTool,
  TeamListTool,
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
  TeamInfoTool,
  TeamAddMemberTool,
  // Orchestration Engine Tools - Phase 1
  TeamAutoClaimTool,
  TeamSelectBestAgentTool,
  TeamGetAgentStatsTool,
  TeamGetReadyTasksTool,
  // Orchestration Engine Tools - Phase 2
  TeamStartSchedulerTool,
  TeamStopSchedulerTool,
  TeamSchedulerStatusTool,
  TeamRunSchedulerTickTool,
  // Orchestration Engine Tools - Phase 3
  TeamStartBiddingTool,
  TeamSubmitBidTool,
  TeamGetBidsTool,
  TeamResolveBiddingTool,
  TeamCancelBiddingTool,
  // Phase 7: Circuit Breaker Tools
  TeamGetCircuitStatusTool,
  TeamResetCircuitTool,
]
