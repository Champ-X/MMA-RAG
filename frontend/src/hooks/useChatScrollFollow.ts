import { useCallback, useLayoutEffect, useRef, type RefObject } from 'react'
import { attachChatScrollFollow, type ChatScrollFollower } from '@/lib/chatScrollFollow'

export function useChatScrollFollow(
  scrollAreaRef: RefObject<HTMLDivElement>,
  contentRef: RefObject<HTMLDivElement>,
  sessionId: string | null,
) {
  const followerRef = useRef<ChatScrollFollower | null>(null)
  useLayoutEffect(() => {
    const viewport = scrollAreaRef.current?.firstElementChild as HTMLElement | null
    const content = contentRef.current
    if (!viewport || !content) return
    const follower = attachChatScrollFollow(viewport, content)
    followerRef.current = follower
    return () => {
      follower.destroy()
      followerRef.current = null
    }
  }, [scrollAreaRef, contentRef, sessionId])

  return useCallback(() => followerRef.current?.reset(), [])
}
