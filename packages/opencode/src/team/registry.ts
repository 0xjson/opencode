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
}
