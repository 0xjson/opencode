import { Team } from "./schema"
import { Log } from "../util/log"

const log = Log.create({ service: "team.isolation" })

// TEAM_TOOLS that sub-agents should NOT have access to
// These are reserved for the team lead or primary agents only
export const TEAM_TOOLS = new Set([
  "team_create",
  "team_spawn",
  "team_message",
  "team_broadcast",
  "team_check_inbox",
  "team_mark_read",
  "team_create_task",
  "team_claim_task",
  "team_assign_task",
  "team_complete_task",
  "team_list_tasks",
  "team_shutdown",
  "team_cleanup",
  "team_approve_plan",
])

// Tools that sub-agents (non-lead) CAN use
export const SUBAGENT_ALLOWED_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "glob",
  "grep",
  "skill",
  "webfetch",
  "websearch",
  "codesearch",
  "lsp",
  "apply_patch",
  "question",
])

export namespace TeamIsolation {
  export interface IsolationConfig {
    isLead: boolean
    isSubAgent: boolean
    allowedTools: Set<string>
    deniedTools: Set<string>
  }

  export function getToolVisibility(toolId: string, config: IsolationConfig): boolean {
    // Lead agents can use all tools
    if (config.isLead) {
      return true
    }

    // Sub-agents cannot use TEAM_TOOLS
    if (TEAM_TOOLS.has(toolId)) {
      log.debug(`Tool "${toolId}" hidden from sub-agent (TEAM_TOOL)`)
      return false
    }

    // Check explicit deny list
    if (config.deniedTools.has(toolId)) {
      return false
    }

    // Check explicit allow list
    if (config.allowedTools.size > 0 && !config.allowedTools.has(toolId)) {
      return false
    }

    return true
  }

  export function filterTools<T extends { id: string }>(
    tools: T[],
    config: IsolationConfig
  ): T[] {
    return tools.filter((tool) => getToolVisibility(tool.id, config))
  }

  export function validateToolCall(
    toolId: string,
    config: IsolationConfig
  ): { allowed: boolean; reason?: string } {
    if (config.isLead) {
      return { allowed: true }
    }

    if (TEAM_TOOLS.has(toolId)) {
      return {
        allowed: false,
        reason: `Sub-agents cannot use TEAM_TOOLS. Tool "${toolId}" is reserved for team lead.`,
      }
    }

    if (config.deniedTools.has(toolId)) {
      return {
        allowed: false,
        reason: `Tool "${toolId}" is explicitly denied for this agent.`,
      }
    }

    if (config.allowedTools.size > 0 && !config.allowedTools.has(toolId)) {
      return {
        allowed: false,
        reason: `Tool "${toolId}" is not in the allowed tools list for this agent.`,
      }
    }

    return { allowed: true }
  }

  export function createSubAgentIsolation(agentName: string): IsolationConfig {
    return {
      isLead: false,
      isSubAgent: true,
      allowedTools: SUBAGENT_ALLOWED_TOOLS,
      deniedTools: TEAM_TOOLS,
    }
  }

  export function createLeadIsolation(): IsolationConfig {
    return {
      isLead: true,
      isSubAgent: false,
      allowedTools: new Set(), // All tools allowed
      deniedTools: new Set(),
    }
  }

  // Rate limiting for team messages to prevent flooding
  interface RateLimitEntry {
    count: number
    windowStart: number
  }

  const rateLimits = new Map<string, RateLimitEntry>()
  const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute
  const RATE_LIMIT_MAX_MESSAGES = 10 // max 10 messages per minute

  export function checkRateLimit(agentName: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now()
    const key = agentName
    const entry = rateLimits.get(key)

    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      // Start new window
      rateLimits.set(key, {
        count: 1,
        windowStart: now,
      })
      return { allowed: true }
    }

    if (entry.count >= RATE_LIMIT_MAX_MESSAGES) {
      const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)
      log.warn(`Rate limit exceeded for agent "${agentName}"`)
      return { allowed: false, retryAfterMs }
    }

    entry.count++
    return { allowed: true }
  }

  export function resetRateLimit(agentName: string): void {
    rateLimits.delete(agentName)
  }

  // Audit logging for team operations
  export function auditLog(
    operation: string,
    agentName: string,
    teamName: string,
    details?: Record<string, any>
  ): void {
    log.info({
      type: "team_audit",
      operation,
      agent: agentName,
      team: teamName,
      timestamp: Date.now(),
      ...details,
    })
  }
}
