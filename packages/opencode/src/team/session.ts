import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamInbox } from "./inbox"
import { Filesystem } from "../util/filesystem"
import { Log } from "../util/log"
import { ulid } from "ulid"

const log = Log.create({ service: "team.session" })

export namespace TeamSession {
  async function loadSessions(teamName: string): Promise<Team.Session[]> {
    const sessionsPath = await TeamRegistry.getSessionsPath(teamName)
    const exists = await Filesystem.exists(sessionsPath)
    if (!exists) return []

    try {
      const content = await Filesystem.readJson<Team.Session[]>(sessionsPath)
      return content || []
    } catch {
      return []
    }
  }

  async function saveSessions(teamName: string, sessions: Team.Session[]): Promise<void> {
    const sessionsPath = await TeamRegistry.getSessionsPath(teamName)
    await Filesystem.writeJson(sessionsPath, sessions)
  }

  export async function createSession(
    teamName: string,
    agentName: string,
    model: string
  ): Promise<Team.Session> {
    const sessions = await loadSessions(teamName)

    const session: Team.Session = {
      sessionId: ulid(),
      agentName,
      model,
      teamName,
      status: "ready",
      executionStatus: "idle",
      createdAt: Date.now(),
    }

    sessions.push(session)
    await saveSessions(teamName, sessions)

    log.info(`Created session "${session.sessionId}" for agent "${agentName}" in team "${teamName}"`)
    return session
  }

  export async function getSession(teamName: string, sessionId: string): Promise<Team.Session | null> {
    const sessions = await loadSessions(teamName)
    return sessions.find((s) => s.sessionId === sessionId) || null
  }

  export async function getSessionsByAgent(
    teamName: string,
    agentName: string
  ): Promise<Team.Session[]> {
    const sessions = await loadSessions(teamName)
    return sessions.filter((s) => s.agentName === agentName)
  }

  export async function getActiveSession(
    teamName: string,
    agentName: string
  ): Promise<Team.Session | null> {
    const sessions = await loadSessions(teamName)
    return (
      sessions.find((s) => s.agentName === agentName && s.status !== "shutdown" && s.status !== "error") ||
      null
    )
  }

  export async function updateSessionStatus(
    teamName: string,
    sessionId: string,
    status: Team.MemberState
  ): Promise<{ success: boolean; error?: string }> {
    const sessions = await loadSessions(teamName)
    const index = sessions.findIndex((s) => s.sessionId === sessionId)

    if (index === -1) {
      return { success: false, error: `Session "${sessionId}" not found` }
    }

    // Validate state transitions
    const currentStatus = sessions[index].status
    const validTransitions = getValidTransitions(currentStatus)

    if (!validTransitions.includes(status)) {
      return {
        success: false,
        error: `Invalid state transition from "${currentStatus}" to "${status}"`,
      }
    }

    sessions[index].status = status
    sessions[index].lastActivity = Date.now()
    await saveSessions(teamName, sessions)

    log.info(`Session "${sessionId}" status changed to "${status}"`)
    return { success: true }
  }

  export async function updateExecutionStatus(
    teamName: string,
    sessionId: string,
    executionStatus: Team.ExecutionState
  ): Promise<{ success: boolean; error?: string }> {
    const sessions = await loadSessions(teamName)
    const index = sessions.findIndex((s) => s.sessionId === sessionId)

    if (index === -1) {
      return { success: false, error: `Session "${sessionId}" not found` }
    }

    sessions[index].executionStatus = executionStatus
    sessions[index].lastActivity = Date.now()
    await saveSessions(teamName, sessions)

    return { success: true }
  }

  export async function requestShutdown(
    teamName: string,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    return updateSessionStatus(teamName, sessionId, "shutdown_requested")
  }

  export async function confirmShutdown(
    teamName: string,
    sessionId: string
  ): Promise<{ success: boolean; error?: string }> {
    return updateSessionStatus(teamName, sessionId, "shutdown")
  }

  export async function markError(
    teamName: string,
    sessionId: string,
    error: string
  ): Promise<void> {
    const result = await updateSessionStatus(teamName, sessionId, "error")
    if (result.success) {
      log.error(`Session "${sessionId}" marked with error: ${error}`)
    }
  }

  export async function getBusyMembers(teamName: string): Promise<Team.Session[]> {
    const sessions = await loadSessions(teamName)
    return sessions.filter((s) => s.status === "busy")
  }

  export async function getReadyMembers(teamName: string): Promise<Team.Session[]> {
    const sessions = await loadSessions(teamName)
    return sessions.filter((s) => s.status === "ready")
  }

  export async function getAllMembers(teamName: string): Promise<Team.Session[]> {
    return loadSessions(teamName)
  }

  export async function recoverFromCrash(teamName: string): Promise<Team.Session[]> {
    const sessions = await loadSessions(teamName)
    const busySessions = sessions.filter((s) => s.status === "busy")

    for (const session of busySessions) {
      session.status = "ready"
      session.executionStatus = "idle"
      session.lastActivity = Date.now()
    }

    if (busySessions.length > 0) {
      await saveSessions(teamName, sessions)
      log.info(`Recovered ${busySessions.length} busy sessions to ready state for team "${teamName}"`)
    }

    return busySessions
  }

  function getValidTransitions(currentState: Team.MemberState): Team.MemberState[] {
    switch (currentState) {
      case "ready":
        return ["busy", "shutdown_requested", "error"]
      case "busy":
        return ["ready", "shutdown_requested", "error"]
      case "shutdown_requested":
        return ["shutdown", "error", "busy"]
      case "shutdown":
        return [] // Terminal state
      case "error":
        return ["ready", "shutdown_requested"] // Can recover from error
      default:
        return []
    }
  }

  export async function cleanupOldSessions(
    teamName: string,
    maxAgeMs: number = 7 * 24 * 60 * 60 * 1000 // 7 days
  ): Promise<number> {
    const sessions = await loadSessions(teamName)
    const now = Date.now()

    const filtered = sessions.filter((s) => {
      if (s.status === "shutdown" || s.status === "error") {
        const lastActivity = s.lastActivity || s.createdAt
        return now - lastActivity < maxAgeMs
      }
      return true
    })

    const removed = sessions.length - filtered.length
    if (removed > 0) {
      await saveSessions(teamName, filtered)
      log.info(`Cleaned up ${removed} old sessions for team "${teamName}"`)
    }

    return removed
  }
}
