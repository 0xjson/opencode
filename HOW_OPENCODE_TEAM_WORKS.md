# How opencode-team Works - Detailed Analysis

## Overview

The `opencode-team` command is a **wrapper script** that launches OpenCode from source with team support enabled. The actual team functionality is implemented in the `/packages/opencode/src/team/` module.

## The opencode-team Command

**Location:** `~/.local/bin/opencode-team`

This is a bash script that:
1. Saves the original working directory (`OPENCODE_ORIGINAL_CWD`)
2. Finds the OpenCode source directory
3. Runs `bun ./src/index.ts` to launch OpenCode

**Source:** `/home/json/projects/opencode/packages/opencode/src/index.ts`

## Team System Architecture

### Directory Structure
```
~/.opencode/teams/<team-name>/
├── config.json          # Team configuration (lead, members, etc.)
├── tasks.json           # Task queue with status
├── sessions.json        # Active agent sessions
└── inboxes/
    ├── <agent1>.jsonl   # Message inbox for agent1
    ├── <agent2>.jsonl   # Message inbox for agent2
    └── ...
```

### Key Components

#### 1. Team Registry (`registry.ts`)
- Manages team directory structure
- Reads/writes team configuration files
- Functions:
  - `createTeam()` - Create new team
  - `getTeam()` - Get team config
  - `listTeams()` - List all teams
  - `updateTeam()` - Update team config
  - `deleteTeam()` - Delete team

#### 2. Team Session (`session.ts`)
- Tracks agent session state
- Session states: `ready`, `busy`, `shutdown_requested`, `shutdown`, `error`
- Functions:
  - `createSession()` - Create agent session
  - `updateSessionStatus()` - Change agent state
  - `getActiveSession()` - Get current active session
  - `recoverFromCrash()` - Recover crashed sessions

#### 3. Team Tasks (`tasks.ts`)
- Task queue management
- Task statuses: `pending`, `in_progress`, `completed`, `failed`, `blocked`
- Functions:
  - `createTask()` - Create new task
  - `claimTask()` - Agent claims a task
  - `completeTask()` - Mark task done
  - `failTask()` - Mark task failed
  - `getAvailableTasks()` - Get tasks ready to work on
  - `getBlockedTasks()` - Get tasks with incomplete dependencies

#### 4. Team Inbox (`inbox.ts`)
- Message passing between team members
- Message types: `message`, `broadcast`, `system`, `receipt`
- Functions:
  - `sendMessage()` - Send direct message
  - `broadcastMessage()` - Broadcast to all members
  - `getMessages()` - Read inbox
  - `markRead()` - Mark messages as read

#### 5. Team Isolation (`isolation.ts`)
- Controls tool visibility based on agent role
- Lead agents have full access
- Sub-agents have restricted tool access
- Lead-only tools: `team_assign_task`, `team_shutdown`, `team_cleanup`

### Team Tools (Now Registered!)

**IMPORTANT:** I just fixed a critical issue - the team tools were defined but **NOT registered** in the ToolRegistry. Now they are available:

| Tool | Description | Who Can Use |
|------|-------------|-------------|
| `team_create` | Create a new team | Anyone |
| `team_list` | List all teams | Anyone |
| `team_info` | Get team information | Anyone |
| `team_message` | Send message to teammate | Team members |
| `team_broadcast` | Broadcast to all members | Team members |
| `team_check_inbox` | Check inbox | Team members |
| `team_mark_read` | Mark messages read | Team members |
| `team_create_task` | Create a task | Team members |
| `team_claim_task` | Claim a task | Team members |
| `team_assign_task` | Assign task to member | **Lead only** |
| `team_complete_task` | Complete a task | Task owner |
| `team_list_tasks` | List all tasks | Team members |
| `team_shutdown` | Shutdown teammate | **Lead only** |
| `team_cleanup` | Cleanup old sessions | **Lead only** |
| `team_add_member` | Add member to team | **Lead only** |

## Data Schema

### Team Config (`config.json`)
```json
{
  "team": "aquilonix",
  "lead": "Sisyphus",
  "description": "Full-featured product development team",
  "members": [
    {
      "name": "Architect",
      "agentType": "Plan",
      "model": "hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4",
      "prompt": "You are the System Architect..."
    }
  ],
  "createdAt": 1774434575990
}
```

### Task (`tasks.json`)
```json
[
  {
    "id": "01KMHJ21FTGQVKX9XCP3XVCX7G",
    "description": "Database Layer: PostgreSQL + Prisma ORM setup",
    "status": "pending",
    "claimedBy": null,
    "dependsOn": [],
    "createdAt": 1774410860027
  }
]
```

### Session (`sessions.json`)
```json
[
  {
    "sessionId": "01KMHJ21FTGQVKX9XCP3XVCX7G",
    "agentName": "Architect",
    "model": "sonnet",
    "teamName": "aquilonix",
    "status": "ready",
    "executionStatus": "idle",
    "createdAt": 1774410860027
  }
]
```

### Message (inbox `.jsonl`)
```json
{"id":"...","from":"Sisyphus","to":"Architect","text":"Hello!","timestamp":1234567890,"read":false,"type":"message"}
```

## How to Use

### 1. Create a Team
```
team_create team="my-team" lead="LeaderName" members=[{name:"worker1",agentType:"general-purpose"}]
```

### 2. Create Tasks
```
team_create_task team="my-team" description="Implement feature X"
team_create_task team="my-team" description="Write tests for X" dependsOn=["task-id-1"]
```

### 3. Assign Tasks (Lead only)
```
team_assign_task team="my-team" taskId="task-id" agent="worker1"
```

### 4. Claim Tasks (Team member)
```
team_claim_task team="my-team" taskId="task-id"
```

### 5. Send Messages
```
team_message team="my-team" to="worker1" text="Please prioritize this"
```

### 6. Check Inbox
```
team_check_inbox team="my-team"
```

### 7. Complete Tasks
```
team_complete_task team="my-team" taskId="task-id"
```

## Comparison with Claude Code Official

| Feature | OpenCode Team | Claude Code Official |
|---------|--------------|----------------------|
| **Parallelism** | Task-based claiming | Parallel agent spawning |
| **Persistence** | JSON files | SQLite + memory |
| **Communication** | Inbox/JSONL | SendMessage tool + mailbox |
| **Coordination** | Manual (you coordinate) | Coordinator mode |
| **Agent spawning** | N/A (task assignment) | Agent/Teammate tools |
| **UI** | CLI + file-based | TUI with pane management |

## Key Differences from oh-my-opencode

| Feature | oh-my-opencode | OpenCode Team |
|---------|---------------|---------------|
| **Workers** | Predefined slots | Dynamic task claiming |
| **Parallelism** | Category-based parallel execution | Sequential task claiming |
| **Assignment** | Plugin-managed categories | Manual task assignment |
| **Communication** | N/A | Built-in inbox system |
| **Persistence** | In-memory | JSON on disk |

## Limitations & Future Improvements

1. **No Automatic Task Distribution** - Tasks must be manually assigned or claimed
2. **No Parallel Execution** - Unlike oh-my-opencode, tasks don't run in parallel automatically
3. **No Coordinator Mode** - Unlike Claude Code, there's no central coordinator
4. **File-based Persistence** - Could be slower than database for large teams
5. **No Real-time Updates** - Agents poll for messages/tasks

## What I Fixed

The team tools were **defined but not registered**. I added:
1. Import `TeamTools` from `../team` in `registry.ts`
2. Added `...TeamTools` to the tools array in `all()` function

Now all team tools are available for use!
