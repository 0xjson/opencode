// Scoring Engine for Agent-Task Matching
// Implements composite scoring function with multiple weighted components
// Phase 4: Adaptive Scoring with Reinforcement Learning
// Phase 8: Memory Optimization with LRU Cache

import { Team } from "./schema"
import { EmbeddingService } from "./embedding"
import { TeamRegistry } from "./registry"
import { Log } from "../util/log"
import { VectorIndex } from "./vectorIndex"

const log = Log.create({ service: "team.scoring" })

// ============================================================================
// Phase 8: Memory Optimization - LRU Cache for Embeddings
// ============================================================================

interface CacheEntry<T> {
  value: T
  timestamp: number
  accessCount: number
}

/**
 * LRU Cache with TTL for embeddings
 * - Max 1000 items
 * - 1 hour TTL
 * - Automatic eviction under memory pressure
 */
class EmbeddingCache {
  private cache = new Map<string, CacheEntry<number[]>>()
  private readonly maxSize = 1000
  private readonly ttlMs = 60 * 60 * 1000 // 1 hour
  private hits = 0
  private misses = 0
  private evictions = 0

  get(key: string): number[] | undefined {
    const entry = this.cache.get(key)
    if (!entry) {
      this.misses++
      return undefined
    }

    // Check TTL
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key)
      this.misses++
      return undefined
    }

    // Update access metadata
    entry.accessCount++
    entry.timestamp = Date.now()
    this.hits++
    return entry.value
  }

  set(key: string, value: number[]): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize) {
      this.evictLRU()
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      accessCount: 1,
    })
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear()
    log.debug("Embedding cache cleared")
  }

  /**
   * Clear cache if memory pressure detected (heap usage > 80%)
   */
  checkMemoryPressure(): boolean {
    if (typeof process !== "undefined" && process.memoryUsage) {
      const usage = process.memoryUsage()
      const heapUsedMB = usage.heapUsed / 1024 / 1024
      const heapTotalMB = usage.heapTotal / 1024 / 1024
      const usageRatio = heapUsedMB / heapTotalMB

      if (usageRatio > 0.8) {
        log.warn(
          `Memory pressure detected (${(usageRatio * 100).toFixed(1)}% heap usage). ` +
          `Clearing embedding cache (${this.cache.size} entries)`
        )
        this.clear()
        return true
      }
    }
    return false
  }

  /**
   * Get cache metrics
   */
  getMetrics(): {
    size: number
    hits: number
    misses: number
    evictions: number
    hitRate: number
  } {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    }
  }

  private evictLRU(): void {
    let minAccess = Infinity
    let lruKey: string | undefined

    for (const [key, entry] of this.cache) {
      if (entry.accessCount < minAccess) {
        minAccess = entry.accessCount
        lruKey = key
      }
    }

    if (lruKey !== undefined) {
      this.cache.delete(lruKey)
      this.evictions++
    }
  }
}

// Global embedding cache instance
const embeddingCache = new EmbeddingCache()

// Global VectorIndex for ANN search (lazy initialized)
let taskVectorIndex: VectorIndex.TaskVectorIndex | null = null

/**
 * Get or create the task vector index
 */
function getTaskVectorIndex(): VectorIndex.TaskVectorIndex {
  if (!taskVectorIndex) {
    taskVectorIndex = VectorIndex.createTaskIndex({
      maxCacheSize: 1000,
      cacheTtlMs: 60 * 60 * 1000, // 1 hour
    })
  }
  return taskVectorIndex
}

export namespace ScoringEngine {
  // Type for scoring weights
  export interface Weights {
    SEMANTIC_SIMILARITY: number
    AVAILABILITY: number
    DEPENDENCY_READY: number
    RELIABILITY: number
    LATENCY_EFFICIENCY: number
    EXPLORATION_BONUS: number
  }

  // Scoring weights (must sum to 1.0) - Base weights before RL adaptation
  export const BASE_WEIGHTS: Weights = {
    SEMANTIC_SIMILARITY: 0.35,
    AVAILABILITY: 0.15,
    DEPENDENCY_READY: 0.15,
    RELIABILITY: 0.15,
    LATENCY_EFFICIENCY: 0.10,
    EXPLORATION_BONUS: 0.10,
  }

  // Current adaptive weights (will be updated by RL)
  let adaptiveWeights: Weights = { ...BASE_WEIGHTS }

  // Feature flags for adaptive scoring
  export interface AdaptiveScoringOptions {
    enableAdaptiveScoring: boolean
    learningRate: number
    minWeight: number
    maxWeight: number
    maxOutcomeHistory: number
  }

  export const DEFAULT_ADAPTIVE_OPTIONS: AdaptiveScoringOptions = {
    enableAdaptiveScoring: true,
    learningRate: 0.05,
    minWeight: 0.05,
    maxWeight: 0.50,
    maxOutcomeHistory: 100,
  }

  let adaptiveOptions: AdaptiveScoringOptions = { ...DEFAULT_ADAPTIVE_OPTIONS }

  // Active weights - use adaptive weights
  function getWeights(): Weights {
    return adaptiveOptions.enableAdaptiveScoring ? adaptiveWeights : BASE_WEIGHTS
  }

  // Outcome tracking for RL
  export interface OutcomeRecord {
    agentName: string
    taskId: string
    taskType: string
    predictedScore: number
    actualOutcome: number // 1.0 for success, 0.0 for failure
    components: {
      semanticSimilarity: number
      availability: number
      dependencyReady: number
      reliability: number
      latencyEfficiency: number
      explorationBonus: number
    }
    timestamp: number
    completionTime: number // milliseconds
  }

  // Pending predictions - stored before task assignment for later comparison
  interface PendingPrediction {
    taskId: string
    agentName: string
    taskType: string
    predictedScore: number
    components: OutcomeRecord["components"]
    timestamp: number
  }

  // Weight performance history per task type
  interface WeightPerformance {
    taskType: string
    weightContributions: Map<string, number[]> // component -> prediction errors
    lastUpdated: number
  }

  const weightPerformanceMap = new Map<string, WeightPerformance>()
  const recentOutcomes: OutcomeRecord[] = []
  const pendingPredictions = new Map<string, PendingPrediction>() // taskId -> prediction

  // Thompson Sampling parameters for exploration
  interface ThompsonParams {
    alpha: number // Successes + 1
    beta: number // Failures + 1
  }

  const thompsonParams = new Map<string, ThompsonParams>() // agent-taskType -> params

  // Penalty factor for tasks with incomplete dependencies
  const DEPENDENCY_PENALTY = 0.2

  /**
   * Configure adaptive scoring options
   */
  export function configureAdaptiveScoring(options: Partial<AdaptiveScoringOptions>): void {
    adaptiveOptions = { ...adaptiveOptions, ...options }
    log.info(`Adaptive scoring configured: enabled=${adaptiveOptions.enableAdaptiveScoring}, learningRate=${adaptiveOptions.learningRate}`)
  }

  /**
   * Get current adaptive scoring configuration
   */
  export function getAdaptiveScoringConfig(): AdaptiveScoringOptions {
    return { ...adaptiveOptions }
  }

  /**
   * Get current weights (adaptive or base)
   */
  export function getCurrentWeights(): Weights {
    return { ...getWeights() }
  }

  /**
   * Reset adaptive weights to base values
   */
  export function resetWeights(): void {
    adaptiveWeights = { ...BASE_WEIGHTS }
    pendingPredictions.clear()
    recentOutcomes.length = 0
    weightPerformanceMap.clear()
    thompsonParams.clear()
    log.info("Adaptive weights reset to base values")
  }

  /**
   * Store prediction before task assignment for later outcome tracking
   */
  export function storePrediction(
    taskId: string,
    agentName: string,
    taskType: string,
    predictedScore: number,
    components: OutcomeRecord["components"]
  ): void {
    pendingPredictions.set(taskId, {
      taskId,
      agentName,
      taskType,
      predictedScore,
      components,
      timestamp: Date.now(),
    })
  }

  /**
   * Sample from Beta distribution using Thompson Sampling
   * Returns a value between 0 and 1 representing the sampled probability
   */
  function sampleBeta(alpha: number, beta: number): number {
    // Use the Beta distribution sampling via Gamma distributions
    // Beta(a, b) ~ Gamma(a, 1) / (Gamma(a, 1) + Gamma(b, 1))
    const gamma1 = gammaRandom(alpha, 1)
    const gamma2 = gammaRandom(beta, 1)
    return gamma1 / (gamma1 + gamma2)
  }

  /**
   * Generate a random sample from Gamma distribution
   * Uses the Marsaglia-Tsang method for shape >= 1
   * For shape < 1, uses the acceptance-rejection method
   */
  function gammaRandom(shape: number, scale: number): number {
    if (shape < 1) {
      // Use acceptance-rejection for shape < 1
      const u = Math.random()
      return gammaRandom(1 + shape, scale) * Math.pow(u, 1 / shape)
    }

    // Marsaglia-Tsang method for shape >= 1
    const d = shape - 1 / 3
    const c = 1 / Math.sqrt(9 * d)

    while (true) {
      let x = 0
      let v = 0

      do {
        x = normalRandom()
        v = 1 + c * x
      } while (v <= 0)

      v = v * v * v
      const u = Math.random()

      if (u < 1 - 0.0331 * x * x * x * x) {
        return d * v * scale
      }

      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
        return d * v * scale
      }
    }
  }

  /**
   * Standard normal random variable (Box-Muller transform)
   */
  function normalRandom(): number {
    const u1 = Math.random()
    const u2 = Math.random()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  /**
   * Get Thompson Sampling exploration bonus for agent-taskType pair
   * Higher values encourage exploration of under-sampled pairs
   */
  export function getThompsonExplorationBonus(agentName: string, taskType: string): number {
    const key = `${agentName}:${taskType}`
    const params = thompsonParams.get(key) || { alpha: 1, beta: 1 } // Uniform prior

    // Sample from Beta distribution
    const sample = sampleBeta(params.alpha, params.beta)

    // Return exploration bonus (higher for uncertain pairs)
    return sample
  }

  /**
   * Update Thompson Sampling parameters after task outcome
   */
  export function updateThompsonParams(
    agentName: string,
    taskType: string,
    success: boolean
  ): void {
    const key = `${agentName}:${taskType}`
    const current = thompsonParams.get(key) || { alpha: 1, beta: 1 }

    if (success) {
      thompsonParams.set(key, { alpha: current.alpha + 1, beta: current.beta })
    } else {
      thompsonParams.set(key, { alpha: current.alpha, beta: current.beta + 1 })
    }
  }

  /**
   * Normalize weights to sum to 1.0
   */
  function normalizeWeights(weights: Weights): Weights {
    const sum = Object.values(weights).reduce((a, b) => a + b, 0)
    if (sum === 0) return { ...BASE_WEIGHTS }

    return {
      SEMANTIC_SIMILARITY: weights.SEMANTIC_SIMILARITY / sum,
      AVAILABILITY: weights.AVAILABILITY / sum,
      DEPENDENCY_READY: weights.DEPENDENCY_READY / sum,
      RELIABILITY: weights.RELIABILITY / sum,
      LATENCY_EFFICIENCY: weights.LATENCY_EFFICIENCY / sum,
      EXPLORATION_BONUS: weights.EXPLORATION_BONUS / sum,
    }
  }

  /**
   * Clamp weight to valid range
   */
  function clampWeight(weight: number): number {
    const { minWeight, maxWeight } = adaptiveOptions
    return Math.max(minWeight, Math.min(maxWeight, weight))
  }

  /**
   * Update adaptive weights based on UCB (Upper Confidence Bound) formula
   * Formula: w_i = w_i + learning_rate * reward * (component_i - expected)
   * Reward: +1.0 for success, -0.5 for failure
   */
  export function updateWeights(
    taskId: string,
    agentName: string,
    taskType: string,
    success: boolean,
    completionTime?: number
  ): { success: boolean; message?: string } {
    if (!adaptiveOptions.enableAdaptiveScoring) {
      return { success: false, message: "Adaptive scoring is disabled" }
    }

    const prediction = pendingPredictions.get(taskId)
    if (!prediction) {
      return { success: false, message: `No prediction found for task "${taskId}"` }
    }

    // Calculate reward
    const reward = success ? 1.0 : -0.5

    // Store actual outcome
    const outcome: OutcomeRecord = {
      agentName,
      taskId,
      taskType,
      predictedScore: prediction.predictedScore,
      actualOutcome: success ? 1.0 : 0.0,
      components: prediction.components,
      timestamp: Date.now(),
      completionTime: completionTime || Date.now() - prediction.timestamp,
    }

    // Add to history
    recentOutcomes.push(outcome)
    if (recentOutcomes.length > adaptiveOptions.maxOutcomeHistory) {
      recentOutcomes.shift()
    }

    // Calculate expected score from components
    const expectedScore =
      adaptiveWeights.SEMANTIC_SIMILARITY * prediction.components.semanticSimilarity +
      adaptiveWeights.AVAILABILITY * prediction.components.availability +
      adaptiveWeights.DEPENDENCY_READY * prediction.components.dependencyReady +
      adaptiveWeights.RELIABILITY * prediction.components.reliability +
      adaptiveWeights.LATENCY_EFFICIENCY * prediction.components.latencyEfficiency +
      adaptiveWeights.EXPLORATION_BONUS * prediction.components.explorationBonus

    // Store previous weights for rollback on invalid update
    const previousWeights = { ...adaptiveWeights }

    // Update weights using UCB formula
    const { learningRate } = adaptiveOptions

    adaptiveWeights = {
      SEMANTIC_SIMILARITY: clampWeight(
        adaptiveWeights.SEMANTIC_SIMILARITY +
          learningRate * reward * (prediction.components.semanticSimilarity - expectedScore)
      ),
      AVAILABILITY: clampWeight(
        adaptiveWeights.AVAILABILITY +
          learningRate * reward * (prediction.components.availability - expectedScore)
      ),
      DEPENDENCY_READY: clampWeight(
        adaptiveWeights.DEPENDENCY_READY +
          learningRate * reward * (prediction.components.dependencyReady - expectedScore)
      ),
      RELIABILITY: clampWeight(
        adaptiveWeights.RELIABILITY +
          learningRate * reward * (prediction.components.reliability - expectedScore)
      ),
      LATENCY_EFFICIENCY: clampWeight(
        adaptiveWeights.LATENCY_EFFICIENCY +
          learningRate * reward * (prediction.components.latencyEfficiency - expectedScore)
      ),
      EXPLORATION_BONUS: clampWeight(
        adaptiveWeights.EXPLORATION_BONUS +
          learningRate * reward * (prediction.components.explorationBonus - expectedScore)
      ),
    }

    // Normalize weights to sum to 1.0
    adaptiveWeights = normalizeWeights(adaptiveWeights)

    // Verify weights are valid
    const sum = Object.values(adaptiveWeights).reduce((a, b) => a + b, 0)
    if (Math.abs(sum - 1.0) > 0.001) {
      // Revert to previous weights
      adaptiveWeights = previousWeights
      pendingPredictions.delete(taskId)
      return { success: false, message: "Weight normalization failed, reverted to previous weights" }
    }

    // Update Thompson Sampling parameters
    updateThompsonParams(agentName, taskType, success)

    // Remove prediction from pending
    pendingPredictions.delete(taskId)

    // Update weight performance tracking
    updateWeightPerformance(taskType, prediction.components, success)

    log.debug(`Updated weights after ${success ? "success" : "failure"}: ${JSON.stringify(adaptiveWeights)}`)

    return { success: true }
  }

  /**
   * Track weight performance per task type
   */
  function updateWeightPerformance(
    taskType: string,
    components: OutcomeRecord["components"],
    success: boolean
  ): void {
    let perf = weightPerformanceMap.get(taskType)
    if (!perf) {
      perf = {
        taskType,
        weightContributions: new Map(),
        lastUpdated: Date.now(),
      }
      weightPerformanceMap.set(taskType, perf)
    }

    // Track component contributions (simplified tracking)
    const componentNames = Object.keys(components) as Array<keyof typeof components>
    for (const name of componentNames) {
      const values = perf.weightContributions.get(name) || []
      values.push(components[name])
      if (values.length > 50) values.shift()
      perf.weightContributions.set(name, values)
    }

    perf.lastUpdated = Date.now()
  }

  /**
   * Get weight performance statistics for a task type
   */
  export function getWeightPerformance(taskType: string): WeightPerformance | undefined {
    return weightPerformanceMap.get(taskType)
  }

  /**
   * Get recent outcomes history
   */
  export function getRecentOutcomes(limit: number = 10): OutcomeRecord[] {
    return recentOutcomes.slice(-limit)
  }

  /**
   * Check if task dependencies are ready (all completed)
   */
  export function dependencyReady(
    task: Team.OrchestratedTask,
    allTasks: Team.OrchestratedTask[]
  ): { ready: boolean; ratio: number } {
    if (!task.dependsOn || task.dependsOn.length === 0) {
      return { ready: true, ratio: 1 }
    }

    const taskMap = new Map(allTasks.map((t) => [t.id, t]))
    let completed = 0

    for (const depId of task.dependsOn) {
      const dep = taskMap.get(depId)
      if (dep && dep.status === "completed") {
        completed++
      }
    }

    const ratio = completed / task.dependsOn.length
    return { ready: ratio === 1, ratio }
  }

  /**
   * Get task type specific stats from agent stats
   */
  function getTaskTypeStats(
    agentStats: Team.AgentStats,
    taskType: string | undefined
  ): { attempts: number; successes: number; avgCompletionTime: number } {
    const defaultStats = { attempts: 0, successes: 0, avgCompletionTime: 0 }

    if (!taskType) return defaultStats

    const typeStats = agentStats.taskTypeStats[taskType]
    return typeStats || defaultStats
  }

  /**
   * Calculate availability score
   * Returns 1.0 when agent has no tasks, 0.0 when at max capacity
   */
  function calculateAvailability(
    agentStats: Team.AgentStats,
    maxCapacity: number
  ): number {
    const activeTasks = agentStats.activeTasks || 0
    const capacity = maxCapacity || 3

    // Linear decay: 1.0 at 0 tasks, 0.0 at capacity
    const availability = 1 - (activeTasks / capacity)
    return Math.max(0, Math.min(1, availability))
  }

  /**
   * Calculate reliability score based on historical performance
   */
  function calculateReliability(agentStats: Team.AgentStats): number {
    const total = agentStats.totalTasks || 0

    if (total === 0) {
      // New agent - start with neutral reliability
      return 0.5
    }

    // Base reliability on success rate
    const successRate = (agentStats.successfulTasks || 0) / total

    // Weight by experience (more tasks = more reliable score)
    const confidence = Math.min(total / 10, 1) // Full confidence at 10+ tasks

    // Blend with stored reliability score (which may be adjusted by feedback)
    const storedReliability = agentStats.reliabilityScore || 0.5

    return successRate * confidence + storedReliability * (1 - confidence)
  }

  /**
   * Calculate latency efficiency score
   * Higher score for agents with faster average completion times
   */
  function calculateLatencyEfficiency(
    agentStats: Team.AgentStats,
    taskType: string | undefined
  ): number {
    const typeStats = getTaskTypeStats(agentStats, taskType)
    const avgTime = typeStats.avgCompletionTime || agentStats.taskTypeStats["general"]?.avgCompletionTime || 0

    if (avgTime === 0) {
      // No historical data - neutral score
      return 0.5
    }

    // Score decreases as average time increases
    // Using formula: 1 / (avg_time_hours + 1)
    // This gives: 1.0 for instant, 0.5 for 1 hour, 0.17 for 5 hours, etc.
    const avgTimeHours = avgTime / (1000 * 60 * 60)
    return 1 / (avgTimeHours + 1)
  }

  /**
   * Calculate exploration bonus using UCB-style formula
   * Encourages trying agents with fewer task assignments
   */
  function calculateExplorationBonus(
    agentStats: Team.AgentStats,
    allAgentStats: Team.AgentStats[]
  ): number {
    const agentTasks = agentStats.totalTasks || 0

    // Total tasks across all agents
    const totalTasks = allAgentStats.reduce((sum, stats) => sum + (stats.totalTasks || 0), 0)

    if (totalTasks === 0) {
      return 0.5 // Equal exploration at start
    }

    // UCB-style formula: sqrt(ln(total_tasks) / (agent_tasks + 1))
    const exploration = Math.sqrt(Math.log(totalTasks + 1) / (agentTasks + 1))

    // Normalize to 0-1 range (exploration is typically in 0-2 range)
    return Math.min(1, exploration / 2)
  }

  /**
   * Compute semantic similarity between agent and task
   * Phase 8: Uses LRU cache for embeddings and VectorIndex for ANN search
   */
  function computeSemanticSimilarity(
    agentCapabilities: Team.AgentCapabilities,
    task: Team.OrchestratedTask
  ): number {
    // Check memory pressure before computing
    embeddingCache.checkMemoryPressure()

    // If task has embedding, use it directly
    if (task.embedding && task.embedding.length > 0) {
      return EmbeddingService.cosineSimilarity(agentCapabilities.embedding, task.embedding)
    }

    // Try to get cached embedding
    const cacheKey = `task:${task.id}:${task.description.slice(0, 50)}`
    let taskEmbedding = embeddingCache.get(cacheKey)

    if (!taskEmbedding) {
      // Generate embedding from task description
      taskEmbedding = EmbeddingService.generateTaskEmbedding({
        description: task.description,
        taskType: task.taskType,
        metadata: task.metadata,
      })

      // Cache the embedding
      embeddingCache.set(cacheKey, taskEmbedding)
    }

    return EmbeddingService.cosineSimilarity(agentCapabilities.embedding, taskEmbedding)
  }

  /**
   * Get embedding cache metrics for observability
   */
  export function getEmbeddingCacheMetrics(): {
    size: number
    hits: number
    misses: number
    evictions: number
    hitRate: number
  } {
    return embeddingCache.getMetrics()
  }

  /**
   * Clear embedding cache (useful for testing or memory pressure)
   */
  export function clearEmbeddingCache(): void {
    embeddingCache.clear()
  }

  /**
   * Index a task in the vector index for similarity search
   */
  export function indexTaskForSimilarity(task: Team.OrchestratedTask): void {
    try {
      const index = getTaskVectorIndex()
      index.indexTask(task.id, {
        description: task.description,
        taskType: task.taskType,
        metadata: task.metadata,
      })
    } catch (error) {
      log.error(`Failed to index task ${task.id}: ${error}`)
      // Don't throw - indexing failure shouldn't break scoring
    }
  }

  /**
   * Find similar tasks using ANN search
   */
  export function findSimilarTasks(
    queryTask: { description: string; taskType?: string; metadata?: Record<string, any> },
    k: number
  ): Array<{ taskId: string; similarity: number; taskType?: string }> {
    try {
      const index = getTaskVectorIndex()
      return index.findSimilarTasks(queryTask, k)
    } catch (error) {
      log.error(`Failed to find similar tasks: ${error}`)
      return []
    }
  }

  /**
   * Get vector index metrics
   */
  export function getVectorIndexMetrics(): ReturnType<VectorIndex.TaskVectorIndex["getMetrics"]> | null {
    try {
      return getTaskVectorIndex().getMetrics()
    } catch (error) {
      log.error(`Failed to get vector index metrics: ${error}`)
      return null
    }
  }

  /**
   * Scoring result with component breakdown
   */
  export interface ScoreResult {
    score: number
    components: {
      semanticSimilarity: number
      availability: number
      dependencyReady: number
      reliability: number
      latencyEfficiency: number
      explorationBonus: number
    }
    details: {
      dependencyPenaltyApplied: boolean
      agentTaskCount: number
      taskType?: string
    }
  }

  /**
   * Compute composite score for agent-task matching
   *
   * Formula (weights are adaptive):
   * score = w1 * semantic_similarity +
   *         w2 * availability +
   *         w3 * dependency_ready +
   *         w4 * reliability +
   *         w5 * latency_efficiency +
   *         w6 * exploration_bonus
   *
   * If dependencies not ready: multiply by 0.2
   */
  export function computeScore(
    agentCapabilities: Team.AgentCapabilities,
    agentStats: Team.AgentStats,
    task: Team.OrchestratedTask,
    allTasks: Team.OrchestratedTask[],
    allAgentStats: Team.AgentStats[]
  ): ScoreResult {
    // Get current weights (adaptive or base)
    const weights = getWeights()

    // Calculate individual components
    const semanticSimilarity = computeSemanticSimilarity(agentCapabilities, task)
    const availability = calculateAvailability(agentStats, agentCapabilities.maxCapacity)
    const depStatus = dependencyReady(task, allTasks)
    const reliability = calculateReliability(agentStats)
    const latencyEfficiency = calculateLatencyEfficiency(agentStats, task.taskType)

    // Calculate exploration bonus with Thompson Sampling if adaptive scoring enabled
    let explorationBonus: number
    if (adaptiveOptions.enableAdaptiveScoring && task.taskType) {
      const thompsonBonus = getThompsonExplorationBonus(agentCapabilities.agentName, task.taskType)
      const ucbBonus = calculateExplorationBonus(agentStats, allAgentStats)
      // Blend UCB and Thompson Sampling
      explorationBonus = 0.6 * ucbBonus + 0.4 * thompsonBonus
    } else {
      explorationBonus = calculateExplorationBonus(agentStats, allAgentStats)
    }

    // Compute weighted score
    let score =
      weights.SEMANTIC_SIMILARITY * semanticSimilarity +
      weights.AVAILABILITY * availability +
      weights.DEPENDENCY_READY * depStatus.ratio +
      weights.RELIABILITY * reliability +
      weights.LATENCY_EFFICIENCY * latencyEfficiency +
      weights.EXPLORATION_BONUS * explorationBonus

    // Apply dependency penalty if not ready
    let dependencyPenaltyApplied = false
    if (!depStatus.ready) {
      score *= DEPENDENCY_PENALTY
      dependencyPenaltyApplied = true
    }

    return {
      score,
      components: {
        semanticSimilarity,
        availability,
        dependencyReady: depStatus.ratio,
        reliability,
        latencyEfficiency,
        explorationBonus,
      },
      details: {
        dependencyPenaltyApplied,
        agentTaskCount: agentStats.totalTasks || 0,
        taskType: task.taskType,
      },
    }
  }

  /**
   * Compute score and store prediction for later outcome tracking
   * This should be called before task assignment
   */
  export function computeScoreWithPrediction(
    agentCapabilities: Team.AgentCapabilities,
    agentStats: Team.AgentStats,
    task: Team.OrchestratedTask,
    allTasks: Team.OrchestratedTask[],
    allAgentStats: Team.AgentStats[]
  ): ScoreResult {
    const result = computeScore(agentCapabilities, agentStats, task, allTasks, allAgentStats)

    // Store prediction for later weight update
    if (adaptiveOptions.enableAdaptiveScoring) {
      storePrediction(
        task.id,
        agentCapabilities.agentName,
        task.taskType || "general",
        result.score,
        result.components
      )
    }

    return result
  }

  /**
   * Select the best agent for a task
   * Returns null if no suitable agent found
   */
  export function selectBestAgent(
    task: Team.OrchestratedTask,
    agents: Array<{
      capabilities: Team.AgentCapabilities
      stats: Team.AgentStats
    }>,
    allTasks: Team.OrchestratedTask[]
  ): {
    bestAgent: string | null
    score: number
    scores: Array<{ agentName: string; score: number; result: ScoreResult }>
  } {
    const allAgentStats = agents.map((a) => a.stats)

    const scores = agents.map(({ capabilities, stats }) => {
      const result = computeScore(capabilities, stats, task, allTasks, allAgentStats)
      return {
        agentName: capabilities.agentName,
        score: result.score,
        result,
      }
    })

    // Sort by score descending
    scores.sort((a, b) => b.score - a.score)

    // Return best agent if score is above threshold
    const THRESHOLD = 0.1 // Minimum score to be considered
    if (scores.length > 0 && scores[0].score >= THRESHOLD) {
      return {
        bestAgent: scores[0].agentName,
        score: scores[0].score,
        scores,
      }
    }

    return {
      bestAgent: null,
      score: 0,
      scores,
    }
  }

  /**
   * Rank all available tasks for an agent
   * Returns tasks sorted by score (highest first)
   */
  export function rankTasksForAgent(
    agentCapabilities: Team.AgentCapabilities,
    agentStats: Team.AgentStats,
    tasks: Team.OrchestratedTask[],
    allAgentStats: Team.AgentStats[]
  ): Array<{ task: Team.OrchestratedTask; score: number; result: ScoreResult }> {
    const ranked = tasks.map((task) => {
      const result = computeScore(agentCapabilities, agentStats, task, tasks, allAgentStats)
      return { task, score: result.score, result }
    })

    // Sort by score descending
    ranked.sort((a, b) => b.score - a.score)

    return ranked
  }

  /**
   * Check if agent should auto-claim a task
   * Returns the best task to claim, or null if none suitable
   */
  export function shouldAutoClaim(
    agentCapabilities: Team.AgentCapabilities,
    agentStats: Team.AgentStats,
    availableTasks: Team.OrchestratedTask[],
    allAgentStats: Team.AgentStats[],
    options: {
      minScore?: number
      maxActiveTasks?: number
    } = {}
  ): { task: Team.OrchestratedTask; score: number; result: ScoreResult } | null {
    const { minScore = 0.3, maxActiveTasks = 3 } = options

    // Don't claim if at capacity
    if (agentStats.activeTasks >= maxActiveTasks) {
      return null
    }

    // Filter to only dependency-ready tasks
    const readyTasks = availableTasks.filter((task) => {
      const depStatus = dependencyReady(task, availableTasks)
      return depStatus.ready
    })

    if (readyTasks.length === 0) {
      return null
    }

    // Rank tasks and find best
    const ranked = rankTasksForAgent(agentCapabilities, agentStats, readyTasks, allAgentStats)

    // Return best if above threshold
    if (ranked.length > 0 && ranked[0].score >= minScore) {
      return ranked[0]
    }

    return null
  }
}
