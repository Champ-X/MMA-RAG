import { describe, expect, it } from 'vitest'
import {
  buildPendingAttachmentTileViewModel,
  buildPendingAttachmentTrayViewModel,
  formatAttachmentFileSize,
  getPendingAttachmentKind,
  type PendingAttachmentFile,
} from './PendingAttachmentTrayViewModel'

const file = (overrides: Partial<PendingAttachmentFile>): PendingAttachmentFile => ({
  name: 'field-notes.png',
  size: 1536,
  type: 'image/png',
  ...overrides,
})

describe('PendingAttachmentTrayViewModel', () => {
  it('formats attachment sizes with compact product copy', () => {
    expect(formatAttachmentFileSize(512)).toBe('512 B')
    expect(formatAttachmentFileSize(1536)).toBe('1.5 KB')
    expect(formatAttachmentFileSize(3 * 1024 ** 2)).toBe('3.0 MB')
  })

  it('classifies attachments by mime type and spreadsheet extension fallback', () => {
    expect(getPendingAttachmentKind(file({ type: 'image/jpeg' }))).toBe('image')
    expect(getPendingAttachmentKind(file({ name: 'interview.mp3', type: 'audio/mpeg' }))).toBe('audio')
    expect(getPendingAttachmentKind(file({ name: 'walkthrough.mov', type: 'video/quicktime' }))).toBe('video')
    expect(getPendingAttachmentKind(file({ name: 'budget.xlsx', type: '' }))).toBe('table')
    expect(getPendingAttachmentKind(file({ name: 'briefing.pdf', type: 'application/pdf' }))).toBe('document')
  })

  it('builds accessible labels for each queued attachment tile', () => {
    const viewModel = buildPendingAttachmentTileViewModel(file({ name: 'field-notes.png', size: 2048 }))

    expect(viewModel).toMatchObject({
      className: 'queued-attachment kind-image',
      meta: 'image · 2.0 KB · queued',
      previewAlt: 'Preview thumbnail for field-notes.png',
      removeLabel: 'Remove field-notes.png from queued attachments',
      summaryLabel: 'field-notes.png · image · 2.0 KB · queued for intake',
    })
  })

  it('describes tray count changes for assistive technology', () => {
    expect(buildPendingAttachmentTrayViewModel({
      count: 1,
      detail: 'Originals are retained before parsing.',
      label: 'Queued attachments',
    })).toEqual({
      countLabel: '1 attachment queued',
      detail: 'Originals are retained before parsing.',
      listLabel: 'Queued attachments: 1 attachment queued',
      statusLabel: '1 attachment queued. Originals are retained before parsing.',
    })
  })
})
