# OpenCode Team System vs Claude Code Official

## Comparison Analysis

### Claude Code Official (Anthropic)

**Architecture:**
- **Subagents**: In-process (AsyncLocalStorage), quick tasks
- **Teammates**: Swarm-based, can be tmux/iTerm2 panes or in-process
- **Coordinator Mode**: Central orchestrator that delegates to workers
- **Communication**: SendMessage tool + mailbox system
- **Task Management**: TaskUpdate, task notifications

**Parallelism:**
- Launch multiple agents via parallel tool calls in single message
- Agents run concurrently (separate processes via tmux/iTerm2, or in-process)
- Coordinator synthesizes results

**Key Tools:**
1. `Agent` - Spawn workers
2. `Teammate` - Spawn teammates with team context
3. `SendMessage` - Inter-agent communication
4. `TaskUpdate` - Task state management

### OpenCode Team System (Current)

**Architecture:**
- **Team Registry**: JSON-based team config (`~/.opencode/teams/<team>/`)
- **Sessions**: Track agent state (ready/busy/shutdown)
- **Tasks**: JSON-based task queue with claim/complete/fail
- **Inbox**: Message passing between team members
- **Isolation**: Lead vs sub-agent permission separation

**Tools Available:**
1. `team_create` - Create a team
2. `team_create_task` - Create tasks
3. `team_claim_task` - Claim tasks (auto-assign on claim)
4. `team_assign_task` - Assign tasks (lead only)
5. `team_complete_task` - Mark done
6. `team_message` - Send messages
7. `team_broadcast` - Broadcast to all
8. `team_check_inbox` - Check messages
9. `team_list_tasks` - View task queue
10. `team_info` - Team status
11. `team_shutdown` - Stop teammate
12. `team_cleanup` - Cleanup old sessions

**Parallelism Limitations:**
- Tasks are claimed one at a time
- No automatic task distribution
- No coordinator mode
- Team members must poll for tasks

## Implementation Plan for Proper Parallelism

### Option 1: Enhance Task System (Recommended)

Add automatic task distribution and parallel execution:

```typescript
// New tool: team_spawn_agents
team_spawn_agents({
  team: "aquilonix",
  count: 3,
  task_batch: ["task1", "task2", "task3"],
  agent_type: "general-purpose"  // or specific member names
})
```

### Option 2: Use Existing Task Tool (Immediate)

Use OpenCode's existing `Task` tool to spawn parallel subagents:

```
Task(description="Explore API", prompt="Explore the API structure...", subagent_type="explore")
Task(description="Explore DB", prompt="Explore the database...", subagent_type="explore")
Task(description="Plan Architecture", prompt="Design the architecture...", subagent_type="Plan")
```

Then use team tools to assign results to team members.

### Option 3: Hybrid (Best of Both)

1. Use `Task` tool for immediate parallel subagent execution
2. Use `team_create_task` for tracking long-term work
3. Manually synthesize results

## Recommended Workflow for You

Since you want parallelism with aquilonix team:

1. **For immediate parallel exploration** (like oh-my-opencode workers):
   ```
   Task(description="Analyze frontend", prompt="...", subagent_type="explore")
   Task(description="Analyze backend", prompt="...", subagent_type="explore")
   Task(description="Analyze database", prompt="...", subagent_type="explore")
   ```

2. **For tracked team work**:
   ```
   team_create_task team="aquilonix" description="Implement feature X"
   team_create_task team="aquilonix" description="Write tests for X"
   team_create_task team="aquilonix" description="Update docs for X"
   ```

3. **Assign to specific aquilonix members**:
   ```
   team_assign_task team="aquilonix" taskId="TASK_ID" agent="Frontend-Developer"
   ```

4. **Team members claim and work**:
   - Frontend-Developer checks inbox, sees assignment
   - Claims task: `team_claim_task team="aquilonix" taskId="TASK_ID"`
   - Completes: `team_complete_task team="aquilonix" taskId="TASK_ID"`

## Key Differences from oh-my-opencode

| Feature | oh-my-opencode | OpenCode Team System |
|---------|---------------|----------------------|
| **Workers** | Predefined slots (p1-worker-1 to 8) | Dynamic task claiming |
| **Parallelism** | Automatic via categories | Manual via parallel Task calls |
| **Coordination** | Plugin-managed | Manual (you coordinate) |
| **Assignment** | Category-based (`p1-worker-*`) | Task-based with claim/assign |
| **Persistence** | In-memory | JSON files on disk |
| **Communication** | Not built-in | Inbox/message system |

## Next Steps

To get parallelism similar to oh-my-opencode:

1. **Use parallel Task calls** for immediate multi-agent work
2. **Use team tasks** for tracking work assignments to specific aquilonix members
3. **Consider enhancing** the team system with auto-distribution if needed

Would you like me to:
1. Show you how to use parallel Task calls effectively?
2. Create a workflow example using aquilonix team?
3. Enhance the team system with automatic task distribution?
