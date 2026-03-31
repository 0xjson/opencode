import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "team.inbox" })
const MAX_MESSAGE_SIZE = 64 * 1024 // 64KB max message size

export namespace TeamInbox {
  export interface InboxMessage extends Team.Message {}

  async function isTeamMember(teamName: string, agentName: string): Promise<boolean> {
    const team = await TeamRegistry.getTeam(teamName)
    if (!team) {
      log.debug(`Team "${teamName}" not found when checking membership for "${agentName}"`)
      return false
    }

    // Normalize names for comparison (remove common suffixes like "(Ultraworker)")
    const normalizeName = (name: string): string => {
      return name.replace(/\s*\([^)]*\)\s*$/, "").trim()
    }

    const normalizedAgentName = normalizeName(agentName)

    // Check against members
    const isMember = team.members.some((m) => {
      const normalizedMemberName = normalizeName(m.name)
      return (
        m.name === agentName ||                  // Exact match
        normalizedMemberName === normalizedAgentName ||  // Normalized match
        agentName.includes(m.name) ||            // Agent name contains member name
        m.name.includes(agentName)               // Member name contains agent name
      )
    })

    // Check against lead
    const normalizedLeadName = normalizeName(team.lead)
    const isLead = (
      team.lead === agentName ||
      normalizedLeadName === normalizedAgentName ||
      agentName.includes(team.lead) ||
      team.lead.includes(agentName)
    )

    const result = isMember || isLead
    if (!result) {
      log.debug(`Membership check failed: "${agentName}" (normalized: "${normalizedAgentName}") not found in team "${teamName}". Members: [${team.members.map(m => `"${m.name}"`).join(", ")}], Lead: "${team.lead}"`)
    }

    return result
  }

  export async function sendMessage(
    teamName: string,
    to: string,
    from: string,
    text: string,
    type: Team.Message["type"] = "message",
    metadata?: Record<string, any>
  ): Promise<Team.Message> {
    // Validate sender is team member
    if (!(await isTeamMember(teamName, from))) {
      throw new Error(`Sender "${from}" is not a member of team "${teamName}"`)
    }

    // Validate recipient is team member (except for system messages)
    if (type !== "system" && !(await isTeamMember(teamName, to))) {
      throw new Error(`Recipient "${to}" is not a member of team "${teamName}"`)
    }

    // Validate message size
    if (text.length > MAX_MESSAGE_SIZE) {
      throw new Error(`Message exceeds maximum size of ${MAX_MESSAGE_SIZE} bytes`)
    }

    const message: Team.Message = {
      id: ulid(),
      from,
      to,
      text,
      timestamp: Date.now(),
      read: false,
      type,
      metadata,
    }

    const inboxPath = await TeamRegistry.getInboxPath(teamName, to)
    const line = JSON.stringify(message) + "\n"

    await Filesystem.appendFile(inboxPath, line)
    log.info(`Message sent from "${from}" to "${to}" in team "${teamName}"`)

    return message
  }

  export async function broadcastMessage(
    teamName: string,
    from: string,
    text: string,
    excludeSender: boolean = true
  ): Promise<Team.Message[]> {
    const team = await TeamRegistry.getTeam(teamName)
    if (!team) {
      throw new Error(`Team "${teamName}" not found`)
    }

    const messages: Team.Message[] = []

    // Collect all recipients (members + lead)
    const recipients = new Set<string>(team.members.map((m) => m.name))
    recipients.add(team.lead)

    for (const recipient of recipients) {
      if (excludeSender && recipient === from) continue

      const message = await sendMessage(teamName, recipient, from, text, "broadcast")
      messages.push(message)
    }

    log.info(`Broadcast sent from "${from}" to ${messages.length} members in team "${teamName}"`)
    return messages
  }

  export async function getMessages(
    teamName: string,
    agentName: string,
    options: {
      unreadOnly?: boolean
      since?: number
      limit?: number
      from?: string
    } = {}
  ): Promise<Team.Message[]> {
    const inboxPath = await TeamRegistry.getInboxPath(teamName, agentName)
    const exists = await Filesystem.exists(inboxPath)
    if (!exists) return []

    const content = await Filesystem.readText(inboxPath).catch(() => "")
    if (!content) return []

    const lines = content.split("\n").filter(Boolean)
    const messages: Team.Message[] = []

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as Team.Message

        if (options.unreadOnly && msg.read) continue
        if (options.since && msg.timestamp < options.since) continue
        if (options.from && msg.from !== options.from) continue

        messages.push(msg)
      } catch {
        // Skip invalid lines
      }
    }

    if (options.limit) {
      return messages.slice(-options.limit)
    }

    return messages
  }

  export async function markRead(
    teamName: string,
    agentName: string,
    options?: { messageIds?: string[] } | string[]
  ): Promise<number> {
    // Handle both old signature (string[]) and new signature ({ messageIds?: string[] })
    const messageIds = Array.isArray(options) ? options : options?.messageIds
    const inboxPath = await TeamRegistry.getInboxPath(teamName, agentName)
    const exists = await Filesystem.exists(inboxPath)
    if (!exists) return 0

    const content = await Filesystem.readText(inboxPath).catch(() => "")
    if (!content) return 0

    const lines = content.split("\n").filter(Boolean)
    let markedCount = 0
    const updatedLines: string[] = []

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as Team.Message

        if (!msg.read) {
          if (!messageIds || messageIds.includes(msg.id)) {
            msg.read = true
            markedCount++
          }
        }

        updatedLines.push(JSON.stringify(msg))
      } catch {
        updatedLines.push(line)
      }
    }

    if (markedCount > 0) {
      await Filesystem.writeText(inboxPath, updatedLines.join("\n") + "\n")
      log.info(`Marked ${markedCount} messages as read for "${agentName}" in team "${teamName}"`)
    }

    return markedCount
  }

  export async function getUnreadCount(teamName: string, agentName: string): Promise<number> {
    const messages = await getMessages(teamName, agentName, { unreadOnly: true })
    return messages.length
  }

  export async function sendReceipt(
    teamName: string,
    to: string,
    from: string,
    messageIds: string[]
  ): Promise<Team.Message> {
    const text = JSON.stringify({ type: "read_receipt", messageIds })
    return sendMessage(teamName, to, from, text, "receipt")
  }

  // Aliases for backward compatibility with tests
  export const broadcast = broadcastMessage

  export async function hasUnread(teamName: string, agentName: string): Promise<boolean> {
    const count = await getUnreadCount(teamName, agentName)
    return count > 0
  }

  export async function countUnread(teamName: string, agentName: string): Promise<number> {
    return getUnreadCount(teamName, agentName)
  }

  export async function clearInbox(teamName: string, agentName: string): Promise<void> {
    const inboxPath = await TeamRegistry.getInboxPath(teamName, agentName)
    const exists = await Filesystem.exists(inboxPath)
    if (exists) {
      await Filesystem.writeText(inboxPath, "")
    }
  }
}
