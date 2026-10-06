import type { Message } from '../store/useChatStore'
import type { PiRun } from '../types/pi'
import { initialPiTrace } from './piTrace'

/** Merge immutable server runs without overwriting newer local stream state.
 * Traces replay from zero; no model request is restarted during recovery. */
export function restorePiMessages(existing: Message[], runs: PiRun[]): Message[] {
  const known = new Set(existing.flatMap(message => message.pi ? [message.pi.runId] : []))
  const added: Message[] = []
  for (const run of runs) {
    if (known.has(run.id)) continue
    known.add(run.id)
    const timestamp = run.created_at * 1000
    added.push({ id: `pi_user_${run.id}`, role: 'user', executionEngine: 'pi',
      content: run.request.message, timestamp, mentions: run.request.mentions, scopeVersion: 2,
      scopeFiles: run.request.selected_files?.map(file => ({ kbId: file.kb_id, fileId: file.file_id,
        name: file.name, type: file.type, kbName: file.kb_name })),
      attachments: run.request.attachments?.map(file => ({ id: file.id, name: file.name, kind: file.modality, size: file.size })) },
    { id: `pi_answer_${run.id}`, role: 'assistant', executionEngine: 'pi', timestamp: timestamp + .01,
      content: run.state.answer || '', citations: run.state.citations || [], pi: initialPiTrace(run) })
  }
  return added.length ? [...existing, ...added].sort((a, b) => a.timestamp - b.timestamp) : existing
}
