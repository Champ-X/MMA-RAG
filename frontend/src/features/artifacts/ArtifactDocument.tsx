import { useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { buildEvidenceDetailPath } from '@/lib/evidenceRoutes'
import {
  buildArtifactEvidenceBindingStrip,
  buildArtifactEvidenceRegister,
  buildArtifactInlineCitationText,
  type ArtifactEvidenceItemInput,
} from './artifactDocumentViewModel'
import './ArtifactDocument.css'

type ArtifactBlock = {
  type?: string
  level?: number
  text?: string
  title?: string
  caption?: string
  columns?: unknown[]
  rows?: unknown[][]
  evidence_revision_ids?: string[]
  items?: ArtifactEvidenceItemInput[]
  origin?: string
}

function EvidenceBindings({ ids, runId }: { ids?: string[]; runId?: string | null }) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const bindings = buildArtifactEvidenceBindingStrip(ids)
  if (!bindings.items.length) return null
  return <div className="binding-line" aria-label="Evidence bindings">
    {bindings.visibleItems.map((item) => (
      <Link key={item.id} aria-label={item.ariaLabel} to={buildEvidenceDetailPath(item.id, runId)}>
        {item.label}
      </Link>
    ))}
    {bindings.archivedItems.length ? <span className={`binding-overflow${archiveOpen ? ' open' : ''}`}>
      <button type="button" aria-expanded={archiveOpen} onClick={() => setArchiveOpen((value) => !value)}>
        {archiveOpen ? 'Hide' : 'Show'} {bindings.hiddenCount} more
      </button>
      {archiveOpen ? bindings.archivedItems.map((item) => (
        <Link key={item.id} aria-label={item.ariaLabel} to={buildEvidenceDetailPath(item.id, runId)}>
          {item.label}
        </Link>
      )) : null}
    </span> : null}
  </div>
}

function BlockHeading({ block }: { block: ArtifactBlock }) {
  const level = Math.min(4, Math.max(2, block.level ?? 2))
  if (level === 3) return <h3>{block.text}</h3>
  if (level === 4) return <h4>{block.text}</h4>
  return <h2>{block.text}</h2>
}

function ArtifactMarkdown({
  evidenceRevisionIds,
  runId,
  text,
}: {
  evidenceRevisionIds?: string[]
  runId?: string | null
  text?: string
}) {
  const citationText = buildArtifactInlineCitationText(text ?? '', evidenceRevisionIds)
  const referencesByHref = new Map(citationText.references.map((reference) => [
    `#artifact-evidence-${reference.evidenceRevisionId}`,
    reference,
  ]))

  return <ReactMarkdown components={{
    a: ({ href, children }) => {
      const reference = href ? referencesByHref.get(href) : undefined
      if (!reference) return <a href={href}>{children}</a>
      return <Link
        aria-label={reference.ariaLabel}
        className="artifact-inline-citation"
        title={`Evidence ${reference.shortRevisionId}`}
        to={buildEvidenceDetailPath(reference.evidenceRevisionId, runId)}
      >
        {children}
      </Link>
    },
  }}>{citationText.markdown}</ReactMarkdown>
}

function SourceReceipt({ item, runId }: {
  item: ReturnType<typeof buildArtifactEvidenceRegister>['items'][number]
  runId?: string | null
}) {
  const content = <>
    <span className="artifact-source-kind">{item.locatorLabel}</span>
    <span className="artifact-source-copy">
      <strong>{item.sourceLabel}</strong>
      <small>{item.locatorDetail}</small>
    </span>
    <code>{item.shortRevisionId}</code>
  </>

  if (!item.evidenceRevisionId) {
    return <div className="artifact-source-receipt unbound" aria-label={item.ariaLabel}>{content}</div>
  }

  return <Link
    aria-label={item.ariaLabel}
    className="artifact-source-receipt"
    to={buildEvidenceDetailPath(item.evidenceRevisionId, runId)}
  >
    {content}
  </Link>
}

function EvidenceRegister({ items, runId }: { items?: ArtifactEvidenceItemInput[]; runId?: string | null }) {
  const [archiveOpen, setArchiveOpen] = useState(false)
  const register = buildArtifactEvidenceRegister(items)

  return <section className="artifact-sources" aria-label="Evidence register">
    <header>
      <p className="eyebrow">Evidence register</p>
      <h2>Source receipts</h2>
      <p>{register.summary}</p>
    </header>
    {register.items.length ? <div className="artifact-source-list">
      {register.visibleItems.map((item) => <SourceReceipt key={item.key} item={item} runId={runId} />)}
      {register.archivedItems.length ? <section className={`artifact-source-archive${archiveOpen ? ' open' : ''}`} aria-label="Archived source receipts">
        <button
          type="button"
          aria-expanded={archiveOpen}
          onClick={() => setArchiveOpen((value) => !value)}
        >
          <span>{archiveOpen ? 'Hide archived receipts' : 'Open archived receipts'}</span>
          <strong>{register.hiddenCount}</strong>
          <small>{register.archiveSummary}</small>
        </button>
        {archiveOpen ? <div>
          {register.archivedItems.map((item) => <SourceReceipt key={item.key} item={item} runId={runId} />)}
        </div> : null}
      </section> : null}
    </div> : <p className="artifact-source-empty">No Evidence receipts are attached to this Artifact.</p>}
  </section>
}

export function ArtifactDocument({ document, runId }: { document: Record<string, unknown>; runId?: string | null }) {
  const blocks = (document.blocks ?? []) as ArtifactBlock[]
  return <article className="artifact-paper">
    {blocks.map((block, index) => {
      if (block.type === 'heading') return <BlockHeading key={index} block={block} />
      if (block.type === 'paragraph') return <section key={index} className={`artifact-block${block.origin === 'user' ? ' user-authored' : ''}`}>
        {block.origin === 'user' && <span className="block-origin">User-authored</span>}
        <ArtifactMarkdown evidenceRevisionIds={block.evidence_revision_ids} runId={runId} text={block.text} />
        <EvidenceBindings ids={block.evidence_revision_ids} runId={runId} />
      </section>
      if (block.type === 'table') return <section key={index} className="artifact-table-block">
        {(block.title || block.caption) && <h3>{block.title ?? block.caption}</h3>}
        <div><table>
          {block.columns?.length ? <thead><tr>{block.columns.map((column, columnIndex) => <th key={columnIndex}>{String(column)}</th>)}</tr></thead> : null}
          <tbody>{block.rows?.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{String(cell ?? '')}</td>)}</tr>)}</tbody>
        </table></div>
        <EvidenceBindings ids={block.evidence_revision_ids} runId={runId} />
      </section>
      if (block.type === 'evidence_list') {
        return <EvidenceRegister key={index} items={block.items} runId={runId} />
      }
      return null
    })}
  </article>
}
