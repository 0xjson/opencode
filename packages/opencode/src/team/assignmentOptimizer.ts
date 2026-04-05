// Assignment Optimizer using Hungarian Algorithm
// Implements global optimization for task-agent assignment

import { Team } from "./schema"
import { ScoringEngine } from "./scorer"
import { CircuitBreaker } from "./circuitBreaker"
import { Log } from "../util/log"

const log = Log.create({ service: "team.assignmentOptimizer" })

export namespace AssignmentOptimizer {
  export interface Assignment {
    taskId: string
    agentName: string
    score: number
  }

  export interface OptimizationOptions {
    enableGlobalOptimization: boolean
    optimizationThreshold: number // Min tasks to trigger optimization (default 5)
    highPriorityThreshold: Team.TaskPriority // Always optimize for high+ priority
    maxTasksToOptimize?: number // Max tasks to include in optimization (default 20)
    teamName?: string // Team name for circuit breaker checks
    circuitBreakerConfig?: Partial<CircuitBreaker.CircuitBreakerConfig>
  }

  export const DEFAULT_OPTIONS: OptimizationOptions = {
    enableGlobalOptimization: false,
    optimizationThreshold: 5,
    highPriorityThreshold: "high",
    maxTasksToOptimize: 20,
  }

  // Priority weights for comparison
  const PRIORITY_VALUES: Record<Team.TaskPriority, number> = {
    low: 1,
    normal: 2,
    high: 3,
    critical: 4,
  }

  /**
   * Filter agents that can accept tasks (respecting circuit breakers)
   */
  export function filterAvailableAgents(
    teamName: string,
    agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }>,
    circuitBreakerConfig?: Partial<CircuitBreaker.CircuitBreakerConfig>
  ): Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }> {
    return agents.filter(({ capabilities }) => {
      const canAccept = CircuitBreaker.canAgentAcceptTasks(
        teamName,
        capabilities.agentName,
        circuitBreakerConfig
      )
      if (!canAccept) {
        log.debug(`Agent "${capabilities.agentName}" filtered out by circuit breaker`)
      }
      return canAccept
    })
  }

  /**
   * Get top N tasks by priority for optimization
   * Limits optimization scope to prevent O(n³) explosion
   */
  export function getTopTasksByPriority(
    tasks: Team.OrchestratedTask[],
    maxTasks: number = 20
  ): Team.OrchestratedTask[] {
    if (tasks.length <= maxTasks) {
      return tasks
    }

    // Sort by priority first, then by creation time (older first)
    const sorted = [...tasks].sort((a, b) => {
      const priorityDiff = PRIORITY_VALUES[b.priority || "normal"] -
                           PRIORITY_VALUES[a.priority || "normal"]
      if (priorityDiff !== 0) return priorityDiff
      return (a.createdAt || 0) - (b.createdAt || 0)
    })

    return sorted.slice(0, maxTasks)
  }

  /**
   * Main entry point: optimize task-agent assignments
   *
   * Performance considerations:
   * - Limits tasks to maxTasksToOptimize (default 20) to prevent O(n³) explosion
   * - Filters agents by circuit breaker state if teamName provided
   * - Falls back to greedy assignment on Hungarian algorithm failure
   */
  export function optimizeAssignments(
    tasks: Team.OrchestratedTask[],
    agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }>,
    allTasks: Team.OrchestratedTask[],
    allAgentStats: Team.AgentStats[],
    options?: Partial<OptimizationOptions>
  ): Assignment[] {
    const fullOptions = { ...DEFAULT_OPTIONS, ...options }

    // Check if optimization should run
    if (!shouldOptimize(tasks, fullOptions)) {
      return []
    }

    // Filter agents by circuit breaker if team name provided
    let availableAgents = agents
    if (fullOptions.teamName) {
      availableAgents = filterAvailableAgents(
        fullOptions.teamName,
        agents,
        fullOptions.circuitBreakerConfig
      )

      if (availableAgents.length === 0) {
        log.warn("No agents available after circuit breaker filtering")
        return []
      }
    }

    // Limit tasks to prevent performance degradation
    const tasksToOptimize = getTopTasksByPriority(tasks, fullOptions.maxTasksToOptimize)

    if (tasksToOptimize.length < tasks.length) {
      log.info(`Optimizing top ${tasksToOptimize.length} of ${tasks.length} tasks (limit: ${fullOptions.maxTasksToOptimize})`)
    }

    try {
      // Build score matrix
      const scoreMatrix = buildScoreMatrix(tasksToOptimize, availableAgents, allTasks, allAgentStats)

      // Run Hungarian algorithm
      const assignments = hungarianAlgorithm(scoreMatrix)

      // Convert to Assignment objects
      return assignments.map(({ row, col }) => ({
        taskId: tasksToOptimize[row].id,
        agentName: availableAgents[col].capabilities.agentName,
        score: scoreMatrix[row][col],
      }))
    } catch (error) {
      log.error(`Hungarian algorithm failed: ${error}. Falling back to greedy selection.`)
      // Return empty array - caller should use greedyAssignment() as fallback
      return []
    }
  }

  /**
   * Check if optimization should run
   */
  export function shouldOptimize(
    tasks: Team.OrchestratedTask[],
    options: OptimizationOptions
  ): boolean {
    // Always optimize if global optimization is disabled
    if (!options.enableGlobalOptimization) {
      return false
    }

    // Check if any task has high priority
    const hasHighPriority = tasks.some(
      (t) => PRIORITY_VALUES[t.priority || "normal"] >= PRIORITY_VALUES[options.highPriorityThreshold]
    )

    if (hasHighPriority) {
      return true
    }

    // Check if batch size meets threshold
    return tasks.length >= options.optimizationThreshold
  }

  /**
   * Build score matrix for Hungarian algorithm
   * Returns matrix where scoreMatrix[i][j] = score for assigning task i to agent j
   */
  export function buildScoreMatrix(
    tasks: Team.OrchestratedTask[],
    agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }>,
    allTasks: Team.OrchestratedTask[],
    allAgentStats: Team.AgentStats[]
  ): number[][] {
    const matrix: number[][] = []

    for (const task of tasks) {
      const row: number[] = []
      for (const { capabilities, stats } of agents) {
        const result = ScoringEngine.computeScore(capabilities, stats, task, allTasks, allAgentStats)
        // Ensure non-negative scores (Hungarian algorithm works with positive costs)
        row.push(Math.max(0, result.score))
      }
      matrix.push(row)
    }

    return matrix
  }

  /**
   * Hungarian Algorithm implementation for assignment problem
   * Solves the assignment problem to maximize total score
   *
   * This implementation handles rectangular matrices (n tasks, m agents)
   * and finds the optimal assignment that maximizes total score.
   *
   * Time complexity: O(n²m) for n <= m, or O(nm²) for n > m
   *
   * @param costMatrix - Matrix where costMatrix[i][j] is the score for assigning task i to agent j
   * @returns Array of {row, col} pairs representing optimal assignments
   */
  export function hungarianAlgorithm(
    costMatrix: number[][]
  ): { row: number; col: number }[] {
    if (costMatrix.length === 0 || costMatrix[0].length === 0) {
      return []
    }

    const n = costMatrix.length // Number of tasks (rows)
    const m = costMatrix[0].length // Number of agents (columns)

    // For maximization, convert to minimization by subtracting from max
    const maxVal = Math.max(...costMatrix.flat())
    let matrix = costMatrix.map((row) => row.map((val) => maxVal - val))

    // Handle rectangular matrices by padding to square
    const size = Math.max(n, m)
    const paddedMatrix: number[][] = []

    for (let i = 0; i < size; i++) {
      const row: number[] = []
      for (let j = 0; j < size; j++) {
        if (i < n && j < m) {
          row.push(matrix[i][j])
        } else {
          // Pad with large value (will not be selected)
          row.push(Number.MAX_SAFE_INTEGER)
        }
      }
      paddedMatrix.push(row)
    }

    // Apply Hungarian algorithm on square matrix
    const assignments = hungarianAlgorithmSquare(paddedMatrix)

    // Filter out padded assignments and map back to original indices
    return assignments
      .filter(({ row, col }) => row < n && col < m)
      .map(({ row, col }) => ({ row, col }))
  }

  /**
   * Hungarian Algorithm for square matrices
   * Implementation of the classic Kuhn-Munkres algorithm
   */
  function hungarianAlgorithmSquare(costMatrix: number[][]): { row: number; col: number }[] {
    const n = costMatrix.length

    // Step 1: Subtract row minima
    const rowMinima = costMatrix.map((row) => Math.min(...row))
    let matrix = costMatrix.map((row, i) => row.map((val) => val - rowMinima[i]))

    // Step 2: Subtract column minima
    const colMinima: number[] = []
    for (let j = 0; j < n; j++) {
      let min = Number.MAX_SAFE_INTEGER
      for (let i = 0; i < n; i++) {
        min = Math.min(min, matrix[i][j])
      }
      colMinima[j] = min
    }

    matrix = matrix.map((row) => row.map((val, j) => val - colMinima[j]))

    // Step 3-5: Find optimal assignment using augmenting paths
    const rowCovered = new Array(n).fill(false)
    const colCovered = new Array(n).fill(false)
    const starMatrix = Array.from({ length: n }, () => new Array(n).fill(false))
    const primeMatrix = Array.from({ length: n }, () => new Array(n).fill(false))

    // Helper to find uncovered zero
    const findUncoveredZero = (): { row: number; col: number } | null => {
      for (let i = 0; i < n; i++) {
        if (rowCovered[i]) continue
        for (let j = 0; j < n; j++) {
          if (!colCovered[j] && matrix[i][j] === 0) {
            return { row: i, col: j }
          }
        }
      }
      return null
    }

    // Helper to find starred zero in column
    const findStarInCol = (col: number): number => {
      for (let i = 0; i < n; i++) {
        if (starMatrix[i][col]) return i
      }
      return -1
    }

    // Helper to find primed zero in row
    const findPrimeInRow = (row: number): number => {
      for (let j = 0; j < n; j++) {
        if (primeMatrix[row][j]) return j
      }
      return -1
    }

    // Step 3: Star zeros (initial greedy matching)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (matrix[i][j] === 0 && !rowCovered[i] && !colCovered[j]) {
          starMatrix[i][j] = true
          rowCovered[i] = true
          colCovered[j] = true
        }
      }
    }

    // Reset coverings for main algorithm
    rowCovered.fill(false)
    colCovered.fill(false)

    // Main algorithm loop
    while (true) {
      // Step 4: Cover columns with starred zeros
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          if (starMatrix[i][j]) {
            colCovered[j] = true
            break
          }
        }
      }

      // Check if all columns are covered (optimal solution found)
      const coveredCols = colCovered.filter(Boolean).length
      if (coveredCols === n) {
        break
      }

      // Step 5: Prime uncovered zeros
      let done = false
      while (!done) {
        const zero = findUncoveredZero()

        if (!zero) {
          // Step 6: No uncovered zeros - adjust matrix
          let minUncovered = Number.MAX_SAFE_INTEGER
          for (let i = 0; i < n; i++) {
            if (rowCovered[i]) continue
            for (let j = 0; j < n; j++) {
              if (!colCovered[j]) {
                minUncovered = Math.min(minUncovered, matrix[i][j])
              }
            }
          }

          // Add min to covered rows, subtract from uncovered columns
          for (let i = 0; i < n; i++) {
            for (let j = 0; j < n; j++) {
              if (rowCovered[i]) matrix[i][j] += minUncovered
              if (!colCovered[j]) matrix[i][j] -= minUncovered
            }
          }
        } else {
          primeMatrix[zero.row][zero.col] = true

          // Check for starred zero in same row
          const starredCol = starMatrix[zero.row].indexOf(true)

          if (starredCol === -1) {
            // Step 5a: Augmenting path found
            let currentRow = zero.row
            let currentCol = zero.col

            const path: { row: number; col: number }[] = [{ row: currentRow, col: currentCol }]

            while (true) {
              // Find starred zero in current column
              const starRow = findStarInCol(currentCol)
              if (starRow === -1) break

              path.push({ row: starRow, col: currentCol })

              // Find primed zero in that row
              const primeCol = findPrimeInRow(starRow)
              if (primeCol === -1) break

              path.push({ row: starRow, col: primeCol })
              currentRow = starRow
              currentCol = primeCol
            }

            // Update matching: unstar starred, star primed
            for (const { row, col } of path) {
              if (starMatrix[row][col]) {
                starMatrix[row][col] = false
              } else if (primeMatrix[row][col]) {
                starMatrix[row][col] = true
                primeMatrix[row][col] = false
              }
            }

            // Clear coverings and primes
            rowCovered.fill(false)
            colCovered.fill(false)
            for (let i = 0; i < n; i++) {
              primeMatrix[i].fill(false)
            }

            done = true
          } else {
            // Cover row, uncover column
            rowCovered[zero.row] = true
            colCovered[starredCol] = false
          }
        }
      }
    }

    // Extract assignments from starred zeros
    const assignments: { row: number; col: number }[] = []
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (starMatrix[i][j]) {
          assignments.push({ row: i, col: j })
        }
      }
    }

    return assignments
  }

  /**
   * Greedy fallback for assignment when Hungarian algorithm fails
   * Returns assignments by iteratively picking highest score
   */
  export function greedyAssignment(
    tasks: Team.OrchestratedTask[],
    agents: Array<{ capabilities: Team.AgentCapabilities; stats: Team.AgentStats }>,
    allTasks: Team.OrchestratedTask[],
    allAgentStats: Team.AgentStats[]
  ): Assignment[] {
    const scoreMatrix = buildScoreMatrix(tasks, agents, allTasks, allAgentStats)
    const assignments: Assignment[] = []
    const assignedAgents = new Set<number>()
    const assignedTasks = new Set<number>()

    // Create list of all possible assignments with scores
    const candidates: { taskIdx: number; agentIdx: number; score: number }[] = []
    for (let i = 0; i < tasks.length; i++) {
      for (let j = 0; j < agents.length; j++) {
        candidates.push({
          taskIdx: i,
          agentIdx: j,
          score: scoreMatrix[i][j],
        })
      }
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score)

    // Greedily assign
    for (const candidate of candidates) {
      if (assignedTasks.has(candidate.taskIdx) || assignedAgents.has(candidate.agentIdx)) {
        continue
      }

      assignments.push({
        taskId: tasks[candidate.taskIdx].id,
        agentName: agents[candidate.agentIdx].capabilities.agentName,
        score: candidate.score,
      })

      assignedTasks.add(candidate.taskIdx)
      assignedAgents.add(candidate.agentIdx)
    }

    return assignments
  }
}
