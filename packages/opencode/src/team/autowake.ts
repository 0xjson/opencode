import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamInbox } from "./inbox"
import { TeamSession } from "./session"
import { TeamTasks } from "./tasks"
import { Log } from "../util/log"

const log = Log.create({ service: "team.autowake" })

export namespace TeamAutowake {
  /**
   * Check if an agent has pending messages in their inbox.
   * Used by the prompt loop to trigger auto-wake for teammates.
   */
  export async function hasPendingMessages(
    teamName: string,
    agentName: string
  ): Promise<boolean> {
    try {
      const count = await TeamInbox.getUnreadCount(teamName, agentName)
      return count > 0
    } catch (error) {
      log.error(`Failed to check pending messages for ${agentName}:`, { error })
      return false
    }
  }

  /**
   * Get all team members that have pending unread messages.
   */
  export async function getAgentsWithPendingMessages(
    teamName: string
  ): Promise<Array<{ agentName: string; messageCount: number }>> {
    const team = await TeamRegistry.getTeam(teamName)
    if (!team) return []

    const result: Array<{ agentName: string; messageCount: number }> = []

    for (const member of team.members) {
      const count = await TeamInbox.getUnreadCount(teamName, member.name)
      if (count > 0) {
        result.push({ agentName: member.name, messageCount: count })
      }
    }

    return result
  }

  /**
   * Check if a teammate is idle and has pending messages.
   * This is the main function for the auto-wake hook.
   */
  export async function shouldWakeAgent(
    teamName: string,
    agentName: string
  ): Promise<{ shouldWake: boolean; reason?: string; messageCount?: number }> {
    const sessions = await TeamSession.getSessionsByAgent(teamName, agentName)
    const activeSession = sessions.find(
      (s) => s.status !== "shutdown" && s.status !== "error"
    )

    // If no active session, can't wake
    if (!activeSession) {
      return { shouldWake: false, reason: "no_active_session" }
    }

    // If agent is busy, don't wake (already working)
    if (activeSession.status === "busy") {
      return { shouldWake: false, reason: "agent_busy" }
    }

    // Check for pending messages
    const messageCount = await TeamInbox.getUnreadCount(teamName, agentName)
    if (messageCount === 0) {
      return { shouldWake: false, reason: "no_pending_messages" }
    }

    return {
      shouldWake: true,
      reason: "pending_messages",
      messageCount,
    }
  }

  /**
   * Get a wake notification message for an agent.
   * This can be injected into the prompt context.
   */
  export async function getWakeNotification(
    teamName: string,
    agentName: string
  ): Promise<string | null> {
    const messages = await TeamInbox.getMessages(teamName, agentName, {
      unreadOnly: true,
      limit: 5,
    })

    if (messages.length === 0) return null

    const formatted = messages
      .map((m) => {
        const time = new Date(m.timestamp).toLocaleTimeString()
        return `[${time}] ${m.from}: ${m.text}`
      })
      .join("\n")

    return `📨 You have ${messages.length} unread message(s) from your team:\n\n${formatted}`
  }

  /**
   * Wake notification format for system prompt injection.
   */
  export interface WakeContext {
    hasMessages: boolean
    messageCount: number
    notificationText: string | null
    pendingTasks: Array<{
      taskId: string
      description: string
    }>
  }

  /**
   * Get complete wake context for an agent.
   * This combines inbox messages and available tasks.
   */
  export async function getWakeContext(
    teamName: string,
    agentName: string
  ): Promise<WakeContext> {
    const [messageCount, notificationText, availableTasks] = await Promise.all([
      TeamInbox.getUnreadCount(teamName, agentName),
      getWakeNotification(teamName, agentName),
      TeamTasks.getAvailableTasks(teamName),
    ])

    return {
      hasMessages: messageCount > 0,
      messageCount,
      notificationText,
      pendingTasks: availableTasks.map((task) => ({
        taskId: task.id,
        description: task.description,
      })),
    }
  }
}
