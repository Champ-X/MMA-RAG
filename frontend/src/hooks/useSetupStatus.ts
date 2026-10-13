import { createContext, useContext } from 'react'
import type { SetupStatus } from '@/services/setup'

// Reuse the gate's read so settings never guesses the installation mode.
export const SetupStatusContext = createContext<SetupStatus | null>(null)
export const useSetupStatus = () => useContext(SetupStatusContext)
