import { useToastStore } from '@/store/useToastStore'
import { CheckCircle, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Toaster() {
  const { message, variant, open } = useToastStore()

  if (!open || !message) return null

  return (
    <div
      role="alert"
      className={cn(
        'fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 flex items-center gap-2 rounded-lg px-4 py-3 shadow-lg border transition-all duration-200',
        variant === 'success'
          ? 'bg-emerald-50 dark:bg-emerald-950/90 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
          : 'bg-red-50 dark:bg-red-950/90 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
      )}
    >
      {variant === 'success' ? (
        <CheckCircle className="h-5 w-5 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
      ) : (
        <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
      )}
      <span className="text-sm font-medium">{message}</span>
    </div>
  )
}
