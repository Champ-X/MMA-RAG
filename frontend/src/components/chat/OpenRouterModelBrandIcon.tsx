import { useMemo, useState } from 'react'
import { getOpenRouterFallbackIconUrl, getOpenRouterIconUrlCandidates } from '@/lib/lobeOpenRouterIcons'
import { cn } from '@/lib/utils'

type OpenRouterModelBrandIconProps = {
  modelId: string
  className?: string
  size?: number
}

/**
 * 按 org/model 使用 [Lobe Icons](https://lobehub.com/zh/icons) 静态资源：优先彩色 SVG，再 light/dark PNG，最后单色 SVG。
 * 通过 key 隔离的 Inner 保证切换模型时回退索引从 0 开始，避免沿用上一条模型的 fail 下标。
 */
function OpenRouterModelBrandIconInner({ modelId, className, size = 28 }: OpenRouterModelBrandIconProps) {
  const chain = useMemo(() => getOpenRouterIconUrlCandidates(modelId), [modelId])
  const [index, setIndex] = useState(0)

  const src =
    chain.length === 0
      ? getOpenRouterFallbackIconUrl()
      : (chain[Math.min(index, chain.length - 1)] ?? getOpenRouterFallbackIconUrl())

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={cn(
        'shrink-0 rounded-md bg-white/90 object-contain p-0.5 ring-1 ring-slate-200/70 dark:bg-slate-800/90 dark:ring-slate-600/80',
        className
      )}
      onError={() => {
        setIndex(i => (chain.length === 0 || i >= chain.length - 1 ? i : i + 1))
      }}
    />
  )
}

export function OpenRouterModelBrandIcon(props: OpenRouterModelBrandIconProps) {
  return <OpenRouterModelBrandIconInner key={props.modelId} {...props} />
}
