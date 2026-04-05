import path from "path"
import os from "os"
import { Team } from "./schema"
import { Filesystem } from "../util/filesystem"
import { Global } from "../global"
import { Log } from "../util/log"

const log = Log.create({ service: "team.registry" })

function getTeamDir(): string {
  return process.env.OPENCODE_TEAMS_DIR || path.join(os.homedir(), ".opencode", "teams")
}

export namespace TeamRegistry {
  export async function ensureTeamDir(teamName: string): Promise<string> {
    const dir = path.join(getTeamDir(), teamName)
    await Filesystem.mkdirp(dir)
    return dir
  }

  export async function getTeamConfigPath(teamName: string): Promise<string> {
    const dir = await ensureTeamDir(teamName)
    return path.join(dir, "config.json")
  }

  export async function getInboxPath(teamName: string, agentName: string): Promise<string> {
    const dir = await ensureTeamDir(teamName)
    const inboxDir = path.join(dir, "inboxes")
    await Filesystem.mkdirp(inboxDir)
    return path.join(inboxDir, `${agentName}.jsonl`)
  }

  export async function getTasksPath(teamName: string): Promise<string> {
    const dir = await ensureTeamDir(teamName)
    return path.join(dir, "tasks.json")
  }

  export async function getSessionsPath(teamName: string): Promise<string> {
    const dir = await ensureTeamDir(teamName)
    return path.join(dir, "sessions.json")
  }

  export async function getAgentStatsPath(teamName: string): Promise<string> {
    const dir = await ensureTeamDir(teamName)
    return path.join(dir, "agent_stats.json")
  }

  export async function getAgentCapabilitiesPath(teamName: string): Promise<string> {
    const dir = await ensureTeamDir(teamName)
    return path.join(dir, "agent_capabilities.json")
  }

  export async function getSchedulerStatePath(teamName: string): Promise<string> {
    const dir = await ensureTeamDir(teamName)
    return path.join(dir, "scheduler_state.json")
  }

  export async function createTeam(config: Team.Config): Promise<void> {
    const configPath = await getTeamConfigPath(config.team)
    const existing = await Filesystem.readText(configPath).catch(() => null)

    if (existing) {
      throw new Error(`Team "${config.team}" already exists`)
    }

    const teamData = {
      ...config,
      createdAt: Date.now(),
    }

    await Filesystem.writeText(configPath, JSON.stringify(teamData, null, 2))
    log.info(`Created team "${config.team}" at ${configPath}`)
  }

  export async function getTeam(teamName: string): Promise<Team.Config | null> {
    const configPath = await getTeamConfigPath(teamName)
    const content = await Filesystem.readText(configPath).catch(() => null)

    if (!content) return null

    try {
      const parsed = JSON.parse(content)
      return Team.Config.parse(parsed)
    } catch (error) {
      log.error(`Failed to parse team config for "${teamName}": ${error}`)
      return null
    }
  }

  export async function listTeams(): Promise<string[]> {
    const teamDir = getTeamDir()
    const exists = await Filesystem.exists(teamDir)
    if (!exists) return []

    const entries = await Filesystem.readdir(teamDir)
    const teams: string[] = []

    for (const entry of entries) {
      const configPath = path.join(teamDir, entry, "config.json")
      const exists = await Filesystem.exists(configPath)
      if (exists) {
        teams.push(entry)
      }
    }

    return teams
  }

  export async function teamExists(teamName: string): Promise<boolean> {
    const team = await getTeam(teamName)
    return team !== null
  }

  export async function updateTeam(teamName: string, updates: Partial<Team.Config>): Promise<void> {
    const team = await getTeam(teamName)
    if (!team) {
      throw new Error(`Team "${teamName}" not found`)
    }

    const configPath = await getTeamConfigPath(teamName)
    const updated = { ...team, ...updates }
    await Filesystem.writeText(configPath, JSON.stringify(updated, null, 2))
    log.info(`Updated team "${teamName}"`)
  }

  export async function deleteTeam(teamName: string): Promise<void> {
    const teamDir = path.join(getTeamDir(), teamName)
    const exists = await Filesystem.exists(teamDir)
    if (!exists) {
      throw new Error(`Team "${teamName}" not found`)
    }

    await Filesystem.rmdir(teamDir, { recursive: true })
    log.info(`Deleted team "${teamName}"`)
  }

  // ============================================================================
  // Agent Stats Management
  // ============================================================================

  export async function loadAgentStats(teamName: string): Promise<Team.AgentStats[]> {
    const statsPath = await getAgentStatsPath(teamName)
    const exists = await Filesystem.exists(statsPath)
    if (!exists) return []

    try {
      const content = await Filesystem.readJson<Team.AgentStats[]>(statsPath)
      return content || []
    } catch {
      return []
    }
  }

  /**
   * Load agent stats and restore circuit breaker state
   * Called during scheduler initialization to restore circuit state after restart
   */
  export async function loadAgentStatsWithCircuitRestore(
    teamName: string,
    config?: Partial<import("./circuitBreaker").CircuitBreaker.CircuitBreakerConfig>
  ): Promise<Team.AgentStats[]> {
    const stats = await loadAgentStats(teamName)
    const { CircuitBreaker } = await import("./circuitBreaker")

    for (const stat of stats) {
      // Restore circuit breaker state if it was persisted
      if (stat.circuitState && stat.circuitState !== "closed") {
        const savedState: Partial<import("./circuitBreaker").CircuitBreaker.CircuitBreakerState> = {
          agentName: stat.agentName,
          teamName,
          state: stat.circuitState,
          failureCount: stat.circuitFailureCount || 0,
          circuitOpenedAt: stat.circuitOpenedAt || null,
          totalTasks: stat.totalTasks || 0,
          consecutiveSuccesses: 0, // Reset on restore
        }

        CircuitBreaker.restoreCircuitState(teamName, stat.agentName, savedState, config)
        log.info(`Restored circuit breaker state for "${stat.agentName}": ${stat.circuitState}`)
      }
    }

    return stats
  }

  export async function saveAgentStats(teamName: string, stats: Team.AgentStats[]): Promise<void> {
    const statsPath = await getAgentStatsPath(teamName)
    await Filesystem.writeJson(statsPath, stats)
  }

  export async function getAgentStat(
    teamName: string,
    agentName: string
  ): Promise<Team.AgentStats | null> {
    const stats = await loadAgentStats(teamName)
    return stats.find((s) => s.agentName === agentName) || null
  }

  export async function updateAgentStat(
    teamName: string,
    agentName: string,
    updater: (stats: Team.AgentStats) => Team.AgentStats
  ): Promise<Team.AgentStats> {
    const stats = await loadAgentStats(teamName)
    const index = stats.findIndex((s) => s.agentName === agentName)

    let updated: Team.AgentStats
    if (index >= 0) {
      updated = updater({ ...stats[index] })
      stats[index] = updated
    } else {
      // Create new stats entry
      updated = updater({
        agentName,
        totalTasks: 0,
        successfulTasks: 0,
        failedTasks: 0,
        taskTypeStats: {},
        reliabilityScore: 0.5,
        activeTasks: 0,
        updatedAt: Date.now(),
      })
      stats.push(updated)
    }

    await saveAgentStats(teamName, stats)
    return updated
  }

  // ============================================================================
  // Agent Capabilities Management
  // ============================================================================

  export async function loadAgentCapabilities(teamName: string): Promise<Team.AgentCapabilities[]> {
    const capsPath = await getAgentCapabilitiesPath(teamName)
    const exists = await Filesystem.exists(capsPath)
    if (!exists) return []

    try {
      const content = await Filesystem.readJson<Team.AgentCapabilities[]>(capsPath)
      return content || []
    } catch {
      return []
    }
  }

  export async function saveAgentCapabilities(
    teamName: string,
    capabilities: Team.AgentCapabilities[]
  ): Promise<void> {
    const capsPath = await getAgentCapabilitiesPath(teamName)
    await Filesystem.writeJson(capsPath, capabilities)
  }

  export async function getAgentCapabilities(
    teamName: string,
    agentName: string
  ): Promise<Team.AgentCapabilities | null> {
    const caps = await loadAgentCapabilities(teamName)
    return caps.find((c) => c.agentName === agentName) || null
  }

  export async function ensureAgentCapabilities(
    teamName: string,
    agentName: string,
    agentConfig: Team.MemberConfig
  ): Promise<Team.AgentCapabilities> {
    const existing = await getAgentCapabilities(teamName, agentName)
    if (existing) return existing

    // Import here to avoid circular dependency
    const { EmbeddingService } = await import("./embedding")

    // Create new capabilities from config
    const capabilities: Team.AgentCapabilities = {
      agentName,
      embedding: EmbeddingService.generateAgentCapabilities({
        name: agentName,
        agentType: agentConfig.agentType,
        expertise: EmbeddingService.suggestExpertise(agentConfig.prompt || ""),
        prompt: agentConfig.prompt,
      }),
      expertise: EmbeddingService.suggestExpertise(agentConfig.prompt || ""),
      maxCapacity: 3,
      agentType: agentConfig.agentType,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    const allCaps = await loadAgentCapabilities(teamName)
    allCaps.push(capabilities)
    await saveAgentCapabilities(teamName, allCaps)

    log.info(`Created capabilities for agent "${agentName}" in team "${teamName}"`)
    return capabilities
  }
}
