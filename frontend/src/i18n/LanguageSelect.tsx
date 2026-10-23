import { useTranslation, type Language } from './index'
import { useConfigStore } from '@/store/useConfigStore'

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const language = useConfigStore(state => state.config.language)
  const changeLanguage = useConfigStore(state => state.setLanguage)
  return (
    <label className={compact ? 'inline-flex items-center gap-2 text-sm' : 'flex flex-wrap items-center justify-between gap-3'}>
      <span>{t('界面语言')}</span>
      <select
        aria-label={t('界面语言')}
        value={language}
        onChange={event => changeLanguage(event.target.value as Language)}
        className="min-h-10 rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <option value="zh-CN" lang="zh-CN">简体中文</option>
        <option value="en-US" lang="en">English</option>
      </select>
    </label>
  )
}
