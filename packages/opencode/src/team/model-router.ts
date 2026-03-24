import { ModelID, ProviderID } from "../provider/schema"
import { Team } from "./schema"
import { Log } from "../util/log"

const log = Log.create({ service: "team.model-router" })

/**
 * Parsed model configuration for routing.
 */
export interface ModelConfig {
  providerID: ProviderID
  modelID: ModelID
}

/**
 * Parse a model string into provider and model components.
 *
 * Supported formats:
 * - "claude" -> { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
 * - "sonnet" -> { providerID: "anthropic", modelID: "claude-3-5-sonnet" }
 * - "opus" -> { providerID: "anthropic", modelID: "claude-3-opus" }
 * - "haiku" -> { providerID: "anthropic", modelID: "claude-3-5-haiku" }
 * - "codex" -> { providerID: "openai", modelID: "codex" }
 * - "gemini" -> { providerID: "google", modelID: "gemini-1.5-pro" }
 * - "anthropic/claude-3-opus" -> { providerID: "anthropic", modelID: "claude-3-opus" }
 * - "openai/gpt-4" -> { providerID: "openai", modelID: "gpt-4" }
 *
 * If the model string contains a "/", it's treated as "provider/model".
 */
export function parseModelString(model: string): ModelConfig | null {
  if (!model || model.trim() === "") {
    return null
  }

  const trimmed = model.trim().toLowerCase()

  // Handle provider/model format
  if (trimmed.includes("/")) {
    const [provider, modelName] = trimmed.split("/", 2)
    if (provider && modelName) {
      return {
        providerID: ProviderID.make(provider),
        modelID: ModelID.make(modelName),
      }
    }
  }

  // Handle shorthand aliases
  const aliases: Record<string, ModelConfig> = {
    // Anthropic models
    "claude": { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-5-sonnet") },
    "sonnet": { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-5-sonnet") },
    "opus": { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-opus") },
    "haiku": { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-5-haiku") },
    "claude-sonnet": { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-5-sonnet") },
    "claude-opus": { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-opus") },
    "claude-haiku": { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-5-haiku") },

    // OpenAI models
    "codex": { providerID: ProviderID.openai, modelID: ModelID.make("codex") },
    "gpt4": { providerID: ProviderID.openai, modelID: ModelID.make("gpt-4") },
    "gpt-4": { providerID: ProviderID.openai, modelID: ModelID.make("gpt-4") },
    "gpt4o": { providerID: ProviderID.openai, modelID: ModelID.make("gpt-4o") },
    "gpt-4o": { providerID: ProviderID.openai, modelID: ModelID.make("gpt-4o") },

    // Google models
    "gemini": { providerID: ProviderID.google, modelID: ModelID.make("gemini-1.5-pro") },
    "gemini-pro": { providerID: ProviderID.google, modelID: ModelID.make("gemini-1.5-pro") },
  }

  const alias = aliases[trimmed]
  if (alias) {
    return alias
  }

  // Unknown model - log warning and return null
  log.warn(`Unknown model alias: "${model}". Using default model.`)
  return null
}

/**
 * Get the model config for a team member.
 * Returns null if no model is configured.
 */
export function getMemberModel(member: Team.MemberConfig): ModelConfig | null {
  if (!member.model) {
    return null
  }
  return parseModelString(member.model)
}

/**
 * Model recommendations for different agent types.
 * These are sensible defaults that can be overridden.
 */
export const ModelRecommendations = {
  // Fast, cost-effective for exploration
  explore: { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-5-haiku") },

  // Balanced for most tasks
  general: { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-5-sonnet") },

  // Powerful for complex planning
  plan: { providerID: ProviderID.anthropic, modelID: ModelID.make("claude-3-opus") },

  // Code-specific
  code: { providerID: ProviderID.openai, modelID: ModelID.make("codex") },
} as const

/**
 * Get recommended model for an agent type.
 */
export function getRecommendedModel(agentType: string): ModelConfig {
  switch (agentType) {
    case "Explore":
      return ModelRecommendations.explore
    case "Plan":
      return ModelRecommendations.plan
    case "general-purpose":
    default:
      return ModelRecommendations.general
  }
}

/**
 * Resolve the effective model for a team member.
 * Priority: member config > agent type recommendation > null
 */
export function resolveMemberModel(member: Team.MemberConfig): ModelConfig | null {
  // First check member's explicit model config
  const memberModel = getMemberModel(member)
  if (memberModel) {
    return memberModel
  }

  // Fall back to agent type recommendation
  return getRecommendedModel(member.agentType)
}
