// Event Bus for event-driven task orchestration
import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "team.eventBus" })

// ============================================================================
// Event Types
// ============================================================================

export type EventType =
  | "task_created"
  | "task_completed"
  | "task_failed"
  | "agent_available"
  | "task_claimed"
  | "task_assigned"
  | "bid_received"
  | "bid_awarded"
  | "bid_cancelled"
  | "circuit_opened"
  | "circuit_closed"
  | "circuit_half_opened"

export interface EventPayload {
  task_created: {
    taskId: string
    description: string
    taskType: string
    priority: Team.TaskPriority
    dependsOn: string[]
  }
  task_completed: {
    taskId: string
    agentName: string
    completionTime: number
    taskType: string
  }
  task_failed: {
    taskId: string
    agentName: string
    reason?: string
    attempt: number
  }
  agent_available: {
    agentName: string
    capabilities: string[]
    currentLoad: number
  }
  task_claimed: {
    taskId: string
    agentName: string
    claimedAt: number
  }
  task_assigned: {
    taskId: string
    agentName: string
    assignmentMethod: "auto" | "manual" | "bid"
    score?: number
  }
  bid_received: {
    taskId: string
    agentName: string
    confidence: number
    reliability: number
    urgency: number
    eta: number
    score: number
    rank: number
    totalBids: number
  }
  bid_awarded: {
    taskId: string
    agentName: string
    confidence: number
    eta: number
    totalBidders: number
    score: number
  }
  bid_cancelled: {
    taskId: string
    reason: string
    bidsCount: number
  }
  circuit_opened: {
    agentName: string
    failureCount: number
    failureRate: number
    timestamp: number
  }
  circuit_closed: {
    agentName: string
    timestamp: number
  }
  circuit_half_opened: {
    agentName: string
    cooldownDuration: number
    timestamp: number
  }
}

export interface Event<T extends EventType = EventType> {
  id: string
  type: T
  teamName: string
  timestamp: number
  payload: EventPayload[T]
  retries: number
}

export interface DeadLetterEvent<T extends EventType = EventType> extends Event<T> {
  failedAt: number
  lastError: string
  handlerName?: string
}

// ============================================================================
// Event Handler Types
// ============================================================================

export type EventHandler<T extends EventType = EventType> = (
  event: Event<T>
) => Promise<void> | void

interface HandlerRegistration<T extends EventType = EventType> {
  id: string
  handler: EventHandler<T>
  name: string
}

// ============================================================================
// Retry Configuration
// ============================================================================

const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
}

function calculateBackoff(attempt: number): number {
  const delay = RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt)
  return Math.min(delay, RETRY_CONFIG.maxDelayMs)
}

// ============================================================================
// EventBus Implementation
// ============================================================================

export class EventBus {
  private handlers: Map<EventType, Map<string, HandlerRegistration>> = new Map()
  private deadLetterQueue: Map<string, DeadLetterEvent[]> = new Map()
  private processing: Set<string> = new Set()

  constructor() {
    // Initialize handler maps for all event types
    const eventTypes: EventType[] = [
      "task_created",
      "task_completed",
      "task_failed",
      "agent_available",
      "task_claimed",
      "task_assigned",
      "bid_received",
      "bid_awarded",
      "bid_cancelled",
      "circuit_opened",
      "circuit_closed",
      "circuit_half_opened",
    ]
    for (const type of eventTypes) {
      this.handlers.set(type, new Map())
    }
  }

  // ============================================================================
  // Subscription Management
  // ============================================================================

  /**
   * Subscribe to an event type
   * @param eventType The type of event to subscribe to
   * @param handler The handler function to call when the event is emitted
   * @param options Optional configuration including handler name for debugging
   * @returns A function to unsubscribe
   */
  subscribe<T extends EventType>(
    eventType: T,
    handler: EventHandler<T>,
    options: { name?: string } = {}
  ): () => void {
    const handlerId = ulid()
    const handlers = this.handlers.get(eventType)!

    handlers.set(handlerId, {
      id: handlerId,
      handler: handler as EventHandler,
      name: options.name || `handler-${handlerId.slice(-6)}`,
    })

    log.debug(`Subscribed handler "${options.name || handlerId}" to "${eventType}"`)

    // Return unsubscribe function
    return () => {
      this.unsubscribe(eventType, handlerId)
    }
  }

  /**
   * Unsubscribe a specific handler by ID
   */
  unsubscribe(eventType: EventType, handlerId: string): void {
    const handlers = this.handlers.get(eventType)
    if (handlers) {
      const reg = handlers.get(handlerId)
      if (reg) {
        handlers.delete(handlerId)
        log.debug(`Unsubscribed handler "${reg.name}" from "${eventType}"`)
      }
    }
  }

  /**
   * Unsubscribe all handlers for an event type
   */
  unsubscribeAll(eventType?: EventType): void {
    if (eventType) {
      const handlers = this.handlers.get(eventType)
      if (handlers) {
        log.debug(`Unsubscribed ${handlers.size} handlers from "${eventType}"`)
        handlers.clear()
      }
    } else {
      // Clear all handlers
      for (const [type, handlers] of this.handlers) {
        log.debug(`Unsubscribed ${handlers.size} handlers from "${type}"`)
        handlers.clear()
      }
    }
  }

  // ============================================================================
  // Event Emission
  // ============================================================================

  /**
   * Emit an event to all subscribed handlers
   * @param eventType The type of event to emit
   * @param teamName The team context for the event
   * @param payload The event payload
   */
  async emit<T extends EventType>(
    eventType: T,
    teamName: string,
    payload: EventPayload[T]
  ): Promise<void> {
    const event: Event<T> = {
      id: ulid(),
      type: eventType,
      teamName,
      timestamp: Date.now(),
      payload,
      retries: 0,
    }

    log.debug(`Emitting "${eventType}" event (id: ${event.id}) to team "${teamName}"`)

    // Process event asynchronously to not block the emitter
    this.processEvent(event).catch((error) => {
      log.error(`Error processing event "${eventType}": ${error}`)
    })
  }

  /**
   * Process an event with retry logic
   */
  private async processEvent<T extends EventType>(event: Event<T>): Promise<void> {
    const handlers = this.handlers.get(event.type)
    if (!handlers || handlers.size === 0) {
      log.debug(`No handlers registered for "${event.type}", event dropped`)
      return
    }

    // Track processing to prevent duplicate processing
    if (this.processing.has(event.id)) {
      return
    }
    this.processing.add(event.id)

    try {
      // Execute all handlers concurrently
      const handlerPromises = Array.from(handlers.values()).map(async (registration) => {
        try {
          await this.executeHandlerWithRetry(event, registration)
        } catch (error) {
          // Handler failed after all retries - add to dead letter queue
          await this.addToDeadLetterQueue(event, registration, error as Error)
        }
      })

      await Promise.all(handlerPromises)
    } finally {
      this.processing.delete(event.id)
    }
  }

  /**
   * Execute a handler with retry logic
   */
  private async executeHandlerWithRetry<T extends EventType>(
    event: Event<T>,
    registration: HandlerRegistration
  ): Promise<void> {
    let lastError: Error | undefined

    for (let attempt = 0; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
      try {
        await registration.handler(event)
        // Handler succeeded
        if (attempt > 0) {
          log.debug(
            `Handler "${registration.name}" succeeded for "${event.type}" after ${attempt} retries`
          )
        }
        return
      } catch (error) {
        lastError = error as Error

        if (attempt < RETRY_CONFIG.maxRetries) {
          // Calculate backoff and wait
          const delay = calculateBackoff(attempt)
          log.debug(
            `Handler "${registration.name}" failed for "${event.type}" (attempt ${attempt + 1}/${RETRY_CONFIG.maxRetries + 1}), retrying in ${delay}ms: ${lastError.message}`
          )
          await this.sleep(delay)
        }
      }
    }

    // All retries exhausted
    throw lastError || new Error(`Handler failed after ${RETRY_CONFIG.maxRetries} retries`)
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  // ============================================================================
  // Dead Letter Queue
  // ============================================================================

  /**
   * Add a failed event to the dead letter queue
   */
  private async addToDeadLetterQueue<T extends EventType>(
    event: Event<T>,
    registration: HandlerRegistration,
    error: Error
  ): Promise<void> {
    const deadEvent: DeadLetterEvent<T> = {
      ...event,
      failedAt: Date.now(),
      lastError: error.message,
      handlerName: registration.name,
    }

    // Add to in-memory queue
    const teamQueue = this.deadLetterQueue.get(event.teamName) || []
    teamQueue.push(deadEvent as DeadLetterEvent)
    this.deadLetterQueue.set(event.teamName, teamQueue)

    // Persist to disk
    await this.persistDeadLetterQueue(event.teamName)

    log.warn(
      `Event "${event.type}" (id: ${event.id}) moved to dead letter queue after failing handler "${registration.name}": ${error.message}`
    )
  }

  /**
   * Persist dead letter queue to disk
   */
  private async persistDeadLetterQueue(teamName: string): Promise<void> {
    try {
      const dlqPath = await TeamRegistry.ensureTeamDir(teamName).then((dir) =>
        require("path").join(dir, "dead_letter_queue.json")
      )

      const queue = this.deadLetterQueue.get(teamName) || []
      await Filesystem.writeJson(dlqPath, queue)
    } catch (error) {
      log.error(`Failed to persist dead letter queue for "${teamName}": ${error}`)
    }
  }

  /**
   * Load dead letter queue from disk
   */
  async loadDeadLetterQueue(teamName: string): Promise<DeadLetterEvent[]> {
    try {
      const dlqPath = await TeamRegistry.ensureTeamDir(teamName).then((dir) =>
        require("path").join(dir, "dead_letter_queue.json")
      )

      const exists = await Filesystem.exists(dlqPath)
      if (!exists) return []

      const content = await Filesystem.readJson<DeadLetterEvent[]>(dlqPath)
      const queue = content || []

      // Update in-memory cache
      this.deadLetterQueue.set(teamName, queue)

      return queue
    } catch (error) {
      log.error(`Failed to load dead letter queue for "${teamName}": ${error}`)
      return []
    }
  }

  /**
   * Get dead letter queue for a team (from memory)
   */
  getDeadLetterQueue(teamName: string): DeadLetterEvent[] {
    return this.deadLetterQueue.get(teamName) || []
  }

  /**
   * Clear dead letter queue for a team
   */
  async clearDeadLetterQueue(teamName: string): Promise<void> {
    this.deadLetterQueue.set(teamName, [])

    try {
      const dlqPath = await TeamRegistry.ensureTeamDir(teamName).then((dir) =>
        require("path").join(dir, "dead_letter_queue.json")
      )

      const exists = await Filesystem.exists(dlqPath)
      if (exists) {
        await Filesystem.unlink(dlqPath)
      }
    } catch (error) {
      log.error(`Failed to clear dead letter queue for "${teamName}": ${error}`)
    }
  }

  /**
   * Retry a dead letter event
   */
  async retryDeadLetterEvent(
    teamName: string,
    eventId: string
  ): Promise<{ success: boolean; error?: string }> {
    const queue = this.deadLetterQueue.get(teamName) || []
    const index = queue.findIndex((e) => e.id === eventId)

    if (index === -1) {
      return { success: false, error: `Event "${eventId}" not found in dead letter queue` }
    }

    const event = queue[index]

    // Remove from dead letter queue
    queue.splice(index, 1)
    this.deadLetterQueue.set(teamName, queue)
    await this.persistDeadLetterQueue(teamName)

    // Re-emit the event
    try {
      await this.processEvent(event as Event<EventType>)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  // ============================================================================
  // Utilities
  // ============================================================================

  /**
   * Get handler count for an event type
   */
  getHandlerCount(eventType?: EventType): number {
    if (eventType) {
      const handlers = this.handlers.get(eventType)
      return handlers ? handlers.size : 0
    }

    let total = 0
    for (const handlers of this.handlers.values()) {
      total += handlers.size
    }
    return total
  }

  /**
   * Get all subscribed event types
   */
  getSubscribedEventTypes(): EventType[] {
    const types: EventType[] = []
    for (const [type, handlers] of this.handlers) {
      if (handlers.size > 0) {
        types.push(type)
      }
    }
    return types
  }

  /**
   * Check if there are any handlers for an event type
   */
  hasHandlers(eventType: EventType): boolean {
    const handlers = this.handlers.get(eventType)
    return handlers ? handlers.size > 0 : false
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let globalEventBus: EventBus | null = null

/**
 * Get or create the global EventBus instance
 */
export function getEventBus(): EventBus {
  if (!globalEventBus) {
    globalEventBus = new EventBus()
  }
  return globalEventBus
}

/**
 * Reset the global EventBus instance (useful for testing)
 */
export function resetEventBus(): void {
  if (globalEventBus) {
    globalEventBus.unsubscribeAll()
  }
  globalEventBus = null
}

// ============================================================================
// Convenience Functions
// ============================================================================

/**
 * Subscribe to an event type
 */
export function on<T extends EventType>(
  eventType: T,
  handler: EventHandler<T>,
  options?: { name?: string }
): () => void {
  return getEventBus().subscribe(eventType, handler, options)
}

/**
 * Emit an event
 */
export async function emit<T extends EventType>(
  eventType: T,
  teamName: string,
  payload: EventPayload[T]
): Promise<void> {
  return getEventBus().emit(eventType, teamName, payload)
}

/**
 * Unsubscribe all handlers
 */
export function off(eventType?: EventType): void {
  return getEventBus().unsubscribeAll(eventType)
}
