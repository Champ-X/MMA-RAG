import { create } from 'zustand'

export type ToastVariant = 'success' | 'error'

interface ToastState {
  message: string
  variant: ToastVariant
  open: boolean
  showSuccess: (message: string) => void
  showError: (message: string) => void
  hide: () => void
}

const TOAST_DURATION = 2500

export const useToastStore = create<ToastState>((set, get) => ({
  message: '',
  variant: 'success',
  open: false,

  showSuccess: (message: string) => {
    set({ message, variant: 'success', open: true })
    const t = setTimeout(() => {
      if (get().open) set({ open: false })
      clearTimeout(t)
    }, TOAST_DURATION)
  },

  showError: (message: string) => {
    set({ message, variant: 'error', open: true })
    const t = setTimeout(() => {
      if (get().open) set({ open: false })
      clearTimeout(t)
    }, TOAST_DURATION)
  },

  hide: () => set({ open: false }),
}))
