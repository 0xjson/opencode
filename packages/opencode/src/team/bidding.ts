// Bidding System for Complex Task Assignment
// Enables agents to compete for complex tasks via confidence/eta submissions

import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamInbox } from "./inbox"
import { Log } from "../util/log"
import { getEventBus } from "./eventBus"

// Default ETA in minutes when not provided
const DEFAULT_ETA_MINUTES = 30
// Minimum ETA to avoid division by zero
const MIN_ETA_MINUTES = 1

const log = Log.create({ service: "team.bidding" })

export namespace TeamBidding {
  // Active bidding sessions
  const activeBids = new Map<string, {
    bids: Team.TaskBid[]
    deadline: number
    status: "open" | "closed" | "awarded"
    awardedTo?: string
    task: Team.OrchestratedTask
  }>()

  export interface BiddingOptions {
    // Duration of bidding phase (ms)
    durationMs: number
    // Minimum confidence required to bid
    minConfidence: number
    // Difficulty threshold to trigger bidding
    difficultyThreshold: number
    // Whether to auto-resolve when all agents have bid
    autoResolve: boolean
    // Max number of bids to accept per agent
    maxBidsPerAgent: number
  }

  export const DEFAULT_BIDDING_OPTIONS: BiddingOptions = {
    durationMs: 30000, // 30 seconds
    minConfidence: 0.5,
    difficultyThreshold: 7, // Tasks with difficulty >= 7 trigger bidding
    autoResolve: true,
    maxBidsPerAgent: 3,
  }

  /**
   * Check if a task should use bidding (complex task)
   */
  export function shouldUseBidding(
    task: Team.OrchestratedTask,
    options: Partial<BiddingOptions> = {}
  ): boolean {
    const threshold = options.difficultyThreshold || DEFAULT_BIDDING_OPTIONS.difficultyThreshold
    const difficulty = task.estimatedDifficulty || 5
    return difficulty >= threshold
  }

  /**
   * Start a bidding phase for a task
   */
  export async function startBiddingPhase(
    teamName: string,
    taskId: string,
    options: Partial<BiddingOptions> = {}
  ): Promise<{
    success: boolean
    biddingId?: string
    deadline?: number
    error?: string
  }> {
    const fullOptions = { ...DEFAULT_BIDDING_OPTIONS, ...options }

    // Load task
    const tasks = await TeamRegistry.loadTasks(teamName) as Team.OrchestratedTask[]
    const task = tasks.find((t) => t.id === taskId)

    if (!task) {
      return { success: false, error: `Task "${taskId}" not found` }
    }

    if (task.status !== "pending") {
      return { success: false, error: `Task "${taskId}" is not available (status: ${task.status})` }
    }

    // Check if bidding already active
    if (activeBids.has(taskId)) {
      return { success: false, error: `Bidding already active for task "${taskId}"` }
    }

    // Create bidding session
    const deadline = Date.now() + fullOptions.durationMs
    const biddingSession = {
      bids: [] as Team.TaskBid[],
      deadline,
      status: "open" as const,
      task,
    }

    activeBids.set(taskId, biddingSession)

    // Broadcast to team members
    const team = await TeamRegistry.getTeam(teamName)
    if (team) {
      const taskType = task.taskType || "general"
      const difficulty = task.estimatedDifficulty || 5

      await TeamInbox.broadcastMessage(
        teamName,
        team.lead,
        `🔨 BIDDING OPEN: Task "${taskId}" (${taskType}, difficulty ${difficulty}/10)

${task.description.slice(0, 200)}${task.description.length > 200 ? "..." : ""}

Submit your bid with confidence (0-1) and estimated completion time (minutes).
Bidding closes in ${Math.floor(fullOptions.durationMs / 1000)}s.`,
        true // exclude sender
      )
    }

    // Set timeout for auto-close
    setTimeout(async () => {
      const session = activeBids.get(taskId)
      if (session && session.status === "open" && fullOptions.autoResolve) {
        await resolveBidding(teamName, taskId)
      }
    }, fullOptions.durationMs)

    log.info(`Started bidding phase for task "${taskId}" in team "${teamName}" (deadline: ${deadline})`)

    return {
      success: true,
      biddingId: taskId,
      deadline,
    }
  }

  /**
   * Submit a bid for a task
   *
   * Phase 5 Enhancements:
   * - Validates confidence (discard if <0 or >1)
   * - Defaults ETA to 30 minutes if missing
   * - Loads reliability from AgentStats
   * - Stores scoring breakdown with bid
   * - Logs rejected bids with reason
   */
  export async function submitBid(
    teamName: string,
    taskId: string,
    agentName: string,
    bidData: {
      confidence: number
      estimatedCompletionTime?: number // minutes (optional, defaults to 30)
      reasoning?: string
    },
    options: Partial<BiddingOptions> = {}
  ): Promise<{
    success: boolean
    bid?: Team.TaskBid
    rank?: number
    error?: string
  }> {
    const fullOptions = { ...DEFAULT_BIDDING_OPTIONS, ...options }

    // Phase 5: Validate confidence - discard bid if invalid
    if (bidData.confidence < 0 || bidData.confidence > 1) {
      log.warn(`Bid REJECTED from "${agentName}" for task "${taskId}": confidence ${bidData.confidence} is outside valid range [0-1]`)
      return {
        success: false,
        error: `Confidence must be between 0 and 1 (received: ${bidData.confidence})`,
      }
    }

    // Validate min confidence
    if (bidData.confidence < fullOptions.minConfidence) {
      log.warn(`Bid REJECTED from "${agentName}" for task "${taskId}": confidence ${bidData.confidence} below minimum ${fullOptions.minConfidence}`)
      return {
        success: false,
        error: `Confidence must be at least ${fullOptions.minConfidence}`,
      }
    }

    // Check bidding session
    const session = activeBids.get(taskId)
    if (!session) {
      return { success: false, error: `No active bidding for task "${taskId}"` }
    }

    // Check deadline
    if (Date.now() > session.deadline) {
      return { success: false, error: "Bidding phase has closed" }
    }

    // Check if already bid by this agent
    const existingBids = session.bids.filter((b) => b.agentName === agentName)
    if (existingBids.length >= fullOptions.maxBidsPerAgent) {
      return { success: false, error: `Maximum ${fullOptions.maxBidsPerAgent} bids per agent` }
    }

    // Phase 5: Default ETA to 30 minutes if not provided or invalid
    let etaMinutes = bidData.estimatedCompletionTime
    if (etaMinutes === undefined || etaMinutes === null || isNaN(etaMinutes) || etaMinutes <= 0) {
      log.warn(`ETA not provided or invalid for bid from "${agentName}" on task "${taskId}", defaulting to ${DEFAULT_ETA_MINUTES} minutes`)
      etaMinutes = DEFAULT_ETA_MINUTES
    }

    // Phase 5: Load agent reliability from AgentStats
    const agentStats = await TeamRegistry.getAgentStat(teamName, agentName)
    const reliability = agentStats?.reliabilityScore ?? 0.5

    // Phase 5: Get task priority for urgency calculation
    const taskPriority = session.task.priority || "normal"

    // Create bid with scoring components
    const bid: Team.TaskBid = {
      agentName,
      taskId,
      confidence: bidData.confidence,
      estimatedCompletionTime: etaMinutes,
      bidAt: Date.now(),
      reliability,
      urgency: calculateUrgency(taskPriority),
    }

    // Phase 5: Calculate score with breakdown
    const { score, breakdown } = calculateBidScore(bid, agentStats, taskPriority)
    bid.scoringBreakdown = breakdown

    // Add to session
    session.bids.push(bid)

    // Phase 5: Calculate rank using new scoring formula
    const rankedBids = [...session.bids]
      .map((b) => ({
        bid: b,
        score: b.scoringBreakdown?.finalScore ?? calculateBidScore(b, null, taskPriority).score,
      }))
      .sort((a, b) => b.score - a.score)

    const rank = rankedBids.findIndex((r) => r.bid.agentName === agentName && r.bid.bidAt === bid.bidAt) + 1

    log.info(
      `Bid submitted by "${agentName}" for task "${taskId}" ` +
      `(confidence: ${bidData.confidence.toFixed(2)}, reliability: ${reliability.toFixed(2)}, ETA: ${etaMinutes}m, score: ${score.toFixed(2)}, rank: ${rank})`
    )

    // Notify lead with enhanced scoring info
    const team = await TeamRegistry.getTeam(teamName)
    if (team) {
      await TeamInbox.sendMessage(
        teamName,
        team.lead,
        "system",
        JSON.stringify({
          type: "bid_received",
          taskId,
          agentName,
          confidence: bidData.confidence,
          reliability,
          urgency: bid.urgency,
          eta: etaMinutes,
          score,
          rank,
          totalBids: session.bids.length,
          scoringBreakdown: breakdown,
        }),
        "system"
      )
    }

    // Emit bid_received event
    const eventBus = getEventBus()
    await eventBus.emit("bid_received", teamName, {
      taskId,
      agentName,
      confidence: bidData.confidence,
      reliability,
      urgency: bid.urgency,
      eta: etaMinutes,
      score,
      rank,
      totalBids: session.bids.length,
    })

    return { success: true, bid, rank }
  }

  /**
   * Calculate urgency multiplier from task priority (higher = more urgent)
   */
  function calculateUrgency(priority: Team.TaskPriority): number {
    switch (priority) {
      case "critical":
        return 1.5
      case "high":
        return 1.2
      case "normal":
        return 1.0
      case "low":
        return 0.8
      default:
        return 1.0
    }
  }

  /**
   * Calculate bid score using the Phase 5 formula (higher is better)
   * NEW Formula: confidence * reliability * (1 / ETA)
   *
   * Components:
   * - confidence: agent's self-reported confidence (0-1)
   * - reliability: agent's historical reliability from AgentStats (0-1)
   * - urgency: task priority multiplier (0.8-1.5)
   * - ETA: estimated completion time in minutes
   */
  function calculateBidScore(
    bid: Team.TaskBid,
    agentStats?: Team.AgentStats | null,
    taskPriority: Team.TaskPriority = "normal"
  ): {
    score: number
    breakdown: NonNullable<Team.TaskBid["scoringBreakdown"]>
  } {
    // Get reliability from agent stats or default to 0.5
    const reliability = agentStats?.reliabilityScore ?? 0.5

    // Calculate urgency from task priority
    const urgency = calculateUrgency(taskPriority)

    // Ensure ETA is at minimum 1 minute to avoid division by zero
    const etaMinutes = Math.max(bid.estimatedCompletionTime, MIN_ETA_MINUTES)

    // Calculate raw score using new formula: confidence * reliability * (1 / ETA)
    const rawScore = bid.confidence * reliability * (1 / etaMinutes)

    // Normalize score: multiply by urgency and scale to reasonable range
    // Multiply by 100 to get a readable score (e.g., 0.05 becomes 5)
    const finalScore = rawScore * urgency * 100

    const breakdown = {
      confidence: bid.confidence,
      reliability,
      urgency,
      eta: etaMinutes,
      rawScore,
      finalScore,
    }

    return { score: finalScore, breakdown }
  }

  /**
   * Get current bidding status
   */
  export async function getBiddingStatus(
    teamName: string,
    taskId: string
  ): Promise<{
    active: boolean
    status?: "open" | "closed" | "awarded"
    deadline?: number
    timeRemainingMs?: number
    bids?: Team.TaskBid[]
    rankedBids?: Array<Team.TaskBid & { score: number; rank: number }>
    awardedTo?: string
    error?: string
  }> {
    const session = activeBids.get(taskId)

    if (!session) {
      // Check if task exists
      const tasks = await TeamRegistry.loadTasks(teamName) as Team.OrchestratedTask[]
      const task = tasks.find((t) => t.id === taskId)
      if (!task) {
        return { active: false, error: `Task "${taskId}" not found` }
      }
      return { active: false }
    }

    const timeRemainingMs = Math.max(0, session.deadline - Date.now())

    // Calculate rankings
    const rankedBids = session.bids
      .map((bid) => {
        const { score } = calculateBidScore(bid)
        return { ...bid, score }
      })
      .sort((a, b) => {
        // Primary sort by score (descending)
        if (b.score !== a.score) return b.score - a.score
        // Tie-breaker: higher confidence wins
        if (b.confidence !== a.confidence) return b.confidence - a.confidence
        // Second tie-breaker: lower ETA wins
        return a.estimatedCompletionTime - b.estimatedCompletionTime
      })
      .map((bid, index) => ({ ...bid, rank: index + 1 }))

    return {
      active: session.status === "open",
      status: session.status,
      deadline: session.deadline,
      timeRemainingMs,
      bids: session.bids,
      rankedBids,
      awardedTo: session.awardedTo,
    }
  }

  /**
   * Resolve bidding and assign task to winner
   */
  export async function resolveBidding(
    teamName: string,
    taskId: string,
    options: {
      manualWinner?: string
      requireLead?: boolean
    } = {}
  ): Promise<{
    success: boolean
    winner?: string
    bid?: Team.TaskBid
    allBids?: Team.TaskBid[]
    error?: string
  }> {
    const session = activeBids.get(taskId)

    if (!session) {
      return { success: false, error: `No bidding session for task "${taskId}"` }
    }

    if (session.status === "awarded") {
      return { success: false, error: `Task "${taskId}" already awarded to "${session.awardedTo}"` }
    }

    // Close bidding
    session.status = "closed"

    if (session.bids.length === 0) {
      activeBids.delete(taskId)
      return { success: false, error: "No bids received - task remains unassigned" }
    }

    // Determine winner
    let winner: Team.TaskBid | undefined

    if (options.manualWinner) {
      // Manual assignment by lead
      winner = session.bids.find((b) => b.agentName === options.manualWinner)
      if (!winner) {
        session.status = "open"
        return { success: false, error: `Specified winner "${options.manualWinner}" did not bid` }
      }
    } else {
      // Auto-select by score with tie-breaking
      winner = session.bids
        .map((bid) => ({ bid, scoreData: calculateBidScore(bid) }))
        .sort((a, b) => {
          const scoreDiff = b.scoreData.score - a.scoreData.score
          if (scoreDiff !== 0) return scoreDiff
          // Tie-breaker: higher confidence wins
          const confDiff = b.bid.confidence - a.bid.confidence
          if (confDiff !== 0) return confDiff
          // Second tie-breaker: lower ETA wins
          return a.bid.estimatedCompletionTime - b.bid.estimatedCompletionTime
        })[0]?.bid
    }

    if (!winner) {
      session.status = "open"
      return { success: false, error: "Could not determine winner" }
    }

    // Mark as awarded
    session.awardedTo = winner.agentName
    session.status = "awarded"

    // Claim task for winner
    const { TeamTasks } = await import("./tasks")
    const claimResult = await TeamTasks.claimTask(teamName, taskId, winner.agentName)

    if (!claimResult.success) {
      session.status = "closed"
      return {
        success: false,
        error: `Failed to assign task: ${claimResult.error}`,
        allBids: session.bids,
      }
    }

    // Notify winner
    await TeamInbox.sendMessage(
      teamName,
      winner.agentName,
      "system",
      JSON.stringify({
        type: "bid_won",
        taskId,
        confidence: winner.confidence,
        eta: winner.estimatedCompletionTime,
        totalBidders: session.bids.length,
      }),
      "system"
    )

    // Notify others
    const team = await TeamRegistry.getTeam(teamName)
    if (team) {
      const losers = session.bids
        .filter((b) => b.agentName !== winner!.agentName)
        .map((b) => b.agentName)

      for (const loser of losers) {
        await TeamInbox.sendMessage(
          teamName,
          loser,
          "system",
          JSON.stringify({
            type: "bid_lost",
            taskId,
            winner: winner.agentName,
            yourConfidence: session.bids.find((b) => b.agentName === loser)?.confidence,
            winnerConfidence: winner.confidence,
          }),
          "system"
        )
      }
    }

    log.info(`Task "${taskId}" awarded to "${winner.agentName}" with confidence ${winner.confidence.toFixed(2)}`)

    // Emit bid_awarded event
    const eventBus = getEventBus()
    const scoreData = calculateBidScore(winner)
    await eventBus.emit("bid_awarded", teamName, {
      taskId,
      agentName: winner.agentName,
      confidence: winner.confidence,
      eta: winner.estimatedCompletionTime,
      totalBidders: session.bids.length,
      score: scoreData.score,
    })

    // Keep session for a while then clean up
    setTimeout(() => {
      activeBids.delete(taskId)
    }, 300000) // 5 minutes

    return {
      success: true,
      winner: winner.agentName,
      bid: winner,
      allBids: session.bids,
    }
  }

  /**
   * Cancel bidding for a task
   */
  export async function cancelBidding(
    teamName: string,
    taskId: string
  ): Promise<{
    success: boolean
    bids?: Team.TaskBid[]
    error?: string
  }> {
    const session = activeBids.get(taskId)

    if (!session) {
      return { success: false, error: `No active bidding for task "${taskId}"` }
    }

    if (session.status === "awarded") {
      return { success: false, error: `Task "${taskId}" already awarded` }
    }

    const bids = session.bids
    activeBids.delete(taskId)

    // Notify bidders
    const team = await TeamRegistry.getTeam(teamName)
    if (team) {
      for (const bid of bids) {
        await TeamInbox.sendMessage(
          teamName,
          bid.agentName,
          "system",
          JSON.stringify({
            type: "bid_cancelled",
            taskId,
            reason: "Bidding was cancelled by lead",
          }),
          "system"
        )
      }
    }

    log.info(`Bidding cancelled for task "${taskId}" (${bids.length} bids discarded)`)

    // Emit bid_cancelled event
    const eventBus = getEventBus()
    await eventBus.emit("bid_cancelled", teamName, {
      taskId,
      reason: "Bidding was cancelled by lead",
      bidsCount: bids.length,
    })

    return { success: true, bids }
  }

  /**
   * Get all active bidding sessions for a team
   */
  export async function getActiveBiddings(teamName: string): Promise<{
    taskId: string
    deadline: number
    bidCount: number
    status: "open" | "closed" | "awarded"
  }[]> {
    const result: { taskId: string; deadline: number; bidCount: number; status: "open" | "closed" | "awarded" }[] = []

    for (const [taskId, session] of activeBids) {
      result.push({
        taskId,
        deadline: session.deadline,
        bidCount: session.bids.length,
        status: session.status,
      })
    }

    return result.sort((a, b) => a.deadline - b.deadline)
  }

  /**
   * Clean up expired bidding sessions
   */
  export function cleanupExpiredBiddings(maxAgeMs: number = 3600000): number {
    const now = Date.now()
    let cleaned = 0

    for (const [taskId, session] of activeBids) {
      if (session.status === "awarded" && now - session.deadline > maxAgeMs) {
        activeBids.delete(taskId)
        cleaned++
      }
    }

    if (cleaned > 0) {
      log.info(`Cleaned up ${cleaned} expired bidding sessions`)
    }

    return cleaned
  }
}
