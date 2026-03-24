# OpenCode Team Module

Multi-agent team coordination system for OpenCode. Enables teams of agents to collaborate on complex tasks with messaging, task coordination, and state management.

## Overview

The team module provides infrastructure for creating and managing teams of AI agents that can:
- Communicate via direct messages and broadcasts
- Coordinate work through a shared task list
- Track state through lifecycle management
- Recover gracefully from crashes

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Team System                             │
├─────────────┬─────────────┬─────────────┬─────────────────┤
│   Registry  │    Inbox    │    Tasks    │    Sessions     │
├─────────────┼─────────────┼─────────────┼─────────────────┤
│ config.json │  *.jsonl    │  tasks.json │  sessions.json  │
│             │  (append)   │             │                 │
└─────────────┴─────────────┴─────────────┴─────────────────┘
```

## Storage Layout

```
~/.claude/teams/
└── {team-name}/
    ├── config.json          # Team configuration
    ├── tasks.json           # Shared task list
    ├── sessions.json        # Agent session states
    └── inboxes/
        ├── {agent1}.jsonl   # Message inbox (append-only)
        └── {agent2}.jsonl
```

## Core Components

### 1. Team Registry (`registry.ts`)

Manages team creation, configuration, and persistence.

```typescript
// Create a team
await TeamRegistry.createTeam({
  team: "dev-team",
  lead: "architect",
  members: [
    { name: "coder", agentType: "general-purpose", model: "codex" },
    { name: "tester", agentType: "Explore" }
  ]
})

// Get team info
const team = await TeamRegistry.getTeam("dev-team")
```

### 2. Messaging (`inbox.ts`)

JSONL-based append-only message storage for O(1) writes.

```typescript
// Send direct message
await TeamInbox.sendMessage("dev-team", "coder", "architect", "Please implement login")

// Broadcast to team
await TeamInbox.broadcastMessage("dev-team", "architect", "Sprint planning in 5 minutes")

// Check inbox
const messages = await TeamInbox.getMessages("dev-team", "coder", { unreadOnly: true })
```

### 3. Task Coordination (`tasks.ts`)

Atomic task claiming with dependency graph support.

```typescript
// Create task with dependencies
const task = await TeamTasks.createTask("dev-team", "Implement API", {
  dependsOn: ["task-id-1", "task-id-2"]
})

// Claim task (atomic - only one agent succeeds)
const result = await TeamTasks.claimTask("dev-team", task.id, "coder")

// Complete task
await TeamTasks.completeTask("dev-team", task.id, "coder")
```

### 4. Session Management (`session.ts`)

State machine for agent lifecycle.

```typescript
// Create session
const session = await TeamSession.createSession("dev-team", "coder", "claude-opus")

// Update state
await TeamSession.updateSessionStatus("dev-team", session.sessionId, "busy")

// Execution states
await TeamSession.updateExecutionStatus("dev-team", session.sessionId, "calling_tool")
```

**Member States:**
- `ready` → `busy` → `shutdown_requested` → `shutdown`
- `ready` → `busy` → `error` (can recover to `ready`)

**Execution States:**
- `idle` → `thinking` → `calling_tool` → `responding` → `complete`

### 5. Recovery (`recovery.ts`)

Handles server crashes by resetting busy sessions.

```typescript
// Scan and recover all teams on startup
const results = await TeamRecovery.scanAndRecover()
// Automatically notifies team leads of recovered sessions
```

### 6. Isolation (`isolation.ts`)

Prevents sub-agents from using team coordination tools.

```typescript
// TEAM_TOOLS are restricted
const TEAM_TOOLS = new Set([
  "team_create", "team_spawn", "team_message",
  "team_broadcast", "team_claim_task", /* ... */
])

// Check if agent can use tool
const visibility = TeamIsolation.getToolVisibility(toolId, {
  isLead: false,
  isSubAgent: true,
  allowedTools: SUBAGENT_ALLOWED_TOOLS,
  deniedTools: TEAM_TOOLS
})
```

## Agent Tools

### Available to All Team Members

- `team_create` - Create a new team
- `team_message` - Send direct message
- `team_broadcast` - Broadcast to all members
- `team_check_inbox` - Check messages
- `team_mark_read` - Mark messages as read
- `team_create_task` - Create a task
- `team_claim_task` - Claim a task
- `team_complete_task` - Complete a task
- `team_list_tasks` - List all tasks

### Lead Only

- `team_shutdown` - Request teammate shutdown
- `team_cleanup` - Cleanup old sessions

## Usage Example

```typescript
// 1. Create team
await TeamRegistry.createTeam({
  team: "feature-team",
  lead: "architect",
  members: [
    { name: "backend", agentType: "general-purpose" },
    { name: "frontend", agentType: "general-purpose" },
    { name: "tester", agentType: "Explore" }
  ]
})

// 2. Lead creates tasks
const task1 = await TeamTasks.createTask("feature-team", "Design API schema")
const task2 = await TeamTasks.createTask("feature-team", "Implement backend", {
  dependsOn: [task1.id]
})

// 3. Backend agent claims task
const result = await TeamTasks.claimTask("feature-team", task2.id, "backend")
if (result.success) {
  // Work on task...
  await TeamTasks.completeTask("feature-team", task2.id, "backend")
}

// 4. Lead broadcasts progress
await TeamInbox.broadcastMessage("feature-team", "architect",
  "Backend complete! Frontend can start.")
```

## Security

- **Rate Limiting:** 10 messages/minute per agent (prevents flooding)
- **Tool Isolation:** Sub-agents cannot use TEAM_TOOLS
- **Permission Checks:** Lead-only tools verified at runtime
- **Audit Logging:** All team operations logged

## State Diagram

```
Member State Machine:

    ┌─────────┐
    │  ready  │◄─────────┐
    └────┬────┘          │
         │               │
    claim│task           │error
    ┌────▼────┐     ┌────┴────┐
    │  busy   ├────►│  error  │
    └────┬────┘     └────┬────┘
         │               │
   complete│         recover
    ┌────▼────┐     ┌────┘
    │  ready  │◄────┘
    └─────────┘

Execution State Machine:

    ┌──────┐
    │ idle │
    └──┬───┘
       │ prompt
    ┌──▼──────┐
    │thinking │
    └────┬────┘
         │ tool call
    ┌────▼───────┐
    │calling_tool│
    └────┬───────┘
         │
    ┌────▼─────┐
    │responding│
    └────┬─────┘
         │
    ┌────▼─────┐
    │ complete │
    └──────────┘
```

## Implementation Notes

- **JSONL Format:** Messages stored as newline-delimited JSON for O(1) append
- **Atomic Claims:** Task claims use optimistic locking - check status then update
- **No Auto-Restart:** Agents don't auto-restart after crash (prevents runaway API costs)
- **File-Based:** All state stored in JSON files for easy inspection/debugging
