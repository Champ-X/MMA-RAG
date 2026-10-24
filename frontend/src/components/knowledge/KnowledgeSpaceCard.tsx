import { useState } from 'react'
import { MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { getLanguage, translate as t, useTranslation } from '@/i18n'
import { cn } from '@/lib/utils'
import type { KnowledgeBase } from '@/store/useKnowledgeStore'
import './knowledgeSpaceCard.css'

interface KnowledgeSpaceCardProps {
  knowledgeBase: KnowledgeBase
  fallbackSrc: string
  fallbackTint: string
  menuOpen: boolean
  onOpen: () => void
  onToggleMenu: () => void
  onEdit: () => void
  onDelete: () => void
}

/** Cover availability changes the background, never the card's content geometry. */
export function KnowledgeSpaceCard({
  knowledgeBase: kb, fallbackSrc, fallbackTint, menuOpen,
  onOpen, onToggleMenu, onEdit, onDelete,
}: KnowledgeSpaceCardProps) {
  useTranslation()
  const [coverState, setCoverState] = useState<{ url: string; status: 'ready' | 'failed' } | null>(null)
  const mediaSrc = kb.cover_url?.trim() || undefined
  const hasMediaCover = Boolean(mediaSrc && coverState?.url === mediaSrc && coverState.status === 'ready')
  const coverFailed = coverState?.url === mediaSrc && coverState?.status === 'failed'
  const counts = [
    { icon: '📄', count: kb.stats?.documents ?? 0, label: t('文件') },
    { icon: '🖼️', count: kb.stats?.images ?? 0, label: t('图片') },
    { icon: '🎵', count: kb.stats?.audio ?? 0, label: t('音频') },
    { icon: '🎥', count: kb.stats?.video ?? 0, label: t('视频') },
  ]

  return (
    <div
      data-cover-kind={hasMediaCover ? 'media' : 'default'}
      className="knowledge-space-card group relative flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 ring-1 ring-transparent transition-all duration-300 hover:-translate-y-1.5 hover:border-fuchsia-400 hover:shadow-[0_24px_44px_-22px_rgba(168,85,247,0.24)] hover:ring-fuchsia-200/90 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-fuchsia-400 dark:hover:ring-fuchsia-500/35"
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={t('打开知识库：{{value1}}', { value1: kb.name })}
        title={t('打开知识库：{{value1}}', { value1: kb.name })}
        className="absolute inset-0 z-20 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-50 dark:focus-visible:ring-fuchsia-400/40 dark:focus-visible:ring-offset-slate-950"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: `url(${fallbackSrc})` }}
      />
      {mediaSrc && !coverFailed && (
        <img
          key={mediaSrc}
          src={mediaSrc}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={(event) => setCoverState({ url: mediaSrc, status: event.currentTarget.naturalWidth > 0 ? 'ready' : 'failed' })}
          onError={() => setCoverState({ url: mediaSrc, status: 'failed' })}
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
            hasMediaCover ? 'opacity-100' : 'opacity-0',
          )}
        />
      )}
      <div
        aria-hidden="true"
        className={cn(
          'absolute inset-0 bg-gradient-to-t',
          hasMediaCover
            ? 'from-slate-950/80 via-slate-950/30 to-transparent'
            : [fallbackTint, 'dark:from-slate-950/95 dark:via-slate-950/75 dark:to-slate-950/35'],
        )}
      />
      <div className="pointer-events-none relative z-30 flex h-full min-h-0 flex-col p-3">
        <div className="min-h-0 flex-1" />
        <div className="shrink-0 pb-0.5 pt-2.5">
          <h3 className={cn(
            'mb-0.5 line-clamp-2 min-h-0 break-words text-base font-bold leading-snug sm:text-lg',
            hasMediaCover
              ? 'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_8px_rgba(0,0,0,0.7)]'
              : 'text-slate-900 [text-shadow:0_1px_0_rgba(255,255,255,0.9)] dark:text-slate-100 dark:[text-shadow:none]',
          )}>{kb.name}</h3>
          <p className={cn(
            'line-clamp-2 h-8 overflow-hidden text-ellipsis text-sm leading-snug',
            hasMediaCover
              ? 'text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.9),0_2px_6px_rgba(0,0,0,0.6)]'
              : 'text-slate-600 dark:text-slate-300',
          )}>{kb.description || t('暂无描述')}</p>
          <div className={cn(
            'mt-1.5 flex items-center justify-between gap-2 border-t pt-2 text-[11px]',
            hasMediaCover
              ? 'border-white/30 text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]'
              : 'border-slate-800/10 text-slate-600 dark:border-white/10 dark:text-slate-300',
          )}>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
              {counts.map(({ icon, count, label }, index) => (
                <span key={icon} className="inline-flex shrink-0 items-center gap-1.5">
                  {index > 0 && <span className="knowledge-space-card__count-separator opacity-80">·</span>}
                  <span className="inline-flex items-center gap-1">
                    <span className="text-[13px] leading-none" aria-hidden="true">{icon}</span>
                    {count}<span className="knowledge-space-card__count-label">{label}</span>
                  </span>
                </span>
              ))}
            </div>
            <span className="shrink-0">{kb.updated_at ? new Date(kb.updated_at).toLocaleDateString(getLanguage()) : t('未知')}</span>
            <div className="pointer-events-auto relative z-40 shrink-0">
              <button
                type="button"
                onClick={(event) => { event.stopPropagation(); onToggleMenu() }}
                aria-expanded={menuOpen}
                title={t('更多操作')}
                aria-label={t('更多操作：{{value1}}', { value1: kb.name })}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full border shadow-sm backdrop-blur-sm transition-all active:scale-95',
                  hasMediaCover
                    ? 'border-white/30 bg-white/15 text-white/90 shadow-md hover:border-white/40 hover:bg-white/25 hover:text-white'
                    : 'border-slate-200/90 bg-white/70 text-slate-500 hover:border-indigo-200 hover:bg-white hover:text-indigo-600 dark:border-slate-700/80 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-indigo-400/40 dark:hover:text-indigo-200',
                )}
              ><MoreVertical size={14} strokeWidth={2} /></button>
              {menuOpen && (
                <div
                  className="absolute bottom-full right-0 z-50 mb-1.5 min-w-[120px] rounded-xl border border-slate-200 bg-white/95 py-1 shadow-xl backdrop-blur-sm dark:border-slate-700 dark:bg-slate-800/95"
                  onClick={(event) => event.stopPropagation()}
                >
                  <button type="button" onClick={onEdit} className="flex w-full items-center gap-2 rounded-t-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700">
                    <Pencil size={14} />{t('编辑')}
                  </button>
                  <button type="button" onClick={onDelete} className="flex w-full items-center gap-2 rounded-b-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20">
                    <Trash2 size={14} />{t('删除')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
