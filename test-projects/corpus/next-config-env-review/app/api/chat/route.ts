import { streamText } from 'ai'
import { z } from 'zod'

export const maxDuration = 60

const chatSchema = z.object({ message: z.string().trim().min(1).max(4000) })

export async function POST(request: Request): Promise<Response> {
  const parsed = chatSchema.safeParse(await request.json())
  if (!parsed.success) return Response.json({ error: 'Invalid message' }, { status: 400 })

  // Read from the deploy environment but missing from .env.example: the next
  // person to deploy this does not know the variable exists.
  const model = process.env.CHAT_MODEL_ID ?? 'anthropic/claude-sonnet-5-5'
  const result = streamText({ model, prompt: parsed.data.message })
  return result.toTextStreamResponse()
}
