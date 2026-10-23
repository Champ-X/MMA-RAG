import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { coreEnglish } from './core.en'
import { uiEnglish } from './ui.en'
import { piEnglish } from './pi.en'
import { decisionEnglish } from './decision.en'
import { chatEnglish } from './chat.en'
import { languageControlsEnglish } from './languageControls.en'
import { conversationActionsEnglish } from './conversationActions.en'

export type Language = 'zh-CN' | 'en-US'
export const normalizeLanguage = (value: unknown): Language => value === 'en-US' ? 'en-US' : 'zh-CN'

function savedLanguage(): Language {
  try {
    if (typeof localStorage === 'undefined') return 'zh-CN'
    return normalizeLanguage(JSON.parse(localStorage.getItem('config-store') || '{}')?.state?.config?.language)
  } catch { return 'zh-CN' }
}

export const englishMessages: Record<string, string> = { ...uiEnglish, ...coreEnglish, ...piEnglish, ...decisionEnglish, ...chatEnglish, ...languageControlsEnglish, ...conversationActionsEnglish }
const chineseMessages = Object.fromEntries(Object.keys(englishMessages).map(key => [key, key]))

// Source-language keys keep existing Chinese copy authoritative. Only explicit
// UI messages pass through this catalog; documents and model answers never do.
void i18next.use(initReactI18next).init({
  lng: savedLanguage(),
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en-US'],
  resources: {
    'zh-CN': { translation: chineseMessages },
    'en-US': { translation: englishMessages },
  },
  keySeparator: false,
  nsSeparator: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  initAsync: false,
})

export function getLanguage(): Language { return normalizeLanguage(i18next.language) }
export function setLanguage(language: Language): void { void i18next.changeLanguage(normalizeLanguage(language)) }
export function translate(text: string, values?: Record<string, unknown>): string {
  return String(i18next.t(text, values ?? {}))
}

function updateDocumentLanguage() {
  if (typeof document !== 'undefined') document.documentElement.lang = getLanguage()
}
i18next.on('languageChanged', updateDocumentLanguage)
updateDocumentLanguage()

export { useTranslation } from 'react-i18next'
export { i18next }
