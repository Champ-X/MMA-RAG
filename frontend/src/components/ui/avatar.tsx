import { forwardRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface AvatarProps {
  src?: string | null
  alt?: string
  /** 无图片或加载失败时显示（图标或首字母等） */
  fallback: React.ReactNode
  size?: 'sm' | 'md' | 'lg'
  className?: string
  rootClassName?: string
  fallbackClassName?: string
}

const sizeMap = { sm: 'h-8 w-8', md: 'h-9 w-9', lg: 'h-11 w-11' } as const

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
  ({ src, alt, fallback, size = 'md', className, rootClassName, fallbackClassName }, ref) => {
    const [imgFailed, setImgFailed] = useState(false)
    const showImg = Boolean(src && !imgFailed)
    return (
      <div
        ref={ref}
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden rounded-full',
          sizeMap[size],
          rootClassName
        )}
      >
        {showImg && (
          <img
            src={src!}
            alt={alt ?? ''}
            className={cn('aspect-square h-full w-full object-cover', className)}
            onError={() => setImgFailed(true)}
          />
        )}
        <div
          className={cn(
            'flex h-full w-full items-center justify-center',
            !showImg && 'bg-muted text-muted-foreground',
            fallbackClassName
          )}
          style={showImg ? { display: 'none' } : undefined}
        >
          {fallback}
        </div>
      </div>
    )
  }
)
Avatar.displayName = 'Avatar'
