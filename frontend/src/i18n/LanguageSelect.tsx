import { useId } from 'react'
import { Check, ChevronDown, Languages } from 'lucide-react'
import { useTranslation, type Language } from './index'
import { useConfigStore } from '@/store/useConfigStore'
import { cn } from '@/lib/utils'
import './languageSelect.css'

const LANGUAGE_OPTIONS = [
  { value: 'zh-CN', label: '简体中文', lang: 'zh-CN' },
  { value: 'en-US', label: 'English', lang: 'en' },
] as const

export function LanguageSelect({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const groupId = useId()
  const language = useConfigStore(state => state.config.language)
  const changeLanguage = useConfigStore(state => state.setLanguage)

  if (compact) {
    return (
      <label className="language-compact">
        <span>{t('界面语言')}</span>
        <span className="language-compact-picker">
          <select
            aria-label={t('界面语言')}
            value={language}
            onChange={event => changeLanguage(event.target.value as Language)}
          >
            {LANGUAGE_OPTIONS.map(option => (
              <option key={option.value} value={option.value} lang={option.lang}>{option.label}</option>
            ))}
          </select>
          <ChevronDown size={14} aria-hidden />
        </span>
      </label>
    )
  }

  return (
    <div className="language-preference">
      <div className="language-preference-copy">
        <span id={`${groupId}-label`} className="language-preference-title">{t('界面语言')}</span>
      </div>
      <fieldset
        className="language-options"
        aria-labelledby={`${groupId}-label`}
      >
        {LANGUAGE_OPTIONS.map(option => (
          <label key={option.value} className={cn('language-option', language === option.value && 'is-selected')}>
            <input
              className="sr-only"
              type="radio"
              name={`interface-language-${groupId}`}
              value={option.value}
              checked={language === option.value}
              onChange={() => changeLanguage(option.value)}
            />
            <span lang={option.lang}>{option.label}</span>
            <Check size={14} className="language-option-check" aria-hidden />
          </label>
        ))}
      </fieldset>
    </div>
  )
}

export function LanguageToggle({ className }: { className?: string }) {
  const { t } = useTranslation()
  const language = useConfigStore(state => state.config.language)
  const changeLanguage = useConfigStore(state => state.setLanguage)
  const label = language === 'zh-CN'
    ? t('切换为 English（当前：简体中文）')
    : t('切换为简体中文（当前：English）')

  return (
    <button
      type="button"
      className={cn('language-toggle', className)}
      aria-label={label}
      title={label}
      onClick={() => changeLanguage(language === 'zh-CN' ? 'en-US' : 'zh-CN')}
    >
      <Languages size={18} aria-hidden />
    </button>
  )
}
