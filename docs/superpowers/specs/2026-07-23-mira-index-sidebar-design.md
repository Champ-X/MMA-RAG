# Mira Index Sidebar Redesign

## Design read

Reading this as: a preserve-mode redesign of a knowledge-work conversation rail for researchers, with a quiet conversational-directory language based on the supplied Mira reference, implemented with the existing Tailwind component stack.

The sidebar's job is to let people start, find, and reopen a conversation without competing with the chat workspace.

## Scope and invariants

This redesign changes presentation only. It preserves the Nexus logo, routes, navigation labels, session data, all existing callbacks, keyboard behavior, and responsive collapse behavior.

It does not add search, keyboard shortcuts, a context menu, or any other new action that the current application cannot perform.

## Audit and direction

The current rail has the correct information architecture but reads as a dark control panel: a filled call-to-action, repeated rounded surfaces, small utility labels, colored active marks, and fixed graphite materiality. The supplied Mira reference instead uses a simple directory grammar:

- a quiet brand row;
- a text-led new-chat row;
- plain functional rows with generous vertical rhythm;
- a single soft selection surface in the session index;
- a low-key identity area at the bottom.

The redesign adopts that grammar. It does not copy Mira branding, labels, search, shortcuts, or unavailable actions.

## Dials

- `DESIGN_VARIANCE: 3` - a stable, familiar application index.
- `MOTION_INTENSITY: 2` - hover, focus, and press feedback only.
- `VISUAL_DENSITY: 4` - readable session titles with restrained empty space.

## Theme system

Both themes use identical layout, typography, spacing, and selected-row geometry. Only the material values change.

| Role | Light | Dark |
| --- | --- | --- |
| Rail base | `#F7F7F4` | `#1D1D1B` |
| Raised selection | `#EAE9E4` | `#2B2B28` |
| Rule | `#E2E1DB` | `#3A3A36` |
| Primary ink | `#2A2A27` | `#F0EFEA` |
| Secondary ink | `#77766F` | `#A5A49C` |
| Focus ring | `#5F5E57` | `#C8C7BE` |

The rail no longer has a brand-color accent. The only exception is the existing Nexus logo artwork. Destructive controls may retain a semantic danger color while focused or hovered.

## Typography and geometry

- Use the existing system sans stack with `PingFang SC` support.
- Brand name: 18px semibold.
- New-chat and navigation rows: 17px medium.
- Session rows: 16px regular, 17px medium when selected.
- Section label: 14px medium, sentence case Chinese copy.
- Expanded width: 280px. Collapsed and narrow width: 76px.
- Radius: 12px for selected rows and interactive surfaces, 16px for the logo frame, full circle only for avatars and logo art.
- Ordinary rows have no border, shadow, or fill. Selected and hovered rows use only the raised material token.

## Layout

```
┌──────────────────────────────┐
│ [ logo ] Nexus            ‹  │
│                              │
│  ⊕  新建对话                 │
│                              │
│  ◫  知识库                   │
│  ⌘  架构                     │
│  ⚙  设置                     │
│                              │
│  最近会话                     │
│  光影魅力之景                 │
│  [ 知识库Agentic化设计     ] │
│  EchoDoc的实现阶段是怎样的？ │
│                              │
│  ◐  深色主题                 │
│  [ avatar ] Nexus 用户       │
└──────────────────────────────┘
```

The logo remains in its own small frame. Everything else is text first. The main signature is the selected session as a wide, soft neutral field rather than a colored stripe, card, or badge.

## Component behavior

### Brand row

Keep the existing logo asset and collapse control. Remove secondary workspace copy and framed collapse-button styling. The control remains visible, accessible, and receives a neutral hover field.

### New conversation and navigation

`新建对话` becomes a full-width text row with the existing plus icon. It keeps its original callback but has no fill, border, shortcut badge, or duplicate action.

Navigation uses the same row grammar. The active route uses the neutral raised surface, not a colored marker. Hover and keyboard focus are visible in both themes.

### Session index

`最近会话` is a plain label with the actual current count. Sessions stay flat and ungrouped. The active session uses the raised selection surface and slightly stronger type. Inactive sessions gain the same surface only on hover.

The existing delete control remains available on hover and keyboard focus. It is the only contextual session action; no fake ellipsis or inactive menu is introduced.

### Footer and responsive behavior

Theme and user identity become quiet rows with no card container. The existing avatar and theme callback remain.

At 640px and below, keep the current 76px icon rail. Hide titles and labels, retain selectable session initials, and preserve visible keyboard focus. Reduced-motion preferences disable all nonessential transitions.

## Validation

- Run `npm run type-check`.
- Run the isolated TypeScript Vite build with `vite.config.ts`.
- Use agent-browser to inspect light and dark modes, expanded and collapsed desktop layouts, and a 600px viewport.
- Verify navigation and session selection. Do not create or delete user sessions only for visual testing.
- Confirm no error overlay, browser console errors, contrast failures, or visible em dash characters in sidebar copy.

## Pre-flight review

- The Mira reference is used as layout and state inspiration only.
- No dark-control-panel surface, bright call-to-action, gradient, pseudo-shortcut, decorative metadata, or colored active seam remains.
- The only raised background represents either current selection or direct hover.
- Existing behavior and data flow remain in scope and unchanged.
