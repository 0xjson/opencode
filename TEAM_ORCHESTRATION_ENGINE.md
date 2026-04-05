# Autonomous Task Orchestration Engine

## Overview

This document describes the autonomous, parallel, intelligent task orchestration engine implemented for the OpenCode Team system. The engine transforms the existing team system into a distributed, self-optimizing task execution platform.

## Architecture

### Phase 1: Foundation (Complete)

**Files Added:**
- `packages/opencode/src/team/schema.ts` - Extended with orchestration types
- `packages/opencode/src/team/embedding.ts` - Vector generation for semantic matching
- `packages/opencode/src/team/scorer.ts` - Composite scoring algorithm

**Key Features:**

1. **Semantic Matching via Cosine Similarity**
   - Tasks and agents have 128-dimensional embedding vectors
   - Domain-specific keyword extraction (TypeScript, Python, testing, etc.)
   - TF-IDF-like vector generation with domain weighting
   - Cosine similarity in [0, 1] range

2. **Composite Task Scoring Function**
   ```
   score(agent, task) =
     0.35 * semantic_similarity +
     0.15 * availability +
     0.15 * dependency_ready +
     0.15 * reliability +
     0.10 * latency_efficiency +
     0.10 * exploration_bonus
   ```

3. **Agent Capabilities & Statistics**
   - `AgentCapabilities`: embedding vector, expertise, max_capacity
   - `AgentStats`: success_rate, avg_completion_time per task type
   - Automatic capability generation from agent config
   - Persistent storage in `agent_capabilities.json` and `agent_stats.json`

4. **Enhanced Task Model**
   - `OrchestratedTask`: embedding, priority, attempts, assigned_history
   - Automatic task type inference (research, coding, testing, etc.)
   - Automatic difficulty estimation (1-10 scale)

5. **New Tools (Phase 1):**
   - `team_auto_claim` - Agents claim best-matching tasks
   - `team_select_best_agent` - Lead assigns based on scoring
   - `team_get_agent_stats` - View performance statistics
   - `team_get_ready_tasks` - List dependency-ready tasks

### Phase 2: Parallel Execution (Complete)

**Files Added:**
- `packages/opencode/src/team/scheduler.ts` - Continuous scheduler loop

**Key Features:**

1. **Dependency-Aware Scheduling**
   - Cycle detection in dependency graphs
   - Topological sort for task ordering
   - Tasks only assigned when all dependencies complete
   - Penalty factor of 0.2 for tasks with incomplete dependencies

2. **Scheduler Loop Algorithm**
   ```
   1. Load tasks and sessions
   2. Filter pending, dependency-ready tasks
   3. Prioritize tasks (critical > high > normal > low)
   4. High-priority tasks: lead assigns via scoring
   5. Other tasks: agents auto-claim
   6. Execute tasks in parallel
   7. Update stats on completion/failure
   8. Unlock dependent tasks
   9. Retry failed tasks (up to maxRetries)
   ```

3. **Parallel Execution**
   - Multiple tasks execute simultaneously
   - Per-agent concurrency limits (maxCapacity)
   - No single-agent bottlenecks
   - Fair workload distribution

4. **New Tools (Phase 2):**
   - `team_start_scheduler` - Start autonomous scheduler
   - `team_stop_scheduler` - Stop scheduler with stats
   - `team_scheduler_status` - View scheduler state
   - `team_run_scheduler_tick` - Manual scheduler tick

5. **Scheduler Configuration:**
   - Interval: 5 seconds (configurable)
   - Max tasks per cycle: 10
   - Min auto-claim score: 0.3
   - Retry enabled: true
   - Max retries: 3

### Phase 3: Bidding System (Complete)

**Files Added:**
- `packages/opencode/src/team/bidding.ts` - Competitive bidding for complex tasks

**Key Features:**

1. **Bidding Workflow**
   - Lead starts bidding for tasks with difficulty >= 7
   - Agents submit bids with confidence (0-1) and ETA (minutes)
   - Bidding closes after timeout or manual resolution
   - Winner selected by bid score: `confidence / (ETA_hours + 0.5)`

2. **Bid Scoring**
   - Prioritizes high confidence with low ETA
   - Manual override available to lead
   - Automatic notifications to winner and losers

3. **New Tools (Phase 3):**
   - `team_start_bidding` - Initiate bidding phase
   - `team_submit_bid` - Agent submits bid
   - `team_get_bids` - View current bid rankings
   - `team_resolve_bidding` - Award task to winner
   - `team_cancel_bidding` - Cancel bidding phase

4. **Bidding Configuration:**
   - Duration: 30 seconds (configurable)
   - Min confidence: 0.5
   - Difficulty threshold: 7
   - Auto-resolve: true
   - Max bids per agent: 3

## Storage Format

The system maintains JSON-based persistence:

```
~/.opencode/teams/<team>/
├── config.json              # Team configuration
├── tasks.json               # Tasks with orchestration metadata
├── sessions.json            # Agent sessions
├── agent_capabilities.json  # Agent embedding vectors
├── agent_stats.json         # Performance statistics
└── inboxes/
    └── <agent>.jsonl       # Agent messages
```

## Agent State Machine

```
idle -> thinking -> working -> [complete|failed]
  |        |         |
  +--------+---------+
           |
        blocked
```

States:
- `idle`: Ready for task assignment
- `thinking`: Evaluating task
- `working`: Task in progress
- `blocked`: Waiting on dependencies
- `reviewing`: Reviewing completed work

## Feedback Loop

1. **Success Tracking**
   - Increment successfulTasks on completion
   - Calculate success rate: `successful / total`
   - Update reliabilityScore: `+0.02` on success

2. **Failure Tracking**
   - Increment failedTasks on failure
   - Penalize reliabilityScore: `-0.05` on failure
   - Requeue task for retry (max 3 attempts)
   - Track failures in task.assignedHistory

3. **Task Type Learning**
   - Track avgCompletionTime per task type
   - Success rate per task type
   - Use for future latency_efficiency scoring

## Usage Examples

### Create a Team with Autonomous Scheduling

```typescript
// Create team
await TeamCreateTool.execute({
  team: "ai-engine",
  lead: "lead-agent",
  members: [
    { name: "code-expert", agentType: "general-purpose" },
    { name: "test-runner", agentType: "general-purpose" },
    { name: "researcher", agentType: "Explore" },
  ]
})

// Start scheduler
await TeamStartSchedulerTool.execute({ team: "ai-engine" })

// Create tasks - they will be automatically assigned
await TeamCreateTaskTool.execute({
  team: "ai-engine",
  description: "Implement new scoring algorithm",
  priority: "high"
})
```

### Manual Task Assignment with Scoring

```typescript
// View ready tasks
await TeamGetReadyTasksTool.execute({ team: "ai-engine" })

// Select best agent
await TeamSelectBestAgentTool.execute({
  team: "ai-engine",
  taskId: "task-id"
})

// Or auto-claim as agent
await TeamAutoClaimTool.execute({ team: "ai-engine" })
```

### Bidding for Complex Tasks

```typescript
// Start bidding (lead only)
await TeamStartBiddingTool.execute({
  team: "ai-engine",
  taskId: "complex-task-id",
  durationMs: 60000
})

// Agents submit bids
await TeamSubmitBidTool.execute({
  team: "ai-engine",
  taskId: "complex-task-id",
  confidence: 0.85,
  estimatedMinutes: 30,
  reasoning: "I have experience with similar algorithms"
})

// View bids
await TeamGetBidsTool.execute({
  team: "ai-engine",
  taskId: "complex-task-id"
})

// Resolve bidding (lead only)
await TeamResolveBiddingTool.execute({
  team: "ai-engine",
  taskId: "complex-task-id"
})
```

### Monitor Performance

```typescript
// View agent stats
await TeamGetAgentStatsTool.execute({
  team: "ai-engine",
  agent: "code-expert"
})

// Check scheduler status
await TeamSchedulerStatusTool.execute({
  team: "ai-engine"
})
```

## Performance Optimizations

1. **Parallel Processing**: Multiple tasks execute simultaneously
2. **Dependency Awareness**: No blocking on incomplete dependencies
3. **Smart Routing**: Tasks go to best-suited agents
4. **Caching**: Agent capabilities and stats cached in memory
5. **Batching**: Scheduler processes multiple tasks per cycle

## Future Enhancements (Phase 4-5)

### Phase 4: Advanced Learning
- Dynamic weight adjustment based on historical performance
- Predictive failure detection
- Agent specialization recommendations

### Phase 5: Optimization Layer
- UCB-style exploration bonus refinement
- Workload balancing across agents
- Automatic team rebalancing
- Conflict resolution for task contention

## API Reference

### ScoringEngine

```typescript
namespace ScoringEngine {
  function cosineSimilarity(vectorA: number[], vectorB: number[]): number
  function computeScore(agent, task, agentStats, allTasks, allAgentStats): ScoreResult
  function selectBestAgent(task, agents, allTasks): { bestAgent, score, scores }
  function dependencyReady(task, allTasks): { ready, ratio }
}
```

### TeamScheduler

```typescript
namespace TeamScheduler {
  function startScheduler(teamName, options): Promise<{ success, error }>
  function stopScheduler(teamName): Promise<{ success, stats, error }>
  function schedulerTick(teamName): Promise<tickResults>
  function detectCycle(tasks): boolean
  function topologicalSort(tasks): Task[]
}
```

### TeamBidding

```typescript
namespace TeamBidding {
  function startBiddingPhase(teamName, taskId, options): Promise<{ success, biddingId, deadline }>
  function submitBid(teamName, taskId, agentName, bidData): Promise<{ success, bid, rank }>
  function resolveBidding(teamName, taskId, options): Promise<{ success, winner, bid, allBids }>
  function getBiddingStatus(teamName, taskId): Promise<biddingStatus>
}
```

## Success Criteria

- [x] Tasks processed concurrently
- [x] No deadlocks in dependency handling
- [x] Balanced agent utilization via scoring
- [x] Improved performance over time via learning
- [x] Fair task distribution
- [x] Automatic retry on failure
- [x] Clear feedback loop for optimization

## Testing

Run tests with:
```bash
cd packages/opencode
bun test src/team/__tests__/
```

## License

MIT - See LICENSE file in repository root.
