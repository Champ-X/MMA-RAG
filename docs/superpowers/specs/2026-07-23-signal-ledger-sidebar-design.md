# Signal Ledger Sidebar Redesign

## Design read

Reading this as: a preserve-mode redesign of a knowledge-work conversation rail for researchers, with a precise research-console language, leaning toward a custom Tailwind visual system rather than a new product design system.

The page has one job: let a person create, find, and return to a conversation without competing with the chat workspace.

## Scope and invariants

This work changes only the unified left sidebar. It preserves:

- the Nexus logo asset;
- the current routes and navigation labels;
- create, select, delete, collapse, and theme callbacks;
- session data, API calls, keyboard focus, and mobile collapse behavior.

It does not add a dependency, change the global page theme model, or redesign the chat workspace.

## Audit

The current rail has correct structure but inconsistent visual rules:

- warm off-white gradients, cool slate text, indigo, teal, and white cards compete;
- most regions use the same elevated rounded-card treatment, so importance is unclear;
- mono tracking appears as decoration rather than as meaningful data;
- the expanded rail reads airy while the product task is frequent session switching;
- the light theme makes the left rail disappear into the chat canvas instead of acting as a stable navigation surface.

The information architecture is sound and will remain unchanged.

## Visual system

### Dials

- `DESIGN_VARIANCE: 4` - stable application layout with a single distinctive active-state device.
- `MOTION_INTENSITY: 3` - immediate hover and press feedback only. No autonomous animation.
- `VISUAL_DENSITY: 5` - compact enough for a real session index while keeping targets comfortable.

### Tokens

| Role | Token | Value |
| --- | --- | --- |
| Rail graphite | `rail-base` | `#182126` |
| Raised graphite | `rail-raised` | `#232D34` |
| Rule | `rail-rule` | `#34424B` |
| Primary ink | `rail-ink` | `#EDF2F4` |
| Secondary ink | `rail-muted` | `#9AA9B1` |
| Registration blue | `rail-accent` | `#8CA8FF` |

The sidebar stays graphite in both global themes. The main workspace may still use the existing light or dark theme. Registration blue is the sole accent across the rail. Teal, violet gradients, white panels, and colored ambient glows are removed.

### Type and shape

- Sidebar copy uses the existing system sans stack with `PingFang SC` support. It is compact and legible rather than display-like.
- Brand name uses 18px semibold. Navigation and active sessions use 14px semibold. Inactive sessions use 13px medium.
- Section labels are plain Chinese labels at 11px medium. They are not letter-spaced English pseudo-metadata.
- The radius scale is deliberate: 10px for small icon controls, 12px for rows and the primary button, 16px for the brand image frame. The logo remains circular inside its frame.
- Shadows are removed from ordinary rows. A restrained tonal shadow is reserved for the primary button only.

## Layout

```
┌──────────────────────────────────┐
│ [ Nexus logo ] Nexus          ‹  │  brand and collapse
│                                  │
│ [ + 新建对话                    ] │  single primary action
│                                  │
│   知识库                         │
│   架构                           │  quiet navigation rows
│   设置                           │
│ ──────────────────────────────── │
│ 最近会话                       04 │
│   光影魅力之景                   │
│ │ 新对话 2026/7/23 00:38:52       │  active registration mark
│   EchoDoc的实现阶段是怎样的？     │
│                                  │
│ ──────────────────────────────── │
│   深色主题                       │
│ [ avatar ] Nexus 用户             │
└──────────────────────────────────┘
```

Expanded desktop width is 300px. Collapsed and narrow-screen width is 76px.

## Components and states

### Brand and primary action

The logo is retained as the brand anchor, but the English desk tagline is removed. This avoids decorative metadata and gives the brand area more breathing room. The collapse button lives inside the rail and uses only a quiet outlined treatment.

`新建对话` is the only filled control. It uses registration blue with dark graphite text for accessible contrast. Pressing it translates one pixel downward. It does not glow or rotate.

### Navigation

Navigation is a text-first list, not a set of cards. Hover gets one raised-graphite fill. The current route gets the same fill plus a 2px blue inset mark. Icons remain Lucide because it is already the project icon family. Stroke widths are unified at `1.9`.

### Session index

The session list is the visual center of the rail. It remains flat with no grouping. Inactive sessions are transparent, truncate cleanly, and become raised on hover. The active session gets a raised graphite background and a 3px blue registration mark on the left. No gradients, avatars, decorative dots, or monogram blocks appear in expanded mode.

Delete actions remain available on hover and keyboard focus. The empty state says `还没有对话` and directs people to `新建对话` without adding a second primary action.

### Footer

Theme and profile are utility rows, not cards. The user display keeps its avatar and name, then a plain `本地工作区` descriptor. It has a quiet hover state with no white container.

### Responsive behavior

- At 640px and below, the rail is a 76px icon column. Brand text, labels, titles, profile copy, and delete actions are hidden.
- In collapsed mode, session initials appear only as compact affordances so each session remains selectable.
- Keyboard focus remains visible in both modes. Width transitions and hover transforms are disabled under `prefers-reduced-motion`.

## Validation

- Type-check and production build with the TypeScript Vite config.
- Browser checks at expanded desktop, collapsed desktop, narrow mobile, and both global themes.
- Verify create, select, delete, collapse, theme, and three route navigation actions.
- Audit CTA and focus-ring contrast on the graphite rail.

## Pre-flight review

- One rail accent: registration blue.
- One rounded scale: 10px, 12px, and 16px by component role.
- No white-on-white CTA, no decorative gradients, no status dots, no visible em dash characters, and no generated or fabricated session content.
- No route, API, store, or callback change is in scope.
