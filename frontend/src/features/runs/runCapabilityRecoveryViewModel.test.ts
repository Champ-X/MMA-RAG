import { describe, expect, it } from 'vitest'
import {
  buildRunCapabilityRecoveryViewModel,
  preservedRecoveryEvidenceIds,
} from './runCapabilityRecoveryViewModel'

describe('buildRunCapabilityRecoveryViewModel', () => {
  it('summarizes a recovery packet with preserved evidence and actions', () => {
    expect(buildRunCapabilityRecoveryViewModel({
      error: {
        code: 'CAPABILITY_UNAVAILABLE',
        message: 'Synthesis provider disabled',
      },
      recovery: {
        actions: [
          'Enable or repair the missing capability before retrying this Run.',
          'Review the preserved Evidence ledger before rerunning; the same scope can be reused.',
        ],
        checkpoint_available: true,
        evidence_count: 2,
        label: 'Capability recovery required',
        phase: 'retrieved',
        preserved_evidence_revision_ids: [
          '019f8400-f17f-7b62-bb89-54f4df9b3d42',
          '019f8400-f17f-7b62-bb89-54f4df9b3d43',
        ],
        reason: 'Synthesis provider disabled · missing capabilities: text',
      },
      partial: true,
    })).toMatchObject({
      actions: [
        'Enable or repair the missing capability before retrying this Run.',
        'Review the preserved Evidence ledger before rerunning; the same scope can be reused.',
      ],
      detail: 'Synthesis provider disabled · missing capabilities: text A runtime checkpoint is available.',
      evidenceLabel: '2 preserved Evidence items',
      label: 'Capability recovery required',
      phaseLabel: 'Evidence retrieved',
      preservedEvidenceIds: [
        '019f8400-f17f-7b62-bb89-54f4df9b3d42',
        '019f8400-f17f-7b62-bb89-54f4df9b3d43',
      ],
      role: 'alert',
      visible: true,
    })
  })

  it('provides default guidance when recovery actions are missing', () => {
    expect(buildRunCapabilityRecoveryViewModel({
      error: { message: 'Vector index is warming' },
      recovery: {
        checkpoint_available: false,
        evidence_count: 0,
        phase: 'before_retrieval',
      },
    })).toMatchObject({
      actions: ['Retry after the connector, retrieval index, or tool dependency is available.'],
      detail: 'Vector index is warming No retrieval checkpoint was created before the interruption.',
      evidenceLabel: '0 preserved Evidence items',
      phaseLabel: 'Before retrieval',
      visible: true,
    })
  })

  it('stays hidden when no recovery packet exists', () => {
    expect(buildRunCapabilityRecoveryViewModel({
      error: { code: 'CAPABILITY_UNAVAILABLE' },
    })).toMatchObject({
      visible: false,
    })
  })

  it('returns preserved evidence ids for evidence drawer recovery', () => {
    expect(preservedRecoveryEvidenceIds({
      recovery: {
        preserved_evidence_revision_ids: [
          'evidence-1',
          'evidence-1',
          'evidence-2',
          '',
          42,
        ],
      },
    })).toEqual(['evidence-1', 'evidence-2'])
  })
})
