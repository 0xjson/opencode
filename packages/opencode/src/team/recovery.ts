import { Team } from "./schema"
import { TeamRegistry } from "./registry"
import { TeamSession } from "./session"
import { TeamInbox } from "./inbox"
import { Log } from "../util/log"

const log = Log.create({ service: "team.recovery" })

export namespace TeamRecovery {
  export interface RecoveryResult {
    teamName: string
    recoveredSessions: Team.Session[]
    messageInjected: boolean
  }

  export async function scanAndRecover(): Promise<RecoveryResult[]> {
    const teams = await TeamRegistry.listTeams()
    const results: RecoveryResult[] = []

    for (const teamName of teams) {
      const team = await TeamRegistry.getTeam(teamName)
      if (!team) continue

      const recoveredSessions = await TeamSession.recoverFromCrash(teamName)

      let messageInjected = false
      if (recoveredSessions.length > 0) {
        // Notify the lead agent about recovery
        await notifyLead(teamName, team.lead, recoveredSessions)
        messageInjected = true
      }

      results.push({
        teamName,
        recoveredSessions,
        messageInjected,
      })

      if (recoveredSessions.length > 0) {
        log.info(
          `Recovered ${recoveredSessions.length} sessions for team "${teamName}", notified lead "${team.lead}"`
        )
      }
    }

    return results
  }

  async function notifyLead(
    teamName: string,
    leadName: string,
    recoveredSessions: Team.Session[]
  ): Promise<void> {
    const sessionList = recoveredSessions
      .map((s) => `- ${s.agentName} (session: ${s.sessionId})`)
      .join("\n")

    const message = `🔄 **Server Recovery Notice**

The server was restarted while the following team members were busy:

${sessionList}

These sessions have been reset to "ready" state. As the team lead, you should:
1. Check with each agent about their last known progress
2. Reassign or resume tasks as needed
3. Consider spawning new sessions if work needs to continue

Note: Agents do NOT auto-restart to prevent runaway API spending.`

    await TeamInbox.sendMessage(teamName, leadName, "system", message, "system", {
      recovery: true,
      recoveredCount: recoveredSessions.length,
      recoveredSessionIds: recoveredSessions.map((s) => s.sessionId),
    })
  }

  export async function getRecoveryStatus(teamName: string): Promise<{
    healthy: boolean
    readyCount: number
    busyCount: number
    errorCount: number
    shutdownCount: number
    totalCount: number
  }> {
    const sessions = await TeamSession.getAllMembers(teamName)

    const readyCount = sessions.filter((s) => s.status === "ready").length
    const busyCount = sessions.filter((s) => s.status === "busy").length
    const errorCount = sessions.filter((s) => s.status === "error").length
    const shutdownCount = sessions.filter((s) => s.status === "shutdown").length

    return {
      healthy: errorCount === 0 && busyCount === 0,
      readyCount,
      busyCount,
      errorCount,
      shutdownCount,
      totalCount: sessions.length,
    }
  }

  export async function shouldBlockTaskClaim(teamName: string): Promise<boolean> {
    const status = await getRecoveryStatus(teamName)
    // Block task claims if there are error states that haven't been resolved
    return status.errorCount > 0
  }
}
