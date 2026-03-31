import path from "path"
import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamSession } from "./session"
import { TeamInbox } from "./inbox"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "team.recovery" })

// Default timeout for considering a session as crashed (5 minutes)
const DEFAULT_CRASH_TIMEOUT_MS = 5 * 60 * 1000

export interface RecoveryStatus {
  teamName: string
  ready: number
  busy: number
  error: number
  shutdown: number
  shutdownRequested: number
  total: number
  healthy: boolean
}

export interface RecoveryResult {
  teamName: string
  recoveredSessions: Team.Session[]
  recoveryCount: number
}

export interface TeamRecoveryMetadata {
  markedAt: number
  reason: string
  recoveredAt?: number
  recoveryId: string
}

async function getRecoveryPath(teamName: string): Promise<string> {
  const teamDir = await TeamRegistry.ensureTeamDir(teamName)
  return path.join(teamDir, "recovery.json")
}

async function loadRecoveryMetadata(teamName: string): Promise<TeamRecoveryMetadata | null> {
  const recoveryPath = await getRecoveryPath(teamName)
  const exists = await Filesystem.exists(recoveryPath)
  if (!exists) return null

  try {
    const content = await Filesystem.readJson<TeamRecoveryMetadata>(recoveryPath)
    return content
  } catch {
    return null
  }
}

async function saveRecoveryMetadata(teamName: string, metadata: TeamRecoveryMetadata): Promise<void> {
  const recoveryPath = await getRecoveryPath(teamName)
  await Filesystem.writeJson(recoveryPath, metadata)
}

/**
 * Get the health status of a team
 * Returns counts of sessions by status and whether the team is healthy
 */
async function getRecoveryStatusImpl(teamName: string): Promise<RecoveryStatus> {
  const team = await TeamRegistry.getTeam(teamName)
  if (!team) {
    throw new Error(`Team "${teamName}" not found`)
  }

  const sessions = await TeamSession.getAllMembers(teamName)

  let ready = 0
  let busy = 0
  let error = 0
  let shutdown = 0
  let shutdownRequested = 0

  for (const session of sessions) {
    switch (session.status) {
      case "ready":
        ready++
        break
      case "busy":
        busy++
        break
      case "error":
        error++
        break
      case "shutdown":
        shutdown++
        break
      case "shutdown_requested":
        shutdownRequested++
        break
    }
  }

  // Team is healthy if there are no error/crashed sessions
  const healthy = error === 0

  return {
    teamName,
    ready,
    busy,
    error,
    shutdown,
    shutdownRequested,
    total: sessions.length,
    healthy,
  }
}

/**
 * Recover a specific team
 * Finds busy sessions that haven't had activity recently and recovers them
 */
async function recoverTeamImpl(teamName: string): Promise<RecoveryResult> {
  const team = await TeamRegistry.getTeam(teamName)
  if (!team) {
    throw new Error(`Team "${teamName}" not found`)
  }

  log.info(`Starting recovery for team "${teamName}"`)

  // Use the existing recoverFromCrash function from TeamSession
  const recoveredSessions = await TeamSession.recoverFromCrash(teamName)

  // Send notification to team lead about recovered sessions
  if (recoveredSessions.length > 0) {
    const sessionDetails = recoveredSessions
      .map((s) => `- ${s.agentName} (${s.sessionId})`)
      .join("\n")

    const message = `Recovery completed for team "${teamName}". ${recoveredSessions.length} session(s) recovered to ready state:\n${sessionDetails}`

    try {
      await TeamInbox.sendMessage(teamName, team.lead, "system", message, "system", {
        type: "recovery_notification",
        recoveryCount: recoveredSessions.length,
        recoveredSessions: recoveredSessions.map((s) => s.sessionId),
      })
    } catch (error) {
      log.warn(`Failed to send recovery notification to lead: ${error}`)
    }

    // Update recovery metadata
    const existingMetadata = await loadRecoveryMetadata(teamName)
    const metadata: TeamRecoveryMetadata = {
      markedAt: existingMetadata?.markedAt || Date.now(),
      reason: existingMetadata?.reason || "auto_recovery",
      recoveredAt: Date.now(),
      recoveryId: existingMetadata?.recoveryId || ulid(),
    }
    await saveRecoveryMetadata(teamName, metadata)

    log.info(`Recovered ${recoveredSessions.length} sessions for team "${teamName}"`)
  } else {
    log.info(`No sessions to recover for team "${teamName}"`)
  }

  return {
    teamName,
    recoveredSessions,
    recoveryCount: recoveredSessions.length,
  }
}

/**
 * Scan all teams and recover crashed sessions
 * Returns recovery results for each team
 */
async function scanAndRecoverImpl(): Promise<RecoveryResult[]> {
  const teams = await TeamRegistry.listTeams()
  const results: RecoveryResult[] = []

  log.info(`Scanning ${teams.length} team(s) for recovery`)

  for (const teamName of teams) {
    try {
      const result = await recoverTeamImpl(teamName)
      results.push(result)
    } catch (error) {
      log.error(`Failed to recover team "${teamName}": ${error}`)
      results.push({
        teamName,
        recoveredSessions: [],
        recoveryCount: 0,
      })
    }
  }

  const totalRecovered = results.reduce((sum, r) => sum + r.recoveryCount, 0)
  log.info(`Scan and recovery complete. Recovered ${totalRecovered} session(s) across ${teams.length} team(s)`)

  return results
}

/**
 * Mark a team as needing recovery
 * Stores recovery metadata for later reference
 */
async function markTeamForRecoveryImpl(teamName: string, reason: string): Promise<void> {
  const team = await TeamRegistry.getTeam(teamName)
  if (!team) {
    throw new Error(`Team "${teamName}" not found`)
  }

  const metadata: TeamRecoveryMetadata = {
    markedAt: Date.now(),
    reason,
    recoveryId: ulid(),
  }

  await saveRecoveryMetadata(teamName, metadata)

  log.info(`Team "${teamName}" marked for recovery: ${reason}`)

  // Notify team lead
  try {
    await TeamInbox.sendMessage(
      teamName,
      team.lead,
      "system",
      `Team "${teamName}" has been marked for recovery. Reason: ${reason}`,
      "system",
      {
        type: "recovery_marked",
        reason,
        markedAt: metadata.markedAt,
      }
    )
  } catch (error) {
    log.warn(`Failed to send recovery mark notification to lead: ${error}`)
  }
}

/**
 * Check if a team has recovery metadata
 */
async function hasRecoveryMetadataImpl(teamName: string): Promise<boolean> {
  const metadata = await loadRecoveryMetadata(teamName)
  return metadata !== null
}

/**
 * Get recovery metadata for a team
 */
async function getRecoveryMetadataImpl(teamName: string): Promise<TeamRecoveryMetadata | null> {
  return loadRecoveryMetadata(teamName)
}

/**
 * Clear recovery metadata for a team
 */
async function clearRecoveryMetadataImpl(teamName: string): Promise<void> {
  const recoveryPath = await getRecoveryPath(teamName)
  const exists = await Filesystem.exists(recoveryPath)
  if (exists) {
    await Filesystem.unlink(recoveryPath)
    log.info(`Cleared recovery metadata for team "${teamName}"`)
  }
}

// Namespace export for consistency with other team modules
export namespace TeamRecovery {
  export const scanAndRecover = scanAndRecoverImpl
  export const getRecoveryStatus = getRecoveryStatusImpl
  export const recoverTeam = recoverTeamImpl
  export const markTeamForRecovery = markTeamForRecoveryImpl
  export const hasRecoveryMetadata = hasRecoveryMetadataImpl
  export const getRecoveryMetadata = getRecoveryMetadataImpl
  export const clearRecoveryMetadata = clearRecoveryMetadataImpl
}

// Also export individual functions for direct use
export {
  scanAndRecoverImpl as scanAndRecover,
  getRecoveryStatusImpl as getRecoveryStatus,
  recoverTeamImpl as recoverTeam,
  markTeamForRecoveryImpl as markTeamForRecovery,
  hasRecoveryMetadataImpl as hasRecoveryMetadata,
  getRecoveryMetadataImpl as getRecoveryMetadata,
  clearRecoveryMetadataImpl as clearRecoveryMetadata,
}
