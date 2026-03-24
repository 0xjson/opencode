# Agent Team Role Templates

Pre-defined role templates for creating specialized agent teams.

## Quick Start

```typescript
import { createTeamFromPreset, TeamPresets } from "@opencodeshare/opencode/src/team"

// Create a dev-team with all specializations
const teamConfig = createTeamFromPreset("my-project", "architect", "dev-team")

// Or use the team creation tool
await team_create({
  team: "my-project",
  lead: "architect",
  description: "Dev team for trading platform",
  members: TeamPresets["dev-team"].members.map(m =>
    createMemberConfig(m.name, m.roleId)
  )
})
```

---

## Dev Team Preset

The **dev-team** preset provides a complete development team with specialized roles for building complex applications, particularly those involving trading/financial logic.

### Team Structure

| Role | Agent Type | Purpose |
|------|------------|---------|
| **architect** | Plan | Team lead, coordination only |
| **researcher** | Explore | Find documentation, analyze libraries |
| **backend-dev** | general-purpose | Implement features, APIs, databases |
| **trading-logic-dev** | general-purpose | Specialized trading/financial logic |
| **security-reviewer** | Plan | Security audit, refactoring |
| **tester** | general-purpose | Write tests, run tests, report bugs |

### Usage

```typescript
import {
  createTeamFromPreset,
  createMemberConfig,
  TeamPresets,
  TeamRegistry,
} from "@opencodeshare/opencode/src/team"

// Method 1: Using createTeamFromPreset
const teamConfig = createTeamFromPreset(
  "trading-platform",
  "architect",
  "dev-team",
  {
    description: "Team building the trading platform",
  }
)

await TeamRegistry.createTeam(teamConfig)

// Method 2: Manual configuration with overrides
const members = TeamPresets["dev-team"].members.map((m, i) =>
  createMemberConfig(m.name, m.roleId, {
    model: i === 0 ? "sonnet" : "haiku", // Architect uses sonnet
  })
)

await TeamRegistry.createTeam({
  team: "trading-platform",
  lead: "architect",
  members,
})
```

### Workflow Example

```typescript
// 1. Architect creates tasks
await team_create_task({
  team: "trading-platform",
  description: "Research trading API libraries",
})

await team_create_task({
  team: "trading-platform",
  description: "Design order execution system",
})

// 2. Researcher claims and completes research
await team_claim_task({ team: "trading-platform", taskId: "task-1" })
// ... do research ...
await team_complete_task({ team: "trading-platform", taskId: "task-1" })
await team_message({
  team: "trading-platform",
  to: "architect",
  text: "Research complete. Recommended library: ccxt",
})

// 3. Architect assigns implementation
await team_create_task({
  team: "trading-platform",
  description: "Implement order placement API",
  dependsOn: ["task-1"],
})

// 4. Backend dev claims and implements
await team_claim_task({ team: "trading-platform", taskId: "task-3" })
// ... implement ...
await team_complete_task({ team: "trading-platform", taskId: "task-3" })

// 5. Security reviewer audits
await team_create_task({
  team: "trading-platform",
  description: "Security audit of order API",
  dependsOn: ["task-3"],
})

// 6. Tester writes tests
await team_create_task({
  team: "trading-platform",
  description: "Write integration tests for orders",
  dependsOn: ["task-3"],
})
```

---

## All Role Templates

### Architect

**ID:** `architect`

The team lead focused on coordination and high-level design. Does NOT write implementation code.

**Best For:**
- Coordinating team activities
- Making architectural decisions
- Reviewing team progress
- Resolving technical conflicts
- Assigning tasks to team members

**Prompt Focus:**
- Coordination over implementation
- Clear communication
- Constructive feedback
- Prompt decision making

**Recommended Model:** sonnet

---

### Researcher

**ID:** `explore`

Fast agent for exploring codebases and researching libraries.

**Best For:**
- Finding files matching patterns
- Searching for specific code patterns
- Exploring codebase structure
- Answering questions about code location
- Analyzing third-party libraries

**Prompt Focus:**
- Fast file pattern matching
- Content searching
- Efficient file reading
- Understanding project structure
- Reporting findings with file paths

**Recommended Model:** haiku

---

### Backend Developer

**ID:** `backend-dev`

Specialized for server-side development and business logic.

**Best For:**
- Implementing API endpoints
- Designing database schemas
- Writing business logic
- Server configuration
- Authentication/authorization

**Prompt Focus:**
- RESTful API design
- Input validation
- Error handling
- Database efficiency
- Security considerations

**Recommended Model:** sonnet

---

### Trading Logic Developer

**ID:** `trading-logic-dev`

Specialized for financial systems and trading algorithms.

**Best For:**
- Trading algorithm implementation
- Risk calculation and management
- Market data processing
- Portfolio and position logic
- Financial calculations (P&L, Greeks)

**Prompt Focus:**
- Precision in calculations
- Edge case handling
- Logging important events
- Risk consideration
- Market scenarios

**Recommended Model:** sonnet

---

### Security Reviewer

**ID:** `security-reviewer`

Specialized for security analysis and auditing.

**Best For:**
- Auditing for security vulnerabilities
- Reviewing authentication code
- Checking for injection risks
- Reviewing permission handling
- Secure coding reviews

**Prompt Focus:**
- Injection vulnerabilities (SQL, command, XSS)
- Authentication and authorization
- Data validation and sanitization
- Insecure dependencies
- Severity prioritization

**Recommended Model:** sonnet

---

### Tester

**ID:** `tester`

Specialized for writing and running tests.

**Best For:**
- Writing unit tests
- Writing integration tests
- Improving test coverage
- Debugging failing tests
- Test validation

**Prompt Focus:**
- Happy paths and edge cases
- Descriptive test names
- Following existing patterns
- Meaningful coverage

**Recommended Model:** haiku

---

### Planner

**ID:** `planner`

Software architect for designing implementation strategies.

**Best For:**
- Designing implementation strategies
- Identifying critical files
- Planning multi-step refactoring
- Evaluating architectural approaches

**Prompt Focus:**
- Step-by-step plans
- Critical file identification
- Alternative approaches
- Backward compatibility

**Recommended Model:** sonnet

---

### Code Reviewer

**ID:** `code-reviewer`

Specialized for reviewing code changes.

**Best For:**
- PR reviews
- Security audits in code
- Style consistency checks
- Suggesting improvements

**Prompt Focus:**
- Bug and logic error detection
- Security vulnerability spotting
- Style consistency
- Constructive feedback

**Recommended Model:** sonnet

---

### General Purpose

**ID:** `general`

Versatile agent for most software engineering tasks.

**Best For:**
- Implementing new features
- Fixing bugs
- Refactoring code
- Adding documentation

**Prompt Focus:**
- Clean, maintainable code
- Following existing patterns
- Self-evident logic
- Preferring edits over new files

**Recommended Model:** sonnet

---

### Documentation

**ID:** `documentation`

Specialized for writing documentation.

**Best For:**
- Writing README files
- Documenting APIs
- Adding code comments
- Creating user guides

**Prompt Focus:**
- Clear and concise writing
- Appropriate examples
- Target audience awareness
- Updating vs duplicating

**Recommended Model:** haiku

---

## Team Presets

### Small Team

Minimal team for focused tasks.

```typescript
const config = createTeamFromPreset("project", "lead", "small")
// Members: 1 developer
```

### Standard Team

Balanced team for most development tasks.

```typescript
const config = createTeamFromPreset("project", "lead", "standard")
// Members: researcher, developer, tester
```

### Full Team

Comprehensive team for complex projects.

```typescript
const config = createTeamFromPreset("project", "lead", "full")
// Members: architect, researcher, backend, frontend, tester, reviewer
```

### Security Team

Focused on security auditing.

```typescript
const config = createTeamFromPreset("project", "lead", "security")
// Members: security-lead, developer, tester
```

### Research Team

Focused on exploration and planning.

```typescript
const config = createTeamFromPreset("project", "lead", "research")
// Members: architect, researcher, documenter
```

### Dev Team

Complete development team (see above).

```typescript
const config = createTeamFromPreset("project", "architect", "dev-team")
// Members: architect, researcher, backend-dev, trading-logic-dev, security-reviewer, tester
```

---

## Creating Custom Templates

```typescript
import { RoleTemplate } from "@opencodeshare/opencode/src/team"

const MyCustomTemplate: RoleTemplate = {
  id: "custom-role",
  displayName: "Custom Role",
  description: "Description of what this role does",
  agentType: "general-purpose",
  recommendedModel: "sonnet",
  color: "#FF5722",
  exampleTasks: ["Task 1", "Task 2"],
  prompt: `You are a custom agent...`,
}
```

---

## Best Practices

1. **Architect as Lead**: Always use the architect role as team lead for dev-team
2. **Research First**: Have researcher explore before implementation tasks
3. **Security Review**: Schedule security review after implementation
4. **Test Coverage**: Assign tester to write tests in parallel or after
5. **Trading Logic**: For financial systems, use trading-logic-dev for precision
6. **Communication**: Use broadcasts for team updates, messages for direct coordination
