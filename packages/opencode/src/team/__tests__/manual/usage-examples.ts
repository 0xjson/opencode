/**
 * Agent Teams Usage Examples
 *
 * These examples demonstrate common patterns for using the team module.
 * Run with: npx tsx usage-examples.ts
 */

import {
  Team,
  TeamRegistry,
  TeamInbox,
  TeamTasks,
  TeamSession,
} from "../../"

// ============================================================================
// Example 1: Basic Team Setup
// ============================================================================

async function example1_CreateTeam() {
  console.log("=== Example 1: Create a Development Team ===")

  // Create a team with a lead and multiple specialists
  await TeamRegistry.createTeam({
    team: "web-app-team",
    lead: "tech-lead",
    description: "Team building the new web application",
    members: [
      { name: "backend-dev", agentType: "general-purpose", model: "claude-sonnet" },
      { name: "frontend-dev", agentType: "general-purpose", model: "claude-sonnet" },
      { name: "ui-designer", agentType: "Explore" },
      { name: "qa-tester", agentType: "general-purpose" },
    ],
  })

  console.log("✓ Team created successfully")

  // List all teams
  const teams = await TeamRegistry.listTeams()
  console.log("Teams:", teams)
}

// ============================================================================
// Example 2: Task Workflow with Dependencies
// ============================================================================

async function example2_TaskWorkflow() {
  console.log("\n=== Example 2: Task Workflow ===")

  // Create tasks with dependencies
  const designTask = await TeamTasks.createTask("web-app-team", "Design database schema", {
    metadata: { priority: "high" },
  })
  console.log(`Created design task: ${designTask.id}`)

  const backendTask = await TeamTasks.createTask("web-app-team", "Implement API endpoints", {
    dependsOn: [designTask.id],
    metadata: { priority: "high" },
  })
  console.log(`Created backend task: ${backendTask.id}`)

  const frontendTask = await TeamTasks.createTask("web-app-team", "Build React components", {
    dependsOn: [backendTask.id],
  })
  console.log(`Created frontend task: ${frontendTask.id}`)

  const testTask = await TeamTasks.createTask("web-app-team", "Write integration tests", {
    dependsOn: [backendTask.id, frontendTask.id],
  })
  console.log(`Created test task: ${testTask.id}`)

  // Backend dev claims the design task (available immediately)
  const claim1 = await TeamTasks.claimTask("web-app-team", designTask.id, "backend-dev")
  console.log(`Claim design task: ${claim1.success ? "✓" : "✗"} ${claim1.error || ""}`)

  // Frontend dev tries to claim frontend task (should fail - dependencies not met)
  const claim2 = await TeamTasks.claimTask("web-app-team", frontendTask.id, "frontend-dev")
  console.log(`Claim frontend task (should fail): ${claim2.success ? "✓" : "✗"} ${claim2.error || ""}`)

  // Backend completes design task
  const complete1 = await TeamTasks.completeTask("web-app-team", designTask.id, "backend-dev")
  console.log(`Complete design task: ${complete1.success ? "✓" : "✗"}`)

  // Now backend can claim the backend task
  const claim3 = await TeamTasks.claimTask("web-app-team", backendTask.id, "backend-dev")
  console.log(`Claim backend task: ${claim3.success ? "✓" : "✗"}`)

  // List all tasks
  const allTasks = await TeamTasks.getTasks("web-app-team")
  console.log("\nAll tasks:")
  allTasks.forEach((t) => {
    console.log(`  ${t.id}: ${t.status} ${t.claimedBy ? `(claimed by ${t.claimedBy})` : ""}`)
  })
}

// ============================================================================
// Example 3: Messaging and Coordination
// ============================================================================

async function example3_Messaging() {
  console.log("\n=== Example 3: Team Messaging ===")

  // Lead broadcasts to the team
  await TeamInbox.broadcastMessage(
    "web-app-team",
    "tech-lead",
    "🚀 Sprint planning: We have 3 new tasks ready. Please check the task list."
  )
  console.log("✓ Broadcast sent")

  // Backend dev checks inbox
  const backendMessages = await TeamInbox.getMessages("web-app-team", "backend-dev", {
    unreadOnly: true,
  })
  console.log(`Backend dev has ${backendMessages.length} unread messages`)

  // Backend sends direct message to frontend
  await TeamInbox.sendMessage(
    "web-app-team",
    "frontend-dev",
    "backend-dev",
    "Hi! The /api/users endpoint is ready for you to integrate."
  )
  console.log("✓ Direct message sent")

  // Frontend checks inbox
  const frontendMessages = await TeamInbox.getMessages("web-app-team", "frontend-dev", {
    unreadOnly: true,
  })
  console.log(`Frontend dev has ${frontendMessages.length} unread messages`)
  frontendMessages.forEach((m) => {
    console.log(`  From ${m.from}: ${m.text.substring(0, 50)}...`)
  })

  // Mark messages as read
  const markedCount = await TeamInbox.markRead(
    "web-app-team",
    "frontend-dev",
    frontendMessages.map((m) => m.id)
  )
  console.log(`✓ Marked ${markedCount} messages as read`)
}

// ============================================================================
// Example 4: Session Management
// ============================================================================

async function example4_SessionManagement() {
  console.log("\n=== Example 4: Session Management ===")

  // Create sessions for each team member
  const backendSession = await TeamSession.createSession("web-app-team", "backend-dev", "claude-sonnet")
  console.log(`Created session: ${backendSession.sessionId}`)

  // Update session status when agent starts working
  await TeamSession.updateSessionStatus("web-app-team", backendSession.sessionId, "busy")
  console.log("✓ Session status updated to 'busy'")

  // Update execution status during work
  await TeamSession.updateExecutionStatus("web-app-team", backendSession.sessionId, "thinking")
  console.log("✓ Execution status updated to 'thinking'")

  // Query active sessions
  const activeSessions = await TeamSession.getActiveSession("web-app-team", "backend-dev")
  console.log(`Active session: ${activeSessions?.sessionId}`)

  // Get all busy members
  const busyMembers = await TeamSession.getBusyMembers("web-app-team")
  console.log(`Busy members: ${busyMembers.map((s) => s.agentName).join(", ")}`)
}

// ============================================================================
// Example 5: Recovery from Crash
// ============================================================================

// NOTE: TeamRecovery is not yet implemented
// async function example5_CrashRecovery() {
//   console.log("\n=== Example 5: Crash Recovery ===")
//
//   // Simulate a crash scenario
//   // (In real usage, this would happen on server startup)
//
//   const results = await TeamRecovery.scanAndRecover()
//   console.log(`Recovery scan complete. Recovered ${results.length} teams.`)
//
//   results.forEach((result) => {
//     console.log(`  Team: ${result.teamName}`)
//     console.log(`    Recovered sessions: ${result.recoveredSessions.length}`)
//     console.log(`    Lead notified: ${result.messageInjected}`)
//   })
//
//   // Check recovery status
//   const status = await TeamRecovery.getRecoveryStatus("web-app-team")
//   console.log("\nTeam health status:")
//   console.log(`  Healthy: ${status.healthy}`)
//   console.log(`  Ready: ${status.readyCount}`)
//   console.log(`  Busy: ${status.busyCount}`)
//   console.log(`  Error: ${status.errorCount}`)
// }

// ============================================================================
// Example 6: Sub-Agent Isolation
// ============================================================================

// NOTE: TeamIsolation is not yet implemented
// async function example6_Isolation() {
//   console.log("\n=== Example 6: Sub-Agent Isolation ===")
//
//   // Lead can use all tools
//   const leadConfig = TeamIsolation.createLeadIsolation()
//   console.log("Lead tool visibility:")
//   console.log(`  team_message: ${TeamIsolation.getToolVisibility("team_message", leadConfig)}`)
//   console.log(`  read: ${TeamIsolation.getToolVisibility("read", leadConfig)}`)
//
//   // Sub-agent has restricted access
//   const subAgentConfig = TeamIsolation.createSubAgentIsolation("backend-dev")
//   console.log("\nSub-agent tool visibility:")
//   console.log(`  team_message: ${TeamIsolation.getToolVisibility("team_message", subAgentConfig)}`)
//   console.log(`  read: ${TeamIsolation.getToolVisibility("read", subAgentConfig)}`)
//   console.log(`  bash: ${TeamIsolation.getToolVisibility("bash", subAgentConfig)}`)
//
//   // Validate tool calls
//   const validation1 = TeamIsolation.validateToolCall("team_message", subAgentConfig)
//   console.log(`\nValidation for team_message: ${validation1.allowed ? "allowed" : "denied"}`)
//   if (!validation1.allowed) console.log(`  Reason: ${validation1.reason}`)
//
//   const validation2 = TeamIsolation.validateToolCall("read", subAgentConfig)
//   console.log(`Validation for read: ${validation2.allowed ? "allowed" : "denied"}`)
//
//   // Rate limiting
//   const rateCheck1 = TeamIsolation.checkRateLimit("backend-dev")
//   console.log(`\nRate limit check 1: ${rateCheck1.allowed ? "allowed" : "denied"}`)
//
//   // Simulate burst of messages
//   for (let i = 0; i < 12; i++) {
//     TeamIsolation.checkRateLimit("backend-dev")
//   }
//
//   const rateCheck2 = TeamIsolation.checkRateLimit("backend-dev")
//   console.log(`Rate limit check after burst: ${rateCheck2.allowed ? "allowed" : "denied"}`)
//   if (!rateCheck2.allowed) console.log(`  Retry after: ${rateCheck2.retryAfterMs}ms`)
// }

// ============================================================================
// Example 7: Complete Workflow
// ============================================================================

async function example7_CompleteWorkflow() {
  console.log("\n=== Example 7: Complete Workflow ===")

  // This example shows a realistic workflow:
  // 1. Lead creates tasks
  // 2. Team members claim and complete tasks
  // 3. Coordination via messages
  // 4. Cleanup

  // Create team
  await TeamRegistry.createTeam({
    team: "api-migration",
    lead: "lead-dev",
    members: [
      { name: "db-migrator", agentType: "general-purpose" },
      { name: "api-updater", agentType: "general-purpose" },
      { name: "validator", agentType: "Explore" },
    ],
  })
  console.log("✓ Created migration team")

  // Create task dependency chain
  const analyzeTask = await TeamTasks.createTask("api-migration", "Analyze current database schema")
  const migrateTask = await TeamTasks.createTask("api-migration", "Create migration scripts", {
    dependsOn: [analyzeTask.id],
  })
  const updateTask = await TeamTasks.createTask("api-migration", "Update API endpoints", {
    dependsOn: [migrateTask.id],
  })
  const validateTask = await TeamTasks.createTask("api-migration", "Validate data integrity", {
    dependsOn: [updateTask.id],
  })
  console.log("✓ Created 4 tasks with dependencies")

  // Lead broadcasts kickoff
  await TeamInbox.broadcastMessage("api-migration", "lead-dev", "🚀 Migration project started!")

  // DB migrator claims analysis task
  const claim1 = await TeamTasks.claimTask("api-migration", analyzeTask.id, "db-migrator")
  if (claim1.success) {
    console.log("✓ db-migrator claimed analysis task")

    // Complete and notify
    await TeamTasks.completeTask("api-migration", analyzeTask.id, "db-migrator")
    await TeamInbox.sendMessage("api-migration", "lead-dev", "db-migrator", "Schema analysis complete!")
    console.log("✓ Analysis complete")
  }

  // API updater claims migration task (now available)
  const claim2 = await TeamTasks.claimTask("api-migration", migrateTask.id, "api-updater")
  if (claim2.success) {
    console.log("✓ api-updater claimed migration task")
    await TeamTasks.completeTask("api-migration", migrateTask.id, "api-updater")
    console.log("✓ Migration scripts complete")
  }

  // List remaining tasks
  const pendingTasks = await TeamTasks.getTasks("api-migration", { status: "pending" })
  const inProgressTasks = await TeamTasks.getTasks("api-migration", { status: "in_progress" })
  const completedTasks = await TeamTasks.getTasks("api-migration", { status: "completed" })

  console.log("\nTask summary:")
  console.log(`  Pending: ${pendingTasks.length}`)
  console.log(`  In Progress: ${inProgressTasks.length}`)
  console.log(`  Completed: ${completedTasks.length}`)

  // Cleanup old sessions (lead only)
  // await TeamSession.cleanupOldSessions("api-migration", 7 * 24 * 60 * 60 * 1000)
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  try {
    await example1_CreateTeam()
    await example2_TaskWorkflow()
    await example3_Messaging()
    await example4_SessionManagement()
    // await example5_CrashRecovery() // NOTE: TeamRecovery not yet implemented
    // await example6_Isolation() // NOTE: TeamIsolation not yet implemented
    await example7_CompleteWorkflow()

    console.log("\n✅ All examples completed successfully!")
  } catch (error) {
    console.error("❌ Example failed:", error)
  }
}

// Uncomment to run:
// main()

export {
  example1_CreateTeam,
  example2_TaskWorkflow,
  example3_Messaging,
  example4_SessionManagement,
  // example5_CrashRecovery, // NOTE: TeamRecovery not yet implemented
  // example6_Isolation, // NOTE: TeamIsolation not yet implemented
  example7_CompleteWorkflow,
}
