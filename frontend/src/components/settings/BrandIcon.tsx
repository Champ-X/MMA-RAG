import { useState } from 'react'
import { getOpenRouterIconUrlCandidates } from '@/lib/lobeOpenRouterIcons'
import { getModelVendor, VENDOR_LOGOS } from '@/lib/modelVendors'
import { cn } from '@/lib/utils'
import './brandSelect.css'

type BrandIconProps = {
  provider?: string
  modelId?: string
  size?: number
  className?: string
}

const PROVIDER_ASSETS: Record<string, string> = {
  typesafe: '/vendor-logos/typesafe.png',
  openrouter: '/vendor-logos/openrouter.svg',
  deepseek: '/vendor-logos/deepseek.png',
  siliconflow: '/vendor-logos/siliconcloud.png',
  siliconcloud: '/vendor-logos/siliconcloud.png',
  aliyunbailian: '/vendor-logos/bailian.png',
}

const MODEL_BRAND_ASSETS: Record<string, string> = {
  openai: '/vendor-logos/openai.svg',
  typesafe: '/vendor-logos/typesafe.png',
  inception: '/vendor-logos/inception.svg',
  perplexity: '/vendor-logos/perplexity.svg',
  liquid: '/vendor-logos/liquid.svg',
  cloudflare: '/vendor-logos/cloudflare.svg',
  togethercomputer: '/vendor-logos/together.svg',
  upstage: '/vendor-logos/upstage.svg',
}

const DARK_ASSETS: Record<string, string> = {
  '/vendor-logos/together.svg': '/vendor-logos/together-dark.svg',
}

function iconSources(provider?: string, modelId?: string): string[] {
  const providerKey = provider?.toLowerCase().replace(/[_\s-]/g, '') ?? ''
  if (!modelId) return PROVIDER_ASSETS[providerKey] ? [PROVIDER_ASSETS[providerKey]] : []
  const model = modelId.replace(/^(openrouter|deepseek|aliyun_bailian|siliconflow|siliconcloud):/, '')
  const organization = model.split('/')[0].toLowerCase()
  if (model.toLowerCase().startsWith('jev-')) return [MODEL_BRAND_ASSETS.typesafe]
  if (MODEL_BRAND_ASSETS[organization]) return [MODEL_BRAND_ASSETS[organization]]
  const vendorLogo = VENDOR_LOGOS[getModelVendor(model)]
  if (vendorLogo) return [vendorLogo]
  // No published brand mark: show an explicit monogram instead of another company's logo.
  if (organization === 'jaredpalmer') return []
  if ((providerKey === 'openrouter' || modelId.startsWith('openrouter:')) && model.includes('/')) {
    return getOpenRouterIconUrlCandidates(model)
  }
  return []
}

function BrandIconImage({ provider, modelId, size = 20, className }: BrandIconProps) {
  const [failedIndex, setFailedIndex] = useState(0)
  const sources = iconSources(provider, modelId)
  const source = sources[failedIndex]
  const darkSource = source ? DARK_ASSETS[source] : undefined
  const rawBrand = modelId?.replace(/^openrouter:/, '').split('/')[0] || provider || 'AI'
  const monogram = rawBrand === 'jaredpalmer' ? 'JP' : rawBrand.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'AI'
  const monochrome = Boolean(source && /\/(openai|openrouter|anthropic|inception|liquid)\.svg$/.test(source))

  return (
    <span
      className={cn('brand-icon', !source && 'brand-icon--fallback', monochrome && 'brand-icon--monochrome', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {source ? (
        <>
          <img className={darkSource ? 'brand-icon-image--light' : undefined} src={source} alt="" width={size} height={size} decoding="async" onError={() => setFailedIndex(index => index + 1)} />
          {darkSource && <img className="brand-icon-image--dark" src={darkSource} alt="" width={size} height={size} decoding="async" onError={() => setFailedIndex(index => index + 1)} />}
        </>
      ) : monogram}
    </span>
  )
}

/** Provider-only calls show the route; model calls show the actual model's brand. */
export function BrandIcon(props: BrandIconProps) {
  return <BrandIconImage key={`${props.provider ?? ''}:${props.modelId ?? ''}`} {...props} />
}
