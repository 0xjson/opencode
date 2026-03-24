# Agent Teams API Reference

Complete API documentation for the OpenCode team module.

## Table of Contents

- [Schema Types](#schema-types)
- [Team Registry](#team-registry)
- [Team Inbox](#team-inbox)
- [Team Tasks](#team-tasks)
- [Team Session](#team-session)
- [Team Recovery](#team-recovery)
- [Team Isolation](#team-isolation)
- [Tools](#tools)

---

## Schema Types

### Team.Config

Team configuration object.

```typescript
interface Config {
  team: string           // Unique team name
  lead: string           // Lead agent name
  description?: string   // Optional description
  members: MemberConfig[]
  createdAt?: number     // Timestamp (auto-set)
}
```

### Team.MemberConfig

Configuration for a team member.

```typescript
interface MemberConfig {
  name: string           // Agent name
  model?: string         // Model identifier (e.g., "claude", "codex")
  prompt?: string        // Custom system prompt
  agentType: string      // "general-purpose" | "Explore" | "Plan"
  color?: string         // UI color
  planModeRequired?: boolean
}
```

### Team.Session

Agent session state.

```typescript
interface Session {
  sessionId: string      // Unique session ID
  agentName: string      // Agent name
  model: string          // Model used
  teamName: string       // Team name
  status: MemberState    // Current member state
  executionStatus: ExecutionState
  createdAt: number
  lastActivity?: number
}
```

### Team.MemberState

Member lifecycle states.

```typescript
type MemberState =
  | "ready"              // Available for work
  | "busy"               // Working on task
  | "shutdown_requested" // Shutdown pending
  | "shutdown"           // Terminal state
  | "error"              // Error state (recoverable)
```

### Team.ExecutionState

Execution progress states.

```typescript
type ExecutionState =
  | "idle"
  | "thinking"
  | "calling_tool"
  | "waiting_message"
  | "responding"
  | "complete"
  | "cancelling"
```

### Team.Message

Inbox message format.

```typescript
interface Message {
  id: string
  from: string
  to: string
  text: string
  timestamp: number
  read: boolean
  type: "message" | "broadcast" | "system" | "receipt"
  metadata?: Record<string, any>
}
```

### Team.Task

Task object.

```typescript
interface Task {
  id: string
  description: string
  status: TaskStatus
  claimedBy: string | null
  dependsOn: string[]
  createdAt: number
  completedAt?: number
  metadata?: Record<string, any>
}
```

### Team.TaskStatus

```typescript
type TaskStatus =
  | "pending"      // Available to claim
  | "in_progress"  // Claimed and being worked on
  | "completed"    // Done
  | "failed"       // Failed
  | "blocked"      // Dependencies incomplete
```

---

## Team Registry

Namespace: `TeamRegistry`

### createTeam(config: Team.Config): Promise<void>

Creates a new team.

```typescript
await TeamRegistry.createTeam({
  team: "my-team",
  lead: "architect",
  members: [
    { name: "coder", agentType: "general-purpose" }
  ]
})
```

**Throws:** Error if team already exists.

---

### getTeam(teamName: string): Promise<Team.Config | null>

Gets team configuration.

```typescript
const team = await TeamRegistry.getTeam("my-team")
if (team) {
  console.log(team.lead) // "architect"
}
```

---

### listTeams(): Promise<string[]>

Lists all team names.

```typescript
const teams = await TeamRegistry.listTeams()
// ["my-team", "other-team"]
```

---

### teamExists(teamName: string): Promise<boolean>

Checks if team exists.

```typescript
if (await TeamRegistry.teamExists("my-team")) {
  // ...
}
```

---

### updateTeam(teamName: string, updates: Partial<Team.Config>): Promise<void>

Updates team configuration.

```typescript
await TeamRegistry.updateTeam("my-team", {
  description: "Updated description"
})
```

---

### deleteTeam(teamName: string): Promise<void>

Deletes a team and all its data.

```typescript
await TeamRegistry.deleteTeam("my-team")
```

---

## Team Inbox

Namespace: `TeamInbox`

### sendMessage(teamName, to, from, text, type?, metadata?): Promise<Team.Message>

Sends a direct message.

```typescript
const message = await TeamInbox.sendMessage(
  "my-team",
  "coder",
  "lead",
  "Please implement the login feature"
)
console.log(message.id) // Message ID
```

| Parameter | Type | Description |
|-----------|------|-------------|
| teamName | string | Team name |
| to | string | Recipient agent name |
| from | string | Sender agent name |
| text | string | Message content |
| type | MessageType | Optional: "message", "broadcast", "system", "receipt" |
| metadata | object | Optional metadata |

---

### broadcastMessage(teamName, from, text, excludeSender?): Promise<Team.Message[]>

Broadcasts to all team members.

```typescript
const messages = await TeamInbox.broadcastMessage(
  "my-team",
  "lead",
  "Standup in 5 minutes"
)
console.log(`Sent to ${messages.length} members`)
```

---

### getMessages(teamName, agentName, options?): Promise<Team.Message[]>

Gets messages from an agent's inbox.

```typescript
const messages = await TeamInbox.getMessages("my-team", "coder", {
  unreadOnly: true,
  since: Date.now() - 3600000, // Last hour
  limit: 10
})
```

**Options:**
- `unreadOnly`: Only return unread messages
- `since`: Only messages after timestamp
- `limit`: Maximum messages to return

---

### markRead(teamName, agentName, messageIds?): Promise<number>

Marks messages as read.

```typescript
// Mark specific messages
const count = await TeamInbox.markRead("my-team", "coder", ["msg1", "msg2"])

// Mark all as read
const count = await TeamInbox.markRead("my-team", "coder")
```

**Returns:** Number of messages marked as read.

---

### getUnreadCount(teamName, agentName): Promise<number>

Gets unread message count.

```typescript
const count = await TeamInbox.getUnreadCount("my-team", "coder")
console.log(`${count} unread messages`)
```

---

### sendReceipt(teamName, to, from, messageIds): Promise<Team.Message>

Sends a read receipt.

```typescript
await TeamInbox.sendReceipt("my-team", "lead", "coder", ["msg1", "msg2"])
```

---

## Team Tasks

Namespace: `TeamTasks`

### createTask(teamName, description, options?): Promise<Team.Task>

Creates a new task.

```typescript
const task = await TeamTasks.createTask("my-team", "Implement auth", {
  dependsOn: ["task-id-1"],
  metadata: { priority: "high" }
})
console.log(task.id) // New task ID
```

---

### claimTask(teamName, taskId, agentName): Promise<ClaimResult>

Atomically claims a task.

```typescript
const result = await TeamTasks.claimTask("my-team", "task-123", "coder")

if (result.success) {
  console.log("Task claimed!")
  console.log(result.task) // Task object
} else {
  console.log("Failed:", result.error)
}
```

**ClaimResult:**
```typescript
interface ClaimResult {
  success: boolean
  task?: Team.Task
  error?: string
}
```

**Claim failures:**
- Task not found
- Task not in "pending" status
- Dependencies incomplete

---

### completeTask(teamName, taskId, agentName): Promise<CompleteResult>

Marks a task as completed.

```typescript
const result = await TeamTasks.completeTask("my-team", "task-123", "coder")
if (result.success) {
  console.log("Task completed at:", result.task?.completedAt)
}
```

---

### failTask(teamName, taskId, agentName, reason?): Promise<FailResult>

Marks a task as failed.

```typescript
await TeamTasks.failTask("my-team", "task-123", "coder", "API timeout")
```

---

### getTask(teamName, taskId): Promise<Team.Task | null>

Gets a specific task.

```typescript
const task = await TeamTasks.getTask("my-team", "task-123")
```

---

### getTasks(teamName, options?): Promise<Team.Task[]>

Gets tasks with optional filtering.

```typescript
// All tasks
const all = await TeamTasks.getTasks("my-team")

// By status
const pending = await TeamTasks.getTasks("my-team", { status: "pending" })

// By claimant
const mine = await TeamTasks.getTasks("my-team", { claimedBy: "coder" })
```

---

### releaseTask(teamName, taskId, agentName): Promise<ReleaseResult>

Releases a claimed task back to pending.

```typescript
const result = await TeamTasks.releaseTask("my-team", "task-123", "coder")
```

---

### getBlockedTasks(teamName): Promise<Team.Task[]>

Gets tasks blocked by incomplete dependencies.

```typescript
const blocked = await TeamTasks.getBlockedTasks("my-team")
```

---

### getAvailableTasks(teamName): Promise<Team.Task[]>

Gets tasks ready to be claimed (pending + dependencies met).

```typescript
const available = await TeamTasks.getAvailableTasks("my-team")
```

---

## Team Session

Namespace: `TeamSession`

### createSession(teamName, agentName, model): Promise<Team.Session>

Creates a new session.

```typescript
const session = await TeamSession.createSession("my-team", "coder", "claude-opus")
console.log(session.sessionId)
```

---

### getSession(teamName, sessionId): Promise<Team.Session | null>

Gets a session by ID.

```typescript
const session = await TeamSession.getSession("my-team", "sess-123")
```

---

### getSessionsByAgent(teamName, agentName): Promise<Team.Session[]>

Gets all sessions for an agent.

```typescript
const sessions = await TeamSession.getSessionsByAgent("my-team", "coder")
```

---

### getActiveSession(teamName, agentName): Promise<Team.Session | null>

Gets the active (non-shutdown) session for an agent.

```typescript
const active = await TeamSession.getActiveSession("my-team", "coder")
```

---

### updateSessionStatus(teamName, sessionId, status): Promise<UpdateResult>

Updates member state with validation.

```typescript
const result = await TeamSession.updateSessionStatus("my-team", "sess-123", "busy")
if (!result.success) {
  console.log("Invalid transition:", result.error)
}
```

**Valid transitions:**
- `ready` → `busy`, `shutdown_requested`, `error`
- `busy` → `ready`, `shutdown_requested`, `error`
- `shutdown_requested` → `shutdown`, `error`, `busy`
- `error` → `ready`, `shutdown_requested`

---

### updateExecutionStatus(teamName, sessionId, executionStatus): Promise<UpdateResult>

Updates execution state.

```typescript
await TeamSession.updateExecutionStatus("my-team", "sess-123", "calling_tool")
```

---

### requestShutdown(teamName, sessionId): Promise<UpdateResult>

Requests shutdown.

```typescript
await TeamSession.requestShutdown("my-team", "sess-123")
```

---

### confirmShutdown(teamName, sessionId): Promise<UpdateResult>

Confirms shutdown complete.

```typescript
await TeamSession.confirmShutdown("my-team", "sess-123")
```

---

### markError(teamName, sessionId, error): Promise<void>

Marks session with error.

```typescript
await TeamSession.markError("my-team", "sess-123", "Connection timeout")
```

---

### getBusyMembers(teamName): Promise<Team.Session[]>

Gets all busy members.

```typescript
const busy = await TeamSession.getBusyMembers("my-team")
```

---

### getReadyMembers(teamName): Promise<Team.Session[]>

Gets all ready members.

```typescript
const ready = await TeamSession.getReadyMembers("my-team")
```

---

### getAllMembers(teamName): Promise<Team.Session[]>

Gets all members.

```typescript
const all = await TeamSession.getAllMembers("my-team")
```

---

### recoverFromCrash(teamName): Promise<Team.Session[]>

Recovers busy sessions after crash.

```typescript
const recovered = await TeamSession.recoverFromCrash("my-team")
console.log(`Recovered ${recovered.length} sessions`)
```

**Note:** Resets `busy` → `ready` state.

---

### cleanupOldSessions(teamName, maxAgeMs): Promise<number>

Removes old shutdown/error sessions.

```typescript
// Remove sessions older than 7 days
const removed = await TeamSession.cleanupOldSessions(
  "my-team",
  7 * 24 * 60 * 60 * 1000
)
```

---

## Team Recovery

Namespace: `TeamRecovery`

### scanAndRecover(): Promise<RecoveryResult[]>

Scans all teams and recovers from crashes.

```typescript
const results = await TeamRecovery.scanAndRecover()

for (const result of results) {
  console.log(`Team: ${result.teamName}`)
  console.log(`  Recovered: ${result.recoveredSessions.length}`)
  console.log(`  Notified: ${result.messageInjected}`)
}
```

**RecoveryResult:**
```typescript
interface RecoveryResult {
  teamName: string
  recoveredSessions: Team.Session[]
  messageInjected: boolean
}
```

---

### getRecoveryStatus(teamName): Promise<RecoveryStatus>

Gets team health status.

```typescript
const status = await TeamRecovery.getRecoveryStatus("my-team")
console.log(status.healthy) // true/false
console.log(status.readyCount)
console.log(status.busyCount)
console.log(status.errorCount)
```

---

### shouldBlockTaskClaim(teamName): Promise<boolean>

Checks if task claiming should be blocked (errors present).

```typescript
if (await TeamRecovery.shouldBlockTaskClaim("my-team")) {
  console.log("Cannot claim tasks - resolve errors first")
}
```

---

## Team Isolation

Namespace: `TeamIsolation`

### TEAM_TOOLS: Set<string>

Tools restricted from sub-agents.

```typescript
import { TEAM_TOOLS } from "./isolation"

if (TEAM_TOOLS.has("team_message")) {
  // This tool is restricted
}
```

---

### SUBAGENT_ALLOWED_TOOLS: Set<string>

Tools sub-agents CAN use.

```typescript
import { SUBAGENT_ALLOWED_TOOLS } from "./isolation"
// Contains: read, write, edit, bash, glob, grep, skill, etc.
```

---

### getToolVisibility(toolId, config): boolean

Checks if tool is visible to agent.

```typescript
const visible = TeamIsolation.getToolVisibility("team_message", {
  isLead: false,
  isSubAgent: true,
  allowedTools: SUBAGENT_ALLOWED_TOOLS,
  deniedTools: TEAM_TOOLS
})
// false - sub-agents can't use team_message
```

---

### filterTools(tools, config): T[]

Filters tool list based on visibility.

```typescript
const visibleTools = TeamIsolation.filterTools(allTools, {
  isLead: false,
  isSubAgent: true,
  allowedTools: SUBAGENT_ALLOWED_TOOLS,
  deniedTools: TEAM_TOOLS
})
```

---

### validateToolCall(toolId, config): ValidationResult

Validates a tool call with reason.

```typescript
const result = TeamIsolation.validateToolCall("team_message", subAgentConfig)

if (!result.allowed) {
  console.log(result.reason)
  // "Sub-agents cannot use TEAM_TOOLS..."
}
```

---

### createSubAgentIsolation(agentName): IsolationConfig

Creates isolation config for sub-agent.

```typescript
const config = TeamIsolation.createSubAgentIsolation("coder")
// { isLead: false, isSubAgent: true, ... }
```

---

### createLeadIsolation(): IsolationConfig

Creates isolation config for lead.

```typescript
const config = TeamIsolation.createLeadIsolation()
// { isLead: true, isSubAgent: false, ... }
```

---

### checkRateLimit(agentName): RateLimitResult

Checks message rate limit.

```typescript
const result = TeamIsolation.checkRateLimit("coder")

if (result.allowed) {
  // Send message
} else {
  console.log(`Retry after ${result.retryAfterMs}ms`)
}
```

**Rate limits:** 10 messages per minute per agent.

---

### resetRateLimit(agentName): void

Resets rate limit for an agent.

```typescript
TeamIsolation.resetRateLimit("coder")
```

---

### auditLog(operation, agentName, teamName, details?): void

Logs team operation for audit.

```typescript
TeamIsolation.auditLog("task_claim", "coder", "my-team", {
  taskId: "task-123"
})
```

---

## Tools

Tools are used by agents to interact with the team system.

### team_create

Creates a new team.

**Parameters:**
```typescript
{
  team: string
  description?: string
  lead: string
  members: Array<{
    name: string
    model?: string
    agentType: "general-purpose" | "Explore" | "Plan"
  }>
}
```

**Returns:**
```typescript
{
  title: "Team Created"
  output: string
  metadata: {
    team: string
    members: string[]
  }
}
```

---

### team_message

Sends a direct message.

**Parameters:**
```typescript
{
  team: string
  to: string
  text: string
}
```

---

### team_broadcast

Broadcasts to all members.

**Parameters:**
```typescript
{
  team: string
  text: string
}
```

---

### team_check_inbox

Checks messages.

**Parameters:**
```typescript
{
  team: string
  unreadOnly?: boolean // default: true
  limit?: number
}
```

---

### team_mark_read

Marks messages as read.

**Parameters:**
```typescript
{
  team: string
  messageIds?: string[] // Omit to mark all
}
```

---

### team_create_task

Creates a task.

**Parameters:**
```typescript
{
  team: string
  description: string
  dependsOn?: string[]
}
```

---

### team_claim_task

Claims a task.

**Parameters:**
```typescript
{
  team: string
  taskId: string
}
```

**Returns:**
```typescript
{
  title: "Task Claimed" | "Claim Failed"
  output: string
  metadata: {
    success: boolean
    taskId: string
    status?: string
    error?: string
  }
}
```

---

### team_complete_task

Completes a task.

**Parameters:**
```typescript
{
  team: string
  taskId: string
}
```

---

### team_list_tasks

Lists tasks.

**Parameters:**
```typescript
{
  team: string
  status?: "pending" | "in_progress" | "completed" | "failed" | "blocked"
}
```

---

### team_shutdown

Shuts down a teammate (lead only).

**Parameters:**
```typescript
{
  team: string
  agent: string
}
```

---

### team_cleanup

Cleans up old sessions (lead only).

**Parameters:**
```typescript
{
  team: string
  maxAgeDays?: number // default: 7
}
```

---

## Error Handling

All async functions may throw errors for:
- File system issues
- Invalid state transitions
- Permission violations

Always wrap calls in try/catch:

```typescript
try {
  await TeamTasks.claimTask("my-team", "task-123", "coder")
} catch (error) {
  console.error("Failed to claim task:", error.message)
}
```

## Storage Format

### Config (JSON)

```json
{
  "team": "my-team",
  "lead": "architect",
  "description": "...",
  "members": [...],
  "createdAt": 1704067200000
}
```

### Inbox (JSONL)

```jsonl
{"id":"msg1","from":"lead","to":"coder","text":"...","timestamp":123,"read":false}
{"id":"msg2","from":"lead","to":"coder","text":"...","timestamp":124,"read":true}
```

### Tasks (JSON)

```json
[
  {"id":"task1","description":"...","status":"completed","claimedBy":"coder",...},
  {"id":"task2","description":"...","status":"in_progress","claimedBy":"tester",...}
]
```

### Sessions (JSON)

```json
[
  {"sessionId":"sess1","agentName":"coder","status":"busy","executionStatus":"thinking",...}
]
```
