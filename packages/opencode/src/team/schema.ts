import { z } from "zod"
import { ModelID, ProviderID } from "../provider/schema"

export namespace Team {
  export const MemberState = z.enum([
    "ready",
    "busy",
    "shutdown_requested",
    "shutdown",
    "error",
  ])
  export type MemberState = z.infer<typeof MemberState>

  export const ExecutionState = z.enum([
    "thinking",
    "calling_tool",
    "waiting_message",
    "responding",
    "complete",
    "cancelling",
    "idle",
  ])
  export type ExecutionState = z.infer<typeof ExecutionState>

  export const MemberConfig = z.object({
    name: z.string(),
    model: z.string().optional(),
    prompt: z.string().optional(),
    agentType: z.string(),
    color: z.string().optional(),
    planModeRequired: z.boolean().optional(),
  })
  export type MemberConfig = z.infer<typeof MemberConfig>

  export const Config = z.object({
    team: z.string(),
    lead: z.string(),
    description: z.string().optional(),
    members: z.array(MemberConfig),
    createdAt: z.number().optional(),
  })
  export type Config = z.infer<typeof Config>

  export const Session = z.object({
    sessionId: z.string(),
    agentName: z.string(),
    model: z.string(),
    teamName: z.string(),
    status: MemberState,
    executionStatus: ExecutionState,
    createdAt: z.number(),
    lastActivity: z.number().optional(),
  })
  export type Session = z.infer<typeof Session>

  export const Message = z.object({
    id: z.string(),
    from: z.string(),
    to: z.string(),
    text: z.string(),
    timestamp: z.number(),
    read: z.boolean(),
    type: z.enum(["message", "broadcast", "system", "receipt"]).default("message"),
    metadata: z.record(z.any()).optional(),
  })
  export type Message = z.infer<typeof Message>

  export const TaskStatus = z.enum([
    "pending",
    "in_progress",
    "completed",
    "failed",
    "blocked",
  ])
  export type TaskStatus = z.infer<typeof TaskStatus>

  export const Task = z.object({
    id: z.string(),
    description: z.string(),
    status: TaskStatus,
    claimedBy: z.string().nullable(),
    dependsOn: z.array(z.string()).default([]),
    createdAt: z.number(),
    completedAt: z.number().optional(),
    metadata: z.record(z.any()).optional(),
  })
  export type Task = z.infer<typeof Task>
}
