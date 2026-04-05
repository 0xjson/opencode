// Circuit Breaker Pattern for Agent Failure Resilience
// Prevents cascading failures by temporarily stopping task assignments to failing agents

import { Log } from "../util/log"
import { emit, EventBus } from "./eventBus"

const log = Log.create({ service: "team.circuit-breaker" })

export namespace CircuitBreaker {
  export enum CircuitState {
    CLOSED = 'closed',       // Normal operation
    OPEN = 'open',           // Failing, no new tasks
    HALF_OPEN = 'half_open', // Testing if recovered
  }

  export interface CircuitBreakerConfig {
    failureThreshold: number;      // Failure rate to trigger open (default: 0.5)
    minFailures: number;           // Min failures before considering open (default: 3)
    cooldownDuration: number;      // Ms before half-open (default: 60000)
    halfOpenMaxTasks: number;      // Max tasks in half-open (default: 1)
    successThreshold: number;      // Successes to close circuit (default: 2)
  }

  export const DEFAULT_CONFIG: CircuitBreakerConfig = {
    failureThreshold: 0.5,
    minFailures: 3,
    cooldownDuration: 60000,  // 60 seconds
    halfOpenMaxTasks: 1,
    successThreshold: 2,
  }

  export interface CircuitBreakerState {
    agentName: string
    teamName: string
    state: CircuitState
    failureCount: number
    successCount: number
    lastFailureTime: number | null
    circuitOpenedAt: number | null
    totalTasks: number
    consecutiveSuccesses: number
  }

  // Circuit breaker manager per agent
  class AgentCircuitBreaker {
    private state: CircuitBreakerState
    private config: CircuitBreakerConfig

    constructor(agentName: string, teamName: string, config?: Partial<CircuitBreakerConfig>) {
      this.config = { ...DEFAULT_CONFIG, ...config }
      this.state = {
        agentName,
        teamName,
        state: CircuitState.CLOSED,
        failureCount: 0,
        successCount: 0,
        lastFailureTime: null,
        circuitOpenedAt: null,
        totalTasks: 0,
        consecutiveSuccesses: 0,
      }
    }

    // Check if task can be assigned to this agent
    canAssignTask(): boolean {
      this.updateState()

      switch (this.state.state) {
        case CircuitState.CLOSED:
          return true
        case CircuitState.OPEN:
          return false
        case CircuitState.HALF_OPEN:
          // In half-open, only allow limited tasks
          return this.state.totalTasks < this.config.halfOpenMaxTasks
        default:
          return false
      }
    }

    // Record task success
    recordSuccess(): void {
      this.state.totalTasks++
      this.state.successCount++
      this.state.consecutiveSuccesses++

      if (this.state.state === CircuitState.HALF_OPEN) {
        if (this.state.consecutiveSuccesses >= this.config.successThreshold) {
          this.transitionToClosed()
        }
      }

      // Reset failure count on success (in closed state)
      if (this.state.state === CircuitState.CLOSED) {
        this.state.failureCount = 0
      }
    }

    // Record task failure
    recordFailure(): void {
      this.state.totalTasks++
      this.state.failureCount++
      this.state.consecutiveSuccesses = 0
      this.state.lastFailureTime = Date.now()

      const failureRate = this.state.failureCount / this.state.totalTasks

      // Transition to open if:
      // 1. Failure rate exceeds threshold AND
      // 2. Min failures reached
      if (this.state.state === CircuitState.CLOSED) {
        if (failureRate >= this.config.failureThreshold &&
            this.state.failureCount >= this.config.minFailures) {
          this.transitionToOpen()
        }
      } else if (this.state.state === CircuitState.HALF_OPEN) {
        // Any failure in half-open goes back to open
        this.transitionToOpen()
      }
    }

    private transitionToOpen(): void {
      this.state.state = CircuitState.OPEN
      this.state.circuitOpenedAt = Date.now()

      const failureRate = this.state.totalTasks > 0
        ? (this.state.failureCount / this.state.totalTasks * 100).toFixed(1)
        : '0.0'

      log.warn(
        `Circuit breaker opened for agent "${this.state.agentName}" in team "${this.state.teamName}"` +
        ` (${this.state.failureCount} failures, ${failureRate}% failure rate)`
      )

      // Emit circuit opened event
      emit("circuit_opened", this.state.teamName, {
        agentName: this.state.agentName,
        failureCount: this.state.failureCount,
        failureRate: parseFloat(failureRate),
        timestamp: Date.now(),
      }).catch((err) => {
        log.error(`Failed to emit circuit_opened event: ${err}`)
      })
    }

    private transitionToClosed(): void {
      this.state.state = CircuitState.CLOSED
      this.state.failureCount = 0
      this.state.consecutiveSuccesses = 0
      this.state.circuitOpenedAt = null

      log.info(
        `Circuit breaker closed for agent "${this.state.agentName}" in team "${this.state.teamName}"`
      )

      // Emit circuit closed event
      emit("circuit_closed", this.state.teamName, {
        agentName: this.state.agentName,
        timestamp: Date.now(),
      }).catch((err) => {
        log.error(`Failed to emit circuit_closed event: ${err}`)
      })
    }

    private updateState(): void {
      // Check if should transition from OPEN to HALF_OPEN
      if (this.state.state === CircuitState.OPEN && this.state.circuitOpenedAt) {
        const timeSinceOpen = Date.now() - this.state.circuitOpenedAt
        if (timeSinceOpen >= this.config.cooldownDuration) {
          this.state.state = CircuitState.HALF_OPEN
          this.state.totalTasks = 0  // Reset task count for half-open test
          this.state.consecutiveSuccesses = 0

          log.info(
            `Circuit breaker half-opened for agent "${this.state.agentName}" in team "${this.state.teamName}"`
          )

          // Emit circuit half-opened event
          emit("circuit_half_opened", this.state.teamName, {
            agentName: this.state.agentName,
            cooldownDuration: this.config.cooldownDuration,
            timestamp: Date.now(),
          }).catch((err) => {
            log.error(`Failed to emit circuit_half_opened event: ${err}`)
          })
        }
      }
    }

    getState(): CircuitBreakerState {
      this.updateState()
      return { ...this.state }
    }

    // Restore state from persisted data
    restoreState(savedState: Partial<CircuitBreakerState>): void {
      this.state = {
        ...this.state,
        ...savedState,
        // Ensure state is valid
        state: savedState.state || CircuitState.CLOSED,
      }
      // After restoring, check if we need to transition
      this.updateState()
    }
  }

  // Circuit breaker registry per team
  const circuitBreakers = new Map<string, Map<string, AgentCircuitBreaker>>()

  // Get or create circuit breaker for agent
  export function getCircuitBreaker(
    teamName: string,
    agentName: string,
    config?: Partial<CircuitBreakerConfig>
  ): AgentCircuitBreaker {
    if (!circuitBreakers.has(teamName)) {
      circuitBreakers.set(teamName, new Map())
    }

    const teamBreakers = circuitBreakers.get(teamName)!

    if (!teamBreakers.has(agentName)) {
      teamBreakers.set(agentName, new AgentCircuitBreaker(agentName, teamName, config))
    }

    return teamBreakers.get(agentName)!
  }

  // Check if agent can accept tasks
  export function canAgentAcceptTasks(
    teamName: string,
    agentName: string,
    config?: Partial<CircuitBreakerConfig>
  ): boolean {
    const cb = getCircuitBreaker(teamName, agentName, config)
    return cb.canAssignTask()
  }

  // Record task outcome
  export function recordTaskOutcome(
    teamName: string,
    agentName: string,
    success: boolean,
    config?: Partial<CircuitBreakerConfig>
  ): void {
    const cb = getCircuitBreaker(teamName, agentName, config)

    if (success) {
      cb.recordSuccess()
    } else {
      cb.recordFailure()
    }
  }

  // Get circuit breaker state
  export function getCircuitState(
    teamName: string,
    agentName: string
  ): CircuitBreakerState | null {
    const teamBreakers = circuitBreakers.get(teamName)
    if (!teamBreakers) return null

    const cb = teamBreakers.get(agentName)
    return cb ? cb.getState() : null
  }

  // Get all circuit breaker states for team
  export function getAllCircuitStates(
    teamName: string
  ): CircuitBreakerState[] {
    const teamBreakers = circuitBreakers.get(teamName)
    if (!teamBreakers) return []

    return Array.from(teamBreakers.values()).map(cb => cb.getState())
  }

  // Manual reset (for admin/debugging)
  export function resetCircuitBreaker(
    teamName: string,
    agentName: string
  ): void {
    const teamBreakers = circuitBreakers.get(teamName)
    if (teamBreakers) {
      teamBreakers.delete(agentName)
    }
  }

  // Reset all circuit breakers for team
  export function resetAllCircuitBreakers(teamName: string): void {
    circuitBreakers.delete(teamName)
  }

  // Restore circuit breaker state from persisted data
  export function restoreCircuitState(
    teamName: string,
    agentName: string,
    savedState: Partial<CircuitBreakerState>,
    config?: Partial<CircuitBreakerConfig>
  ): void {
    const cb = getCircuitBreaker(teamName, agentName, config)
    cb.restoreState(savedState)
  }

  // Get agents with open circuits
  export function getOpenCircuitAgents(teamName: string): string[] {
    const teamBreakers = circuitBreakers.get(teamName)
    if (!teamBreakers) return []

    return Array.from(teamBreakers.entries())
      .filter(([, cb]) => cb.getState().state === CircuitState.OPEN)
      .map(([agentName]) => agentName)
  }

  // Get agents with half-open circuits
  export function getHalfOpenCircuitAgents(teamName: string): string[] {
    const teamBreakers = circuitBreakers.get(teamName)
    if (!teamBreakers) return []

    return Array.from(teamBreakers.entries())
      .filter(([, cb]) => cb.getState().state === CircuitState.HALF_OPEN)
      .map(([agentName]) => agentName)
  }
}
