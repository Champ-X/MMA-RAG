/**
 * 知识库主题气泡图配色：多套知名/风格化方案，每套 7 档径向渐变节点（按气泡 index 轮转）。
 * 颜色为近似还原，便于与产品 UI 协调；实际显示由 PortraitGraph 内 SVG radialGradient 渲染。
 */

export interface BubbleTierPalette {
  centerLight: string
  fill: string
  mid: string
  edge: string
  glowBorder: string
}

export interface BubbleTheme {
  id: string
  name: string
  category: string
  tiers: readonly BubbleTierPalette[]
}

function glow(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 五档：高光中心、主填充、中间调、边缘深、描边发光 */
function tier(cl: string, fl: string, md: string, ed: string, glowA = 0.34): BubbleTierPalette {
  return { centerLight: cl, fill: fl, mid: md, edge: ed, glowBorder: glow(ed, glowA) }
}

export const BUBBLE_THEME_TIER_COUNT = 7

export const BUBBLE_THEMES: BubbleTheme[] = [
  {
    id: 'ui-code',
    name: '程序员与科技风 · UI/Code',
    category: 'tech',
    tiers: [
      tier('#f0f4ff', '#c7d2fe', '#6366f1', '#3730a3'),
      tier('#eef2ff', '#a5b4fc', '#4f46e5', '#312e81'),
      tier('#f5f3ff', '#c4b5fd', '#7c3aed', '#4c1d95'),
      tier('#fdf4ff', '#f0abfc', '#c026d3', '#86198f'),
      tier('#ecfeff', '#67e8f9', '#0891b2', '#164e63'),
      tier('#ecfdf5', '#6ee7b7', '#059669', '#064e3b'),
      tier('#fff7ed', '#fdba74', '#ea580c', '#9a3412'),
    ],
  },
  {
    id: 'nord',
    name: 'Nord',
    category: 'tech',
    tiers: [
      tier('#eceff4', '#c8e7e3', '#8fbcbb', '#5e81ac'),
      tier('#e5e9f0', '#b8d0e8', '#88c0d0', '#5e81ac'),
      tier('#eceff4', '#c9d4eb', '#81a1c1', '#4c566a'),
      tier('#eceff4', '#e0d4ea', '#b48ead', '#5e4b6b'),
      tier('#eceff4', '#d4e8c8', '#a3be8c', '#5a7a52'),
      tier('#eceff4', '#f5e6c0', '#ebcb8b', '#a87c3a'),
      tier('#eceff4', '#f0d4c8', '#d08770', '#8f4f3a'),
    ],
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    category: 'tech',
    tiers: [
      tier('#f4f0ff', '#d7c8f5', '#cba6f7', '#6c3586'),
      tier('#fff0f3', '#f5c2e7', '#f5c2e7', '#893c6f'),
      tier('#e8f6ff', '#b4e8ff', '#89dceb', '#1a6b7a'),
      tier('#f0fff4', '#b8f2c8', '#a6e3a1', '#3d6b45'),
      tier('#fff8e8', '#ffe1a6', '#f9e2af', '#8a6a1f'),
      tier('#ffecec', '#ffb3c2', '#f38ba8', '#8b2f47'),
      tier('#eef4ff', '#b8ccff', '#89b4fa', '#3d4f8f'),
    ],
  },
  {
    id: 'dracula',
    name: 'Dracula',
    category: 'tech',
    tiers: [
      tier('#f8f4ff', '#e2c6ff', '#bd93f9', '#6272a4'),
      tier('#fff0fa', '#ffb8e8', '#ff79c6', '#a23d78'),
      tier('#e8ffff', '#96f7ff', '#8be9fd', '#3a7d85'),
      tier('#f0fff0', '#b4f7b0', '#50fa7b', '#2d7a45'),
      tier('#fffce8', '#fff1a3', '#f1fa8c', '#7a7020'),
      tier('#fff0e8', '#ffc9a8', '#ffb86c', '#8b5220'),
      tier('#ffecec', '#ff9aad', '#ff5555', '#8b2c2c'),
    ],
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    category: 'tech',
    tiers: [
      tier('#eef2ff', '#b8c4ff', '#7aa2f7', '#3d59a1'),
      tier('#f3e8ff', '#d4b8ff', '#bb9af7', '#5a3d8a'),
      tier('#ffe8f5', '#ffb8e0', '#f7768e', '#8f3650'),
      tier('#e8fff8', '#8fffd9', '#73daca', '#1a7a66'),
      tier('#fff8e8', '#ffe08a', '#e0af68', '#8a6520'),
      tier('#e8f8ff', '#7cdbff', '#7dcfff', '#2a6d8a'),
      tier('#f0f0ff', '#c0c4ff', '#9d7cd8', '#5b3d8c'),
    ],
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    category: 'tech',
    tiers: [
      tier('#fdf6e3', '#eee8d5', '#93a1a1', '#586e75'),
      tier('#fff9e6', '#ffe8b8', '#b58900', '#7d6000'),
      tier('#fff0e8', '#ffc9a3', '#cb4b16', '#8b3a10'),
      tier('#ffe8ec', '#ffb3c0', '#dc322f', '#8b2220'),
      tier('#f3e8ff', '#e0c4f5', '#6c71c4', '#423d7a'),
      tier('#e8f6ff', '#a8d8f0', '#268bd2', '#155a7a'),
      tier('#e8fff4', '#9ee8c8', '#2aa198', '#1a6b5c'),
    ],
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    category: 'tech',
    tiers: [
      tier('#fffff8', '#f0ead8', '#93a1a1', '#657b83'),
      tier('#fffef5', '#f5e6b8', '#b58900', '#8b6914'),
      tier('#fff8f0', '#ffd4b8', '#cb4b16', '#9a4a18'),
      tier('#fff5f5', '#ffc8c8', '#dc322f', '#a02828'),
      tier('#f8f4ff', '#ddd4f5', '#6c71c4', '#4a4580'),
      tier('#f0f8ff', '#c8e4f5', '#268bd2', '#1a5f8a'),
      tier('#f0fff8', '#c8f0e0', '#2aa198', '#1f7564'),
    ],
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    category: 'tech',
    tiers: [
      tier('#fbf1c7', '#e8d5a8', '#d79921', '#9d6a0a'),
      tier('#f9f5d7', '#e8c8a0', '#fe8019', '#af3a03'),
      tier('#fce8e8', '#f0b0b0', '#cc241d', '#8f1f1f'),
      tier('#e8fce8', '#c8e8b8', '#98971a', '#5a6210'),
      tier('#e8fcf0', '#b8e8d0', '#689d6a', '#3d5c3f'),
      tier('#e8f8fc', '#a8e0f0', '#458588', '#2d5a5c'),
      tier('#ece8fc', '#c8c0f0', '#b16286', '#6b3d5a'),
    ],
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    category: 'tech',
    tiers: [
      tier('#f0f4ff', '#b8c8f0', '#61afef', '#3b6ea5'),
      tier('#f3e8ff', '#d0b8f5', '#c678dd', '#7b3fa0'),
      tier('#fff0f0', '#ffb8c8', '#e06c75', '#a03440'),
      tier('#fff8e8', '#ffe4a8', '#e5c07b', '#a67c2a'),
      tier('#f0fff0', '#c8f0b8', '#98c379', '#4a7a3a'),
      tier('#e8ffff', '#a0f0f0', '#56b6c2', '#2a7a82'),
      tier('#fff0f8', '#ffc8e8', '#e06c9a', '#903d62'),
    ],
  },
  {
    id: 'one-light',
    name: 'One Light',
    category: 'tech',
    tiers: [
      tier('#fafbff', '#d4dcf5', '#4078f2', '#2a4a9e'),
      tier('#faf8ff', '#e4d4f8', '#a626a4', '#6a1a6a'),
      tier('#fffafa', '#f5c8c8', '#e45649', '#a03028'),
      tier('#fffef8', '#f5e8c0', '#c18401', '#8a6201'),
      tier('#f8fff8', '#d4f0c8', '#50a14f', '#2d6a2c'),
      tier('#f5ffff', '#c8f0f0', '#0184bc', '#015a82'),
      tier('#fff5fa', '#f5d0e8', '#ca1243', '#8a0c2e'),
    ],
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    category: 'tech',
    tiers: [
      tier('#faf4f8', '#e8d4e8', '#d7827e', '#8f5e5a'),
      tier('#f5f0ff', '#dcc8f0', '#c4a7e7', '#6e4d8f'),
      tier('#f0f8ff', '#c8e0f5', '#9ccfd8', '#4a7a85'),
      tier('#f5fff8', '#d4f0e0', '#a8d4b8', '#4a7a5c'),
      tier('#fffaf0', '#f5e8c8', '#f6c177', '#9a7022'),
      tier('#fff0f5', '#f5c8d8', '#ebbcba', '#8f4a5c'),
      tier('#f0f4f8', '#c8d8e8', '#7c9cbb', '#3d5a78'),
    ],
  },
  {
    id: 'night-owl',
    name: 'Night Owl',
    category: 'tech',
    tiers: [
      tier('#e8f8ff', '#a8e0ff', '#82aaff', '#3d5a99'),
      tier('#f0f8ff', '#b8e8f8', '#7fdbca', '#2a7a70'),
      tier('#fff8f0', '#ffe4c0', '#ffcb8b', '#c48a30'),
      tier('#fff0f8', '#ffc8e8', '#c792ea', '#6b4a8a'),
      tier('#f8fff0', '#d8f5b8', '#c5e478', '#6a8a30'),
      tier('#fff0f0', '#ffb8c0', '#ff637f', '#a03045'),
      tier('#f5f0ff', '#d8d0ff', '#7e57c2', '#4a3580'),
    ],
  },
  {
    id: 'ayu',
    name: 'Ayu',
    category: 'tech',
    tiers: [
      tier('#f8fcff', '#d4ecff', '#73d0ff', '#2a7aaa'),
      tier('#f5fff8', '#c8f5e0', '#b8cc52', '#5a7a28'),
      tier('#fff8f0', '#ffe8c8', '#ffb454', '#c47a20'),
      tier('#fff5f8', '#ffd0e0', '#f07178', '#b04050'),
      tier('#f8f5ff', '#e0d4ff', '#d2a6ff', '#7a4aaa'),
      tier('#f0ffff', '#b8f0f0', '#95e6cb', '#3a8a72'),
      tier('#f5f8ff', '#c8d8f5', '#6cbeff', '#3a6aaa'),
    ],
  },
  {
    id: 'morandi',
    name: 'Morandi',
    category: 'art',
    tiers: [
      tier('#f5f2ef', '#ddd5ce', '#a8998e', '#6d6258'),
      tier('#f0f2f0', '#c8d2cc', '#8a9b93', '#55635c'),
      tier('#f2f0f4', '#d4ced8', '#9a8fa3', '#5c5560'),
      tier('#f4f1ee', '#e0d8d0', '#b5a99a', '#6f665c'),
      tier('#eef2f3', '#c8d4d8', '#8fa3ab', '#556068'),
      tier('#f3f2ef', '#d8d6ce', '#a3a090', '#5e5c54'),
      tier('#f2eff3', '#d8d2dc', '#a89dad', '#5c5460'),
    ],
  },
  {
    id: 'earth',
    name: 'Earth Tones',
    category: 'art',
    tiers: [
      tier('#faf6f0', '#e8dcc8', '#c4a574', '#7a5a30'),
      tier('#f5f0e8', '#dcc8a8', '#a67c52', '#6b4a30'),
      tier('#eef2e8', '#c8d4b8', '#7d8f6a', '#4a5a3c'),
      tier('#f0ebe5', '#d4c8bc', '#9a8a7a', '#5c5048'),
      tier('#f5ebe8', '#e0c8c0', '#b08070', '#6a4538'),
      tier('#f2efe8', '#d8d4c8', '#8a8478', '#504840'),
      tier('#eef0ea', '#c8d0c4', '#6a7a6c', '#3d4a3e'),
    ],
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    category: 'art',
    tiers: [
      tier('#fff0ff', '#ff9cff', '#ff00ff', '#8b008b'),
      tier('#e8ffff', '#5dffff', '#00ffff', '#008b8b'),
      tier('#fffce8', '#fff44d', '#fffc00', '#8b8b00'),
      tier('#ffe8f5', '#ff6ad5', '#ff0080', '#8b0048'),
      tier('#f0e8ff', '#b8a0ff', '#8b00ff', '#4b0082'),
      tier('#e8fff0', '#6cffa8', '#00ff88', '#008850'),
      tier('#fff0e8', '#ff9a6e', '#ff6600', '#8b3800'),
    ],
  },
  {
    id: 'macaron',
    name: 'Macaron',
    category: 'art',
    tiers: [
      tier('#fff5f8', '#ffd6e4', '#ffb3d9', '#d9488c'),
      tier('#f5fff8', '#c8f5e8', '#9ee5d8', '#3aa89a'),
      tier('#fffef5', '#fff4c4', '#ffeaa0', '#d4a520'),
      tier('#f5f8ff', '#d4e4ff', '#b8d4ff', '#5a8ae8'),
      tier('#fff8f5', '#ffe4d4', '#ffc8b8', '#e87850'),
      tier('#f8f5ff', '#e8d8ff', '#d4b8ff', '#8860d0'),
      tier('#f5ffff', '#d4f8ff', '#b8f0ff', '#40a8d8'),
    ],
  },
  {
    id: 'vaporwave',
    name: 'Vaporwave',
    category: 'art',
    tiers: [
      tier('#fff0ff', '#ffb8ff', '#ff71ce', '#b03090'),
      tier('#e8f8ff', '#a8e8ff', '#01cdf9', '#0188a8'),
      tier('#f0e8ff', '#d0b8ff', '#b967ff', '#6a30a8'),
      tier('#fff8f0', '#ffe0c8', '#fffb96', '#c9a820'),
      tier('#ffe8f8', '#ffc8f0', '#ff6ec7', '#a83078'),
      tier('#e8fff8', '#b8ffe8', '#7cffd4', '#30a878'),
      tier('#f8f0ff', '#e0c8ff', '#c9a0ff', '#7040c0'),
    ],
  },
  {
    id: 'memphis',
    name: 'Memphis',
    category: 'art',
    tiers: [
      tier('#fffef0', '#fff44d', '#ffe600', '#c4a800'),
      tier('#ffe8f0', '#ff8cc8', '#ff3d9e', '#b01060'),
      tier('#e8f4ff', '#78c8ff', '#2080ff', '#1040a0'),
      tier('#f0fff0', '#a0ff78', '#40e040', '#208020'),
      tier('#fff0e8', '#ffb060', '#ff7840', '#c04020'),
      tier('#f0e8ff', '#c898ff', '#8848ff', '#4820a0'),
      tier('#f8f8f0', '#e0e0a8', '#a0a060', '#606030'),
    ],
  },
  {
    id: 'bauhaus',
    name: 'Bauhaus',
    category: 'art',
    tiers: [
      tier('#fff8f8', '#ffb0b0', '#e63946', '#9b2226'),
      tier('#fffef8', '#ffe8a0', '#fcbf49', '#c48c08'),
      tier('#f8f8ff', '#b8c8f8', '#457b9d', '#1d3557'),
      tier('#f5f5f5', '#d8d8d8', '#6b6b6b', '#2b2b2b'),
      tier('#fff5f0', '#ffc8a8', '#e76f51', '#a04028'),
      tier('#f0fff8', '#b8f0d8', '#2a9d8f', '#1a6b60'),
      tier('#f8f5ff', '#d0c8f8', '#6a4c93', '#3a2860'),
    ],
  },
  {
    id: 'swiss',
    name: 'Swiss Style',
    category: 'art',
    tiers: [
      tier('#ffffff', '#f0f0f0', '#d0d0d0', '#404040'),
      tier('#fff5f5', '#ffcccc', '#e60000', '#990000'),
      tier('#f8f8f8', '#d0d0d0', '#808080', '#303030'),
      tier('#fffef8', '#f5f0e0', '#e8e0d0', '#5c5a50'),
      tier('#f5f8ff', '#d0d8f0', '#a0a8c0', '#404860'),
      tier('#fafafa', '#e8e8e8', '#b8b8b8', '#505050'),
      tier('#fff8f5', '#f0e8e0', '#d8d0c8', '#585048'),
    ],
  },
  {
    id: 'wabi-sabi',
    name: 'Wabi-sabi',
    category: 'art',
    tiers: [
      tier('#faf8f4', '#e8e4d8', '#c4b8a8', '#6a6054'),
      tier('#f4f5f0', '#d8dcd0', '#9ca090', '#4a5044'),
      tier('#f5f2ee', '#dcd4c8', '#a89888', '#5c5048'),
      tier('#eef2f0', '#c8d4cc', '#7a8a80', '#404840'),
      tier('#f4f0ec', '#d8d0c8', '#a09088', '#504844'),
      tier('#f2f0ee', '#d4d0c8', '#908878', '#484038'),
      tier('#f0f2ee', '#ccd0c4', '#6a7060', '#383c34'),
    ],
  },
  {
    id: 'creamy',
    name: 'Creamy',
    category: 'art',
    tiers: [
      tier('#fffef8', '#faf0dc', '#f5e6c8', '#c4a87a'),
      tier('#fffaf5', '#fce8dc', '#f5d0c0', '#c49888'),
      tier('#f8fff8', '#e8f5e0', '#d4e8c8', '#98b078'),
      tier('#fff8f5', '#ffe8e0', '#ffd4c8', '#d8a090'),
      tier('#f8f8ff', '#e8e8f5', '#d0d4f0', '#9898c0'),
      tier('#fffff8', '#f8f8e8', '#f0f0d8', '#c0c098'),
      tier('#fff5f8', '#fce8f0', '#f5d8e8', '#d0a0b8'),
    ],
  },
  {
    id: 'chinese-traditional',
    name: '中国传统色',
    category: 'traditional',
    tiers: [
      tier('#fff5f5', '#ffc8c8', '#c93737', '#7a1f1f'),
      tier('#fff8f0', '#ffe0c0', '#c45c26', '#7a3810'),
      tier('#f0f8ff', '#c8e8f8', '#1b6ca8', '#0f4060'),
      tier('#f5fff8', '#c8f0d8', '#2d6a4f', '#1a4030'),
      tier('#faf8f0', '#f0e8c8', '#b8860b', '#6b5008'),
      tier('#f8f4ff', '#e0d4f5', '#6b4c9a', '#3d2860'),
      tier('#f5f5f5', '#d8d4d0', '#5c5450', '#302828'),
    ],
  },
  {
    id: 'nippon',
    name: 'Nippon Colors',
    category: 'traditional',
    tiers: [
      tier('#fff5f5', '#ffd0d0', '#e9546b', '#a03040'),
      tier('#fff8f0', '#ffe8d0', '#f08300', '#a05800'),
      tier('#f5fff8', '#d8f0c8', '#7ba23f', '#4a6028'),
      tier('#f0f8ff', '#c8e0f5', '#26499d', '#183060'),
      tier('#faf5ff', '#e8d8f5', '#9b72b0', '#5a4080'),
      tier('#f8f8f0', '#e8e8d8', '#877f6c', '#504840'),
      tier('#f5f8fa', '#d8e8f0', '#5a7a8a', '#304050'),
    ],
  },
]

export function pickRandomBubbleTheme(): BubbleTheme {
  return BUBBLE_THEMES[Math.floor(Math.random() * BUBBLE_THEMES.length)]!
}
