// Vector Index with ANN (Approximate Nearest Neighbor) for Fast Similarity Search
// Implements LSH (Locality Sensitive Hashing) for efficient vector retrieval

import { EmbeddingService } from "./embedding"

export namespace VectorIndex {
  // Configuration constants
  const DEFAULT_VECTOR_DIM = 128
  const DEFAULT_NUM_HASH_TABLES = 8
  const DEFAULT_HASH_BUCKET_SIZE = 16
  const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
  const DEFAULT_MAX_CACHE_SIZE = 10000

  /**
   * Cache entry with TTL
   */
  interface CacheEntry<T> {
    value: T
    timestamp: number
    accessCount: number
  }

  /**
   * LRU Cache with TTL expiration
   */
  class TTLCache<K, V> {
    private cache = new Map<K, CacheEntry<V>>()
    private maxSize: number
    private ttlMs: number

    constructor(maxSize: number, ttlMs: number) {
      this.maxSize = maxSize
      this.ttlMs = ttlMs
    }

    get(key: K): V | undefined {
      const entry = this.cache.get(key)
      if (!entry) return undefined

      // Check TTL
      if (Date.now() - entry.timestamp > this.ttlMs) {
        this.cache.delete(key)
        return undefined
      }

      // Update access count and timestamp
      entry.accessCount++
      entry.timestamp = Date.now()
      return entry.value
    }

    set(key: K, value: V): void {
      // Evict if at capacity (LRU)
      if (this.cache.size >= this.maxSize) {
        this.evictLRU()
      }

      this.cache.set(key, {
        value,
        timestamp: Date.now(),
        accessCount: 1,
      })
    }

    delete(key: K): boolean {
      return this.cache.delete(key)
    }

    clear(): void {
      this.cache.clear()
    }

    private evictLRU(): void {
      let minAccess = Infinity
      let lruKey: K | undefined

      for (const [key, entry] of this.cache) {
        if (entry.accessCount < minAccess) {
          minAccess = entry.accessCount
          lruKey = key
        }
      }

      if (lruKey !== undefined) {
        this.cache.delete(lruKey)
      }
    }

    get size(): number {
      return this.cache.size
    }

    keys(): IterableIterator<K> {
      return this.cache.keys()
    }
  }

  /**
   * LSH Hash function using random projections
   */
  class LSHHashFunction {
    private projections: number[][]
    private bucketSize: number

    constructor(dim: number, bucketSize: number) {
      this.bucketSize = bucketSize
      this.projections = []

      // Generate random projection vectors
      for (let i = 0; i < bucketSize; i++) {
        const projection = []
        for (let j = 0; j < dim; j++) {
          // Random normal distribution
          projection.push(this.randomNormal())
        }
        this.projections.push(projection)
      }
    }

    hash(vector: number[]): string {
      const bits: number[] = []

      for (const proj of this.projections) {
        let dot = 0
        for (let i = 0; i < vector.length; i++) {
          dot += vector[i] * proj[i]
        }
        bits.push(dot >= 0 ? 1 : 0)
      }

      return bits.join("")
    }

    private randomNormal(): number {
      // Box-Muller transform for normal distribution
      const u1 = Math.random()
      const u2 = Math.random()
      return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    }
  }

  /**
   * LSH Hash Table for ANN search
   */
  class LSHHashTable {
    private buckets = new Map<string, Set<string>>()
    private hashFunction: LSHHashFunction

    constructor(dim: number, bucketSize: number) {
      this.hashFunction = new LSHHashFunction(dim, bucketSize)
    }

    add(id: string, vector: number[]): void {
      const hash = this.hashFunction.hash(vector)

      if (!this.buckets.has(hash)) {
        this.buckets.set(hash, new Set())
      }

      this.buckets.get(hash)!.add(id)
    }

    remove(id: string, vector: number[]): void {
      const hash = this.hashFunction.hash(vector)
      const bucket = this.buckets.get(hash)

      if (bucket) {
        bucket.delete(id)
        if (bucket.size === 0) {
          this.buckets.delete(hash)
        }
      }
    }

    query(vector: number[]): Set<string> {
      const hash = this.hashFunction.hash(vector)
      return this.buckets.get(hash) || new Set()
    }

    getBucketCount(): number {
      return this.buckets.size
    }
  }

  /**
   * ANN Index using Multi-Probe LSH
   */
  export class ANNIndex {
    private hashTables: LSHHashTable[]
    private vectors = new Map<string, number[]>()
    private dim: number
    private numTables: number
    private bucketSize: number

    // Caches
    private embeddingCache: TTLCache<string, number[]>
    private similarityCache: TTLCache<string, number>

    // Metrics
    private searchCount = 0
    private approximateSearchCount = 0
    private cacheHitCount = 0

    constructor(options: {
      dim?: number
      numTables?: number
      bucketSize?: number
      cacheTtlMs?: number
      maxCacheSize?: number
    } = {}) {
      this.dim = options.dim || DEFAULT_VECTOR_DIM
      this.numTables = options.numTables || DEFAULT_NUM_HASH_TABLES
      this.bucketSize = options.bucketSize || DEFAULT_HASH_BUCKET_SIZE

      // Initialize hash tables
      this.hashTables = []
      for (let i = 0; i < this.numTables; i++) {
        this.hashTables.push(new LSHHashTable(this.dim, this.bucketSize))
      }

      // Initialize caches
      this.embeddingCache = new TTLCache(
        options.maxCacheSize || DEFAULT_MAX_CACHE_SIZE,
        options.cacheTtlMs || DEFAULT_CACHE_TTL_MS
      )
      this.similarityCache = new TTLCache(
        options.maxCacheSize || DEFAULT_MAX_CACHE_SIZE,
        options.cacheTtlMs || DEFAULT_CACHE_TTL_MS
      )
    }

    /**
     * Add a vector to the index
     */
    addVector(id: string, vector: number[]): void {
      if (vector.length !== this.dim) {
        throw new Error(
          `Vector dimension mismatch: expected ${this.dim}, got ${vector.length}`
        )
      }

      // Remove existing if present
      if (this.vectors.has(id)) {
        this.removeVector(id)
      }

      // Store vector
      this.vectors.set(id, [...vector])

      // Add to all hash tables
      for (const table of this.hashTables) {
        table.add(id, vector)
      }
    }

    /**
     * Remove a vector from the index
     */
    removeVector(id: string): boolean {
      const vector = this.vectors.get(id)
      if (!vector) return false

      // Remove from hash tables
      for (const table of this.hashTables) {
        table.remove(id, vector)
      }

      // Remove from storage
      this.vectors.delete(id)

      // Clear related similarity caches
      this.clearSimilarityCacheForId(id)

      return true
    }

    /**
     * Search for k nearest neighbors
     * Uses ANN for candidate generation, then exact distance for ranking
     */
    searchNearest(queryVector: number[], k: number): Array<{ id: string; similarity: number }> {
      this.searchCount++

      if (queryVector.length !== this.dim) {
        throw new Error(
          `Query vector dimension mismatch: expected ${this.dim}, got ${queryVector.length}`
        )
      }

      // Collect candidates from all hash tables
      const candidates = new Set<string>()
      for (const table of this.hashTables) {
        const bucket = table.query(queryVector)
        for (const id of bucket) {
          candidates.add(id)
        }
      }

      // If no candidates found via ANN, fall back to brute force
      if (candidates.size === 0) {
        return this.bruteForceSearch(queryVector, k)
      }

      this.approximateSearchCount++

      // Compute exact similarities for candidates
      const results: Array<{ id: string; similarity: number }> = []

      for (const id of candidates) {
        const vector = this.vectors.get(id)
        if (vector) {
          const similarity = this.computeSimilarity(queryVector, vector)
          results.push({ id, similarity })
        }
      }

      // Sort by similarity (descending) and return top k
      results.sort((a, b) => b.similarity - a.similarity)
      return results.slice(0, k)
    }

    /**
     * Brute force search (fallback when ANN returns no candidates)
     */
    bruteForceSearch(
      queryVector: number[],
      k: number
    ): Array<{ id: string; similarity: number }> {
      const results: Array<{ id: string; similarity: number }> = []

      for (const [id, vector] of this.vectors) {
        const similarity = this.computeSimilarity(queryVector, vector)
        results.push({ id, similarity })
      }

      results.sort((a, b) => b.similarity - a.similarity)
      return results.slice(0, k)
    }

    /**
     * Compute cosine similarity with caching
     */
    private computeSimilarity(vectorA: number[], vectorB: number[]): number {
      // Create cache key (sorted vector IDs or content hash)
      const cacheKey = this.createSimilarityCacheKey(vectorA, vectorB)

      // Check cache
      const cached = this.similarityCache.get(cacheKey)
      if (cached !== undefined) {
        this.cacheHitCount++
        return cached
      }

      // Compute similarity
      const similarity = EmbeddingService.cosineSimilarity(vectorA, vectorB)

      // Cache result
      this.similarityCache.set(cacheKey, similarity)

      return similarity
    }

    /**
     * Create a cache key for similarity between two vectors
     */
    private createSimilarityCacheKey(vectorA: number[], vectorB: number[]): string {
      // Use a simple hash of the vectors
      const hashA = this.hashVector(vectorA)
      const hashB = this.hashVector(vectorB)
      // Ensure consistent ordering
      return hashA < hashB ? `${hashA}:${hashB}` : `${hashB}:${hashA}`
    }

    /**
     * Simple hash function for vector
     */
    private hashVector(vector: number[]): string {
      let hash = 0
      for (let i = 0; i < Math.min(vector.length, 16); i++) {
        hash = (hash * 31 + Math.round(vector[i] * 1000)) | 0
      }
      return hash.toString(36)
    }

    /**
     * Clear similarity cache entries related to a specific ID
     */
    private clearSimilarityCacheForId(id: string): void {
      // Note: This is a simplified approach. In production, you'd want
      // to track which cache entries involve which IDs.
      // For now, we'll just clear the entire cache if it's small
      if (this.similarityCache.size < 1000) {
        this.similarityCache.clear()
      }
    }

    /**
     * Get embedding from cache or compute it
     */
    getCachedEmbedding(key: string, compute: () => number[]): number[] {
      const cached = this.embeddingCache.get(key)
      if (cached) {
        this.cacheHitCount++
        return cached
      }

      const embedding = compute()
      this.embeddingCache.set(key, embedding)
      return embedding
    }

    /**
     * Cache an embedding
     */
    cacheEmbedding(key: string, embedding: number[]): void {
      this.embeddingCache.set(key, embedding)
    }

    /**
     * Get cached embedding if available
     */
    getEmbeddingFromCache(key: string): number[] | undefined {
      return this.embeddingCache.get(key)
    }

    /**
     * Get a vector by ID
     */
    getVector(id: string): number[] | undefined {
      const vector = this.vectors.get(id)
      return vector ? [...vector] : undefined
    }

    /**
     * Check if a vector exists
     */
    hasVector(id: string): boolean {
      return this.vectors.has(id)
    }

    /**
     * Get total number of vectors
     */
    get size(): number {
      return this.vectors.size
    }

    /**
     * Get all vector IDs
     */
    getIds(): string[] {
      return Array.from(this.vectors.keys())
    }

    /**
     * Clear all data
     */
    clear(): void {
      this.vectors.clear()
      this.embeddingCache.clear()
      this.similarityCache.clear()

      // Reinitialize hash tables
      this.hashTables = []
      for (let i = 0; i < this.numTables; i++) {
        this.hashTables.push(new LSHHashTable(this.dim, this.bucketSize))
      }
    }

    /**
     * Get performance metrics
     */
    getMetrics(): {
      vectorCount: number
      embeddingCacheSize: number
      similarityCacheSize: number
      totalSearches: number
      approximateSearches: number
      bruteForceFallbacks: number
      cacheHits: number
      cacheHitRate: number
      avgBucketSize: number
    } {
      const totalBucketSize = this.hashTables.reduce(
        (sum, table) => sum + table.getBucketCount(),
        0
      )
      const avgBucketSize = this.hashTables.length > 0
        ? totalBucketSize / this.hashTables.length
        : 0

      const totalCacheRequests = this.searchCount + this.cacheHitCount
      const cacheHitRate = totalCacheRequests > 0
        ? this.cacheHitCount / totalCacheRequests
        : 0

      return {
        vectorCount: this.vectors.size,
        embeddingCacheSize: this.embeddingCache.size,
        similarityCacheSize: this.similarityCache.size,
        totalSearches: this.searchCount,
        approximateSearches: this.approximateSearchCount,
        bruteForceFallbacks: this.searchCount - this.approximateSearchCount,
        cacheHits: this.cacheHitCount,
        cacheHitRate,
        avgBucketSize,
      }
    }

    /**
     * Serialize index to JSON (for persistence)
     */
    serialize(): {
      vectors: Array<{ id: string; vector: number[] }>
      options: {
        dim: number
        numTables: number
        bucketSize: number
      }
    } {
      return {
        vectors: Array.from(this.vectors.entries()).map(([id, vector]) => ({
          id,
          vector,
        })),
        options: {
          dim: this.dim,
          numTables: this.numTables,
          bucketSize: this.bucketSize,
        },
      }
    }

    /**
     * Deserialize index from JSON
     */
    deserialize(data: {
      vectors: Array<{ id: string; vector: number[] }>
      options: {
        dim: number
        numTables: number
        bucketSize: number
      }
    }): void {
      this.clear()

      // Verify options match
      if (
        data.options.dim !== this.dim ||
        data.options.numTables !== this.numTables ||
        data.options.bucketSize !== this.bucketSize
      ) {
        console.warn(
          "ANNIndex options mismatch during deserialization. " +
          "Rebuilding with current options."
        )
      }

      // Add all vectors
      for (const { id, vector } of data.vectors) {
        this.addVector(id, vector)
      }
    }
  }

  /**
   * Task-Index Mapping for semantic task search
   */
  export class TaskVectorIndex {
    private index: ANNIndex
    private taskMetadata = new Map<string, {
      taskType?: string
      description: string
      timestamp: number
    }>()

    constructor(options?: ConstructorParameters<typeof ANNIndex>[0]) {
      this.index = new ANNIndex(options)
    }

    /**
     * Index a task with its embedding
     */
    indexTask(taskId: string, task: {
      description: string
      taskType?: string
      metadata?: Record<string, any>
    }): void {
      // Generate or get cached embedding
      const embedding = this.index.getCachedEmbedding(
        `task:${taskId}`,
        () => EmbeddingService.generateTaskEmbedding(task)
      )

      // Add to index
      this.index.addVector(taskId, embedding)

      // Store metadata
      this.taskMetadata.set(taskId, {
        taskType: task.taskType,
        description: task.description,
        timestamp: Date.now(),
      })
    }

    /**
     * Remove a task from the index
     */
    removeTask(taskId: string): boolean {
      this.taskMetadata.delete(taskId)
      return this.index.removeVector(taskId)
    }

    /**
     * Find similar tasks
     */
    findSimilarTasks(
      queryTask: { description: string; taskType?: string; metadata?: Record<string, any> },
      k: number
    ): Array<{ taskId: string; similarity: number; taskType?: string }> {
      // Generate query embedding
      const queryEmbedding = EmbeddingService.generateTaskEmbedding(queryTask)

      // Search index
      const results = this.index.searchNearest(queryEmbedding, k)

      // Add metadata to results
      return results.map((result) => {
        const metadata = this.taskMetadata.get(result.id)
        return {
          taskId: result.id,
          similarity: result.similarity,
          taskType: metadata?.taskType,
        }
      })
    }

    /**
     * Search for tasks similar to a given embedding
     */
    searchByEmbedding(
      embedding: number[],
      k: number
    ): Array<{ taskId: string; similarity: number; taskType?: string }> {
      const results = this.index.searchNearest(embedding, k)

      return results.map((result) => {
        const metadata = this.taskMetadata.get(result.id)
        return {
          taskId: result.id,
          similarity: result.similarity,
          taskType: metadata?.taskType,
        }
      })
    }

    /**
     * Get task count
     */
    get size(): number {
      return this.index.size
    }

    /**
     * Get index metrics
     */
    getMetrics(): ReturnType<ANNIndex["getMetrics"]> {
      return this.index.getMetrics()
    }

    /**
     * Clear all tasks
     */
    clear(): void {
      this.index.clear()
      this.taskMetadata.clear()
    }
  }

  /**
   * Agent Capability Index for fast agent matching
   */
  export class AgentCapabilityIndex {
    private index: ANNIndex
    private agentCapabilities = new Map<string, {
      agentType: string
      expertise: string[]
      maxCapacity: number
    }>()

    constructor(options?: ConstructorParameters<typeof ANNIndex>[0]) {
      this.index = new ANNIndex(options)
    }

    /**
     * Index an agent with its capability embedding
     */
    indexAgent(agentId: string, agent: {
      name: string
      agentType: string
      expertise?: string[]
      prompt?: string
      maxCapacity?: number
    }): void {
      // Generate or get cached embedding
      const embedding = this.index.getCachedEmbedding(
        `agent:${agentId}`,
        () => EmbeddingService.generateAgentCapabilities(agent)
      )

      // Add to index
      this.index.addVector(agentId, embedding)

      // Store capabilities
      this.agentCapabilities.set(agentId, {
        agentType: agent.agentType,
        expertise: agent.expertise || [],
        maxCapacity: agent.maxCapacity || 3,
      })
    }

    /**
     * Remove an agent from the index
     */
    removeAgent(agentId: string): boolean {
      this.agentCapabilities.delete(agentId)
      return this.index.removeVector(agentId)
    }

    /**
     * Find agents capable of handling a task
     */
    findCapableAgents(
      task: { description: string; taskType?: string; metadata?: Record<string, any> },
      k: number
    ): Array<{
      agentId: string
      similarity: number
      agentType: string
      expertise: string[]
    }> {
      // Generate task embedding
      const taskEmbedding = EmbeddingService.generateTaskEmbedding(task)

      // Search for similar agent capabilities
      const results = this.index.searchNearest(taskEmbedding, k)

      // Add capability info to results
      return results.map((result) => {
        const capabilities = this.agentCapabilities.get(result.id)!
        return {
          agentId: result.id,
          similarity: result.similarity,
          agentType: capabilities.agentType,
          expertise: capabilities.expertise,
        }
      })
    }

    /**
     * Get agent count
     */
    get size(): number {
      return this.index.size
    }

    /**
     * Get index metrics
     */
    getMetrics(): ReturnType<ANNIndex["getMetrics"]> {
      return this.index.getMetrics()
    }

    /**
     * Clear all agents
     */
    clear(): void {
      this.index.clear()
      this.agentCapabilities.clear()
    }
  }

  /**
   * Create a default task index
   */
  export function createTaskIndex(options?: ConstructorParameters<typeof ANNIndex>[0]): TaskVectorIndex {
    return new TaskVectorIndex(options)
  }

  /**
   * Create a default agent capability index
   */
  export function createAgentIndex(options?: ConstructorParameters<typeof ANNIndex>[0]): AgentCapabilityIndex {
    return new AgentCapabilityIndex(options)
  }
}
