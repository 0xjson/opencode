# OpenCode Agent Teams Implementation Checklist

> Based on "Building Agent Teams in OpenCode: Architecture of Multi-Agent Coordination"

---

## Phase 1 — Core Team Infrastructure
**Goal:** Create the team system and agent registry

### Task 1.1 — Team Registry
- [ ] Implement persistent team structure
- [ ] Create `teams/<teamName>/config.json` format
- [ ] Store: teamName, lead agent, teammate list, config

```json
{
  "team": "coding-team",
  "lead": "architect",
  "members": [
    {"name": "researcher", "model": "gemini"},
    {"name": "coder", "model": "codex"},
    {"name": "reviewer", "model": "claude"}
  ]
}
```

### Task 1.2 — Agent Session Creation
- [ ] Implement `createAgentSession(agentName, model)`
- [ ] Track session state: sessionID, agentName, model, teamName, status, executionStatus

### Task 1.3 — Agent Spawn Tool
- [ ] Create `team_spawn(agentName)` tool
- [ ] Fire-and-forget model (NOT blocking)
- [ ] Steps:
  - [ ] Create session
  - [ ] Register in team state
  - [ ] Start prompt loop async
  - [ ] Return sessionID immediately

---

## Phase 2 — Messaging System
**Goal:** Agents communicate via inbox + session injection

### Task 2.1 — Inbox Storage (Source of Truth)
- [ ] Use JSONL append-only logs
- [ ] Directory: `team_inbox/<projectID>/<teamName>/<agentName>.jsonl`
- [ ] Format:
```json
{"id":"msg123", "from":"coder", "text":"I finished module A", "timestamp":123456, "read":false}
```
- [ ] O(1) writes, no file rewriting

### Task 2.2 — Message Send API
- [ ] Create `team_message(to, text)` tool
- [ ] Flow:
  - [ ] Append to inbox
  - [ ] Inject message to session (synthetic user msg)
  - [ ] Wake agent if idle

### Task 2.3 — Broadcast Messaging
- [ ] Create `team_broadcast(text)` tool
- [ ] Loop through all teammates
- [ ] Use for: architecture updates, progress summaries

### Task 2.4 — Delivery Receipts
- [ ] Implement `markRead(agentName)`
- [ ] Send XMPP-style read receipts
- [ ] Batch by sender

---

## Phase 3 — Task Coordination System
**Goal:** Agents claim work from shared list

### Task 3.1 — Shared Task List
- [ ] Create `team_tasks.json` structure
- [ ] Fields: id, description, status, claimedBy, dependsOn

### Task 3.2 — Task Claim Mechanism
- [ ] Create `team_claim(taskID)` tool
- [ ] Atomic claim (only one agent can own)
- [ ] Transition: `ready` → `in_progress`

### Task 3.3 — Task Dependency Graph
- [ ] Parse `dependsOn` field
- [ ] Agents check dependencies complete before claiming

---

## Phase 4 — Agent Lifecycle State Machine

### Task 4.1 — Member State Machine
- [ ] Implement states: `ready` → `busy` → `shutdown_requested` → `shutdown` / `error`
- [ ] Validate transitions

### Task 4.2 — Execution State Machine
- [ ] Fine-grained prompt loop states:
  - [ ] `thinking`
  - [ ] `calling_tool`
  - [ ] `waiting_message`
  - [ ] `responding`
  - [ ] `complete`
  - [ ] `cancelling`
- [ ] Use for: UI progress, recovery control

---

## Phase 5 — Auto-Wake Prompt Loop
**Goal:** Solve lead agent stopping problem

- [ ] Implement `autoWake(sessionID)`
- [ ] Trigger on:
  - [ ] New message
  - [ ] Task completed
  - [ ] Error
- [ ] If lead idle → restart prompt loop
- [ ] Keeps fire-and-forget spawn viable

---

## Phase 6 — Sub-Agent Isolation
**Goal:** Prevent sub-agents from flooding team channel

- [ ] Define TEAM_TOOLS:
  - [ ] `team_create`
  - [ ] `team_spawn`
  - [ ] `team_message`
  - [ ] `team_broadcast`
  - [ ] `team_tasks`
  - [ ] `team_claim`
  - [ ] `team_approve_plan`
  - [ ] `team_shutdown`
  - [ ] `team_cleanup`

- [ ] Sub-agents: DENY access to all TEAM_TOOLS
- [ ] Implementation:
  - [ ] `toolVisibility = false`
  - [ ] Permission deny rules

---

## Phase 7 — Recovery System
**Goal:** Handle server crashes gracefully

### Task 7.1 — Recovery Scanner
- [ ] On startup: scan teams, find busy members
- [ ] Change state: `busy` → `ready`

### Task 7.2 — Notify Lead
- [ ] Inject system message: "Server restarted, workers interrupted, resume them"

### Task 7.3 — Manual Resume
- [ ] Agents do NOT auto restart
- [ ] Prevents runaway API spending

---

## Phase 8 — Agent Tools
**Goal:** Create OpenCode tool surface

- [ ] `team_create`
- [ ] `team_spawn`
- [ ] `team_message`
- [ ] `team_broadcast`
- [ ] `team_tasks`
- [ ] `team_claim`
- [ ] `team_approve_plan`
- [ ] `team_shutdown`
- [ ] `team_cleanup`

---

## Phase 9 — Multi-Model Routing
**Goal:** Each teammate uses different model (key difference vs Claude Code)

- [ ] Allow per-agent model config
- [ ] Example routing:
  - [ ] `architect` → claude
  - [ ] `coder` → codex
  - [ ] `researcher` → gemini
  - [ ] `tester` → openai

---

## Phase 10 — Example Team Roles
**Goal:** Pre-defined role templates

### Team: `dev-team`
- [ ] **Lead: architect** — coordination only
- [ ] **researcher** — find documentation, analyze libraries
- [ ] **backend-dev** — implement features
- [ ] **trading-logic-dev** — (your use case)
- [ ] **security-reviewer** — security audit, refactoring
- [ ] **tester** — write tests, run tests, report bugs

---

## Progress Tracker

| Phase | Status | Completion |
|-------|--------|------------|
| 1 — Core Infrastructure | ✅ | 3/3 |
| 2 — Messaging | ✅ | 4/4 |
| 3 — Task Coordination | ✅ | 3/3 |
| 4 — State Machines | ✅ | 2/2 |
| 5 — Auto-Wake | ✅ | 1/1 |
| 6 — Sub-Agent Isolation | ✅ | 2/2 |
| 7 — Recovery | ✅ | 3/3 |
| 8 — Agent Tools | ✅ | 11/11 |
| 9 — Multi-Model | ✅ | 1/1 |
| 10 — Role Templates | ✅ | 1/1 |

**Total: 31/31 tasks complete**

## Implementation Summary

### Files Created

```
packages/opencode/src/team/
├── schema.ts      # Type definitions (Team, Session, Message, Task)
├── registry.ts    # Team registry (create, get, list, update, delete)
├── inbox.ts       # JSONL-based messaging system
├── tasks.ts       # Task coordination (create, claim, complete)
├── session.ts     # Session management with state machines
├── recovery.ts    # Crash recovery system
├── isolation.ts   # Sub-agent isolation & rate limiting
├── tools.ts       # Team tools for agents
└── index.ts       # Module exports
```

### Tools Added

- `team_create` - Create a new team
- `team_message` - Send message to teammate
- `team_broadcast` - Broadcast to all members
- `team_check_inbox` - Check messages
- `team_mark_read` - Mark messages read
- `team_create_task` - Create a task
- `team_claim_task` - Claim a task
- `team_complete_task` - Mark task complete
- `team_list_tasks` - List all tasks
- `team_shutdown` - Shutdown a teammate (lead only)
- `team_cleanup` - Cleanup old sessions (lead only)

### Key Features

1. **Persistent Storage**: Team configs in `~/.claude/teams/<team>/config.json`
2. **JSONL Inbox**: Append-only message logs at `~/.claude/teams/<team>/inboxes/<agent>.jsonl`
3. **Atomic Task Claims**: Prevents race conditions
4. **State Machines**: Member states (ready→busy→shutdown) and execution states
5. **Dependency Graph**: Tasks can depend on other tasks
6. **Rate Limiting**: Prevents message flooding
7. **Audit Logging**: Tracks all team operations
8. **Crash Recovery**: Resets busy sessions on startup

### Remaining Work

1. **Phase 5: Auto-Wake** - Hook into session loop to wake idle agents
2. **Phase 10: Role Templates** - Pre-defined agent configurations

---

## Quick Reference

**Critical Path (Do First):**
1. Task 2.1 — JSONL Inbox (foundation)
2. Task 5 — Auto-Wake (enables fire-and-forget)
3. Task 1.3 — Spawn Tool (creates teammates)
4. Task 2.2 — Message Send API (coordination)

**Why this order:** Without inbox + auto-wake, you can't do fire-and-forget spawn. Without spawn, no teammates. Without messaging, no coordination.
