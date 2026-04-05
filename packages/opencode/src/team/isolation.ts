import { Log } from "../util/log"

const log = Log.create({ service: "team.isolation" })

/**
 * Tool visibility configuration for agents
 */
export interface IsolationConfig {
  agentName: string
  role: "lead" | "sub-agent"
  visibleTools: Set<string>
  allowBash: boolean
  allowWrite: boolean
  allowEdit: boolean
}

/**
 * Result of tool call validation
 */
export interface ValidationResult {
  allowed: boolean
  reason?: string
}

/**
 * Result of rate limit check
 */
export interface RateLimitResult {
  allowed: boolean
  retryAfterMs?: number
}

// Rate limit configuration
const RATE_LIMIT_MESSAGES = 10
const RATE_LIMIT_WINDOW_MS = 60 * 1000 // 1 minute

// In-memory rate limit tracking
const rateLimitStore = new Map<string, RateLimitEntry>()

interface RateLimitEntry {
  agentName: string
  messageCount: number
  windowStart: number
}

// Tool categories
const TEAM_TOOLS_LEAD_ONLY = ["team_create", "team_shutdown", "team_cleanup", "team_assign_task", "team_add_member"]

const TEAM_TOOLS_SHARED = [
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
]

const SUB_AGENT_ALLOWED_TOOLS = new Set([...TEAM_TOOLS_SHARED, "read"])

/**
 * Create isolation config for a team lead (full access)
 */
function createLeadIsolationImpl(agentName: string): IsolationConfig {
  const allTools = new Set([
    ...TEAM_TOOLS_LEAD_ONLY,
    ...TEAM_TOOLS_SHARED,
    "bash",
    "read",
    "write",
    "edit",
    "rg",
    "glob",
  ])

  return {
    agentName,
    role: "lead",
    visibleTools: allTools,
    allowBash: true,
    allowWrite: true,
    allowEdit: true,
  }
}

/**
 * Create isolation config for a sub-agent (restricted access)
 */
function createSubAgentIsolationImpl(agentName: string): IsolationConfig {
  return {
    agentName,
    role: "sub-agent",
    visibleTools: new Set(SUB_AGENT_ALLOWED_TOOLS),
    allowBash: false,
    allowWrite: false,
    allowEdit: false,
  }
}

/**
 * Check if a tool is visible for the given isolation config
 */
function getToolVisibilityImpl(toolName: string, config: IsolationConfig): boolean {
  return config.visibleTools.has(toolName)
}

/**
 * Validate a tool call against isolation rules
 */
function validateToolCallImpl(toolName: string, config: IsolationConfig): ValidationResult {
  // Check if tool is in visible set
  if (!config.visibleTools.has(toolName)) {
    // Provide specific reason based on tool type
    if (TEAM_TOOLS_LEAD_ONLY.includes(toolName)) {
      return {
        allowed: false,
        reason: `Tool "${toolName}" is restricted to team leads only`,
      }
    }

    if (toolName === "bash") {
      return {
        allowed: false,
        reason: "Bash execution is not allowed for sub-agents",
      }
    }

    if (toolName === "write") {
      return {
        allowed: false,
        reason: "File write operations are not allowed for sub-agents",
      }
    }

    if (toolName === "edit") {
      return {
        allowed: false,
        reason: "File edit operations are not allowed for sub-agents",
      }
    }

    return {
      allowed: false,
      reason: `Tool "${toolName}" is not visible to ${config.role} "${config.agentName}"`,
    }
  }

  return { allowed: true }
}

/**
 * Check rate limit for an agent
 * Returns whether the call is allowed and retry time if rate limited
 */
function checkRateLimitImpl(agentName: string): RateLimitResult {
  const now = Date.now()
  const entry = rateLimitStore.get(agentName)

  if (!entry) {
    // First message from this agent
    rateLimitStore.set(agentName, {
      agentName,
      messageCount: 1,
      windowStart: now,
    })
    return { allowed: true }
  }

  // Check if window has expired
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Reset window
    entry.messageCount = 1
    entry.windowStart = now
    return { allowed: true }
  }

  // Check if under limit
  if (entry.messageCount < RATE_LIMIT_MESSAGES) {
    entry.messageCount++
    return { allowed: true }
  }

  // Rate limit exceeded
  const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart)
  log.warn(`Rate limit exceeded for agent "${agentName}"`, { retryAfterMs })

  return {
    allowed: false,
    retryAfterMs,
  }
}

/**
 * Get current rate limit status for an agent
 * For debugging/monitoring purposes
 */
function getRateLimitStatusImpl(agentName: string): {
  messageCount: number
  maxMessages: number
  windowStart: number | null
  remaining: number
} {
  const entry = rateLimitStore.get(agentName)

  if (!entry) {
    return {
      messageCount: 0,
      maxMessages: RATE_LIMIT_MESSAGES,
      windowStart: null,
      remaining: RATE_LIMIT_MESSAGES,
    }
  }

  const now = Date.now()
  if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    // Window expired, return fresh state
    return {
      messageCount: 0,
      maxMessages: RATE_LIMIT_MESSAGES,
      windowStart: null,
      remaining: RATE_LIMIT_MESSAGES,
    }
  }

  return {
    messageCount: entry.messageCount,
    maxMessages: RATE_LIMIT_MESSAGES,
    windowStart: entry.windowStart,
    remaining: Math.max(0, RATE_LIMIT_MESSAGES - entry.messageCount),
  }
}

/**
 * Clear rate limit data for an agent
 * Called when agent shuts down
 */
function clearRateLimitImpl(agentName: string): void {
  rateLimitStore.delete(agentName)
  log.debug(`Cleared rate limit data for "${agentName}"`)
}

/**
 * Get all team tools that require lead permissions
 */
function getLeadOnlyToolsImpl(): string[] {
  return [...TEAM_TOOLS_LEAD_ONLY]
}

/**
 * Get all team tools available to sub-agents
 */
function getSubAgentToolsImpl(): string[] {
  return [...TEAM_TOOLS_SHARED, "read"]
}

// Namespace export for consistency with other team modules
export namespace TeamIsolation {
  export const createLeadIsolation = createLeadIsolationImpl
  export const createSubAgentIsolation = createSubAgentIsolationImpl
  export const getToolVisibility = getToolVisibilityImpl
  export const validateToolCall = validateToolCallImpl
  export const checkRateLimit = checkRateLimitImpl
  export const getRateLimitStatus = getRateLimitStatusImpl
  export const clearRateLimit = clearRateLimitImpl
  export const getLeadOnlyTools = getLeadOnlyToolsImpl
  export const getSubAgentTools = getSubAgentToolsImpl
}

// Also export individual functions for direct use
export {
  createLeadIsolationImpl as createLeadIsolation,
  createSubAgentIsolationImpl as createSubAgentIsolation,
  getToolVisibilityImpl as getToolVisibility,
  validateToolCallImpl as validateToolCall,
  checkRateLimitImpl as checkRateLimit,
  getRateLimitStatusImpl as getRateLimitStatus,
  clearRateLimitImpl as clearRateLimit,
  getLeadOnlyToolsImpl as getLeadOnlyTools,
  getSubAgentToolsImpl as getSubAgentTools,
}
