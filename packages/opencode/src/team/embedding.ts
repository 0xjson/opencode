// Embedding Service for Agent/Task Semantic Matching
// Generates vector representations for cosine similarity comparison

import { Team } from "./schema"

export namespace EmbeddingService {
  // Vector dimension for embeddings
  const VECTOR_DIMENSION = 128

  // Common stopwords to filter out
  const STOPWORDS = new Set([
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "he",
    "in", "is", "it", "its", "of", "on", "that", "the", "to", "was", "will",
    "with", "the", "this", "but", "they", "have", "had", "what", "said", "each",
    "which", "she", "do", "how", "their", "if", "up", "out", "many", "then",
    "them", "these", "so", "some", "her", "would", "make", "like", "into", "him",
    "time", "two", "more", "go", "no", "way", "could", "my", "than", "first",
    "water", "been", "call", "who", "its", "now", "find", "long", "down", "day",
  ])

  // Keyword categories for domain-specific weighting
  const DOMAIN_KEYWORDS: Record<string, string[]> = {
    // Code domains
    typescript: ["typescript", "ts", "type", "interface", "generic", "async", "await"],
    javascript: ["javascript", "js", "node", "npm", "async", "promise", "callback"],
    python: ["python", "py", "pip", "asyncio", "decorator", "generator"],
    rust: ["rust", "cargo", "ownership", "borrow", "lifetime", "trait"],
    go: ["go", "golang", "goroutine", "channel", "interface"],
    java: ["java", "spring", "maven", "gradle", "class", "interface"],
    // Task types
    research: ["research", "explore", "investigate", "analyze", "find", "discover", "search"],
    planning: ["plan", "design", "architect", "structure", "organize", "strategy"],
    coding: ["code", "implement", "develop", "write", "create", "build", "function"],
    testing: ["test", "verify", "validate", "check", "assert", "mock", "jest", "pytest"],
    refactoring: ["refactor", "cleanup", "improve", "optimize", "simplify", "restructure"],
    debugging: ["debug", "fix", "error", "bug", "issue", "problem", "troubleshoot"],
    review: ["review", "audit", "inspect", "examine", "assess", "evaluate"],
    documentation: ["document", "readme", "comment", "explain", "describe", "guide"],
    // Tools
    database: ["database", "db", "sql", "query", "schema", "migration", "postgresql", "mysql"],
    api: ["api", "endpoint", "rest", "graphql", "http", "request", "response"],
    frontend: ["frontend", "ui", "react", "vue", "angular", "component", "html", "css"],
    backend: ["backend", "server", "api", "middleware", "route", "controller"],
    devops: ["deploy", "ci", "cd", "pipeline", "docker", "kubernetes", "infrastructure"],
    // Concepts
    performance: ["performance", "speed", "latency", "throughput", "optimize", "cache"],
    security: ["security", "auth", "authentication", "authorization", "encrypt", "vulnerability"],
    scalability: ["scale", "scalable", "concurrent", "parallel", "distributed", "load"],
    reliability: ["reliable", "robust", "error-handling", "resilience", "fault-tolerant"],
  }

  /**
   * Tokenize text into normalized words
   */
  function tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word))
  }

  /**
   * Extract domain-specific features from text
   */
  function extractDomainFeatures(tokens: string[]): Map<string, number> {
    const features = new Map<string, number>()

    for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      let score = 0
      for (const token of tokens) {
        if (keywords.includes(token)) {
          score += 1
        }
        // Partial matches (e.g., "testing" matches "test")
        for (const keyword of keywords) {
          if (token.includes(keyword) || keyword.includes(token)) {
            score += 0.5
          }
        }
      }
      if (score > 0) {
        features.set(domain, score)
      }
    }

    return features
  }

  /**
   * Generate a hash code for a string (for deterministic vector positions)
   */
  function hashCode(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash)
  }

  /**
   * Create a sparse vector representation from tokens
   */
  function tokensToVector(tokens: string[]): number[] {
    const vector = new Array(VECTOR_DIMENSION).fill(0)

    // Count token frequencies
    const tokenFreq = new Map<string, number>()
    for (const token of tokens) {
      tokenFreq.set(token, (tokenFreq.get(token) || 0) + 1)
    }

    // Map tokens to vector positions using hashing
    for (const [token, freq] of tokenFreq) {
      const hash = hashCode(token)
      const position = hash % VECTOR_DIMENSION
      const value = Math.min(freq * 0.5 + 0.1, 1.0) // Normalize to 0-1 range
      vector[position] = Math.max(vector[position], value)
    }

    // Add domain features
    const domainFeatures = extractDomainFeatures(tokens)
    for (const [domain, score] of domainFeatures) {
      const hash = hashCode(domain)
      const position = hash % VECTOR_DIMENSION
      vector[position] = Math.min(vector[position] + score * 0.3, 1.0)
    }

    return normalizeVector(vector)
  }

  /**
   * Normalize a vector to unit length
   */
  export function normalizeVector(vector: number[]): number[] {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0))
    if (magnitude === 0) return vector
    return vector.map((val) => val / magnitude)
  }

  /**
   * Compute cosine similarity between two vectors
   * Returns value in [0, 1] range
   */
  export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
    if (vectorA.length !== vectorB.length) {
      throw new Error(`Vector dimension mismatch: ${vectorA.length} vs ${vectorB.length}`)
    }

    let dotProduct = 0
    let magnitudeA = 0
    let magnitudeB = 0

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i]
      magnitudeA += vectorA[i] * vectorA[i]
      magnitudeB += vectorB[i] * vectorB[i]
    }

    magnitudeA = Math.sqrt(magnitudeA)
    magnitudeB = Math.sqrt(magnitudeB)

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0
    }

    // Normalize to [0, 1] range (cosine similarity is naturally in [-1, 1])
    const similarity = dotProduct / (magnitudeA * magnitudeB)
    return (similarity + 1) / 2
  }

  /**
   * Generate embedding vector for a task
   */
  export function generateTaskEmbedding(task: {
    description: string
    taskType?: string
    metadata?: Record<string, any>
  }): number[] {
    const tokens = tokenize(task.description)

    // Add task type as weighted tokens
    if (task.taskType) {
      const typeTokens = tokenize(task.taskType)
      for (let i = 0; i < 3; i++) {
        tokens.push(...typeTokens)
      }
    }

    // Extract keywords from metadata
    if (task.metadata) {
      for (const [key, value] of Object.entries(task.metadata)) {
        if (typeof value === "string") {
          tokens.push(...tokenize(value))
        }
        // Add key name with weight
        tokens.push(...tokenize(key), ...tokenize(key), ...tokenize(key))
      }
    }

    return tokensToVector(tokens)
  }

  /**
   * Generate embedding vector for agent capabilities
   */
  export function generateAgentCapabilities(agent: {
    name: string
    agentType: string
    expertise?: string[]
    prompt?: string
  }): number[] {
    const tokens: string[] = []

    // Add agent type with weight
    const typeTokens = tokenize(agent.agentType)
    for (let i = 0; i < 5; i++) {
      tokens.push(...typeTokens)
    }

    // Add expertise with weight
    if (agent.expertise) {
      for (const skill of agent.expertise) {
        const skillTokens = tokenize(skill)
        for (let i = 0; i < 3; i++) {
          tokens.push(...skillTokens)
        }
      }
    }

    // Add prompt if available
    if (agent.prompt) {
      tokens.push(...tokenize(agent.prompt))
    }

    // Add name
    tokens.push(...tokenize(agent.name))

    return tokensToVector(tokens)
  }

  /**
   * Estimate task difficulty based on description and metadata
   * Returns a value from 1-10
   */
  export function estimateTaskDifficulty(description: string): number {
    const tokens = tokenize(description)
    let difficulty = 5 // Base difficulty

    // Increase for complex keywords
    const complexIndicators = [
      "complex", "difficult", "hard", "challenging", "architect", "redesign",
      "refactor", "optimize", "performance", "security", "scale", "distributed",
      "concurrent", "parallel", "synchronization", "deadlock", "race condition",
    ]
    for (const indicator of complexIndicators) {
      if (description.toLowerCase().includes(indicator)) {
        difficulty += 1
      }
    }

    // Increase for length (longer descriptions often mean more complex tasks)
    if (tokens.length > 50) difficulty += 1
    if (tokens.length > 100) difficulty += 1

    // Decrease for simple keywords
    const simpleIndicators = [
      "simple", "easy", "minor", "quick", "small", "fix", "typo", "format",
      "style", "rename", "comment", "documentation",
    ]
    for (const indicator of simpleIndicators) {
      if (description.toLowerCase().includes(indicator)) {
        difficulty -= 1
      }
    }

    return Math.max(1, Math.min(10, difficulty))
  }

  /**
   * Infer task type from description
   */
  export function inferTaskType(description: string): string {
    const desc = description.toLowerCase()

    if (desc.match(/\b(research|explore|investigate|find|search|discover)\b/)) {
      return "research"
    }
    if (desc.match(/\b(plan|design|architect|structure|organize)\b/)) {
      return "planning"
    }
    if (desc.match(/\b(refactor|cleanup|improve|restructure)\b/)) {
      return "refactoring"
    }
    if (desc.match(/\b(test|verify|validate|mock|jest|pytest)\b/)) {
      return "testing"
    }
    if (desc.match(/\b(debug|fix|bug|error|issue|troubleshoot)\b/)) {
      return "debugging"
    }
    if (desc.match(/\b(review|audit|inspect|examine)\b/)) {
      return "review"
    }
    if (desc.match(/\b(document|readme|comment|explain)\b/)) {
      return "documentation"
    }
    if (desc.match(/\b(code|implement|develop|write|create|build)\b/)) {
      return "coding"
    }

    return "general"
  }

  /**
   * Suggest expertise based on task description
   */
  export function suggestExpertise(description: string): string[] {
    const tokens = tokenize(description)
    const expertise: string[] = []

    const expertiseMap: Record<string, string[]> = {
      typescript: ["typescript", "ts"],
      javascript: ["javascript", "js", "node"],
      python: ["python", "py"],
      rust: ["rust"],
      react: ["react", "jsx", "tsx", "frontend"],
      vue: ["vue", "frontend"],
      angular: ["angular", "frontend"],
      nodejs: ["node", "nodejs", "backend"],
      express: ["express", "backend"],
      database: ["database", "sql", "postgresql", "mysql"],
      testing: ["testing", "jest", "pytest", "unit-test"],
      devops: ["docker", "kubernetes", "ci", "cd", "deploy"],
      api: ["api", "rest", "graphql", "endpoint"],
      security: ["security", "auth", "authentication"],
      performance: ["performance", "optimize", "speed"],
    }

    for (const [skill, keywords] of Object.entries(expertiseMap)) {
      for (const token of tokens) {
        if (keywords.some((k) => token.includes(k) || k.includes(token))) {
          if (!expertise.includes(skill)) {
            expertise.push(skill)
          }
          break
        }
      }
    }

    return expertise
  }
}
