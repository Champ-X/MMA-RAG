export const taskRoles = [
  ['quick_synthesis', 'Quick synthesis', 'text'],
  ['research_synthesis', 'Research synthesis', 'text'],
  ['planning', 'Research planning', 'text'],
  ['verification', 'Claim verification', 'text'],
  ['query_intent', 'Intent recognition', 'text'],
  ['query_rewrite', 'Query rewrite', 'text'],
  ['space_routing', 'Space auto-routing', 'text'],
  ['image_caption', 'Standalone image caption', 'vision'],
  ['document_figure_caption', 'Document figure caption', 'vision'],
  ['video_understanding', 'Video scene / keyframe understanding', 'vision'],
  ['audio_transcription', 'Audio transcription', 'audio_transcription'],
  ['video_audio_transcription', 'Video audio-track transcription', 'audio_transcription'],
  ['dense_embedding', 'Dense embedding', 'embedding'],
  ['reranking', 'Reranking', 'rerank'],
] as const

export const taskLabel = (role: string) =>
  taskRoles.find(([id]) => id === role)?.[1] ?? role.replaceAll('_', ' ')
