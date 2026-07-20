import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type UiState = {
  railCollapsed: boolean
  selectedEvidenceId: string | null
  toggleRail: () => void
  setRailCollapsed: (collapsed: boolean) => void
  selectEvidence: (id: string | null) => void
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      railCollapsed: false,
      selectedEvidenceId: null,
      toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
      setRailCollapsed: (railCollapsed) => set({ railCollapsed }),
      selectEvidence: (selectedEvidenceId) => set({ selectedEvidenceId }),
    }),
    {
      name: 'mma-rag-nexus-ui',
      partialize: (state) => ({ railCollapsed: state.railCollapsed }),
    },
  ),
)
