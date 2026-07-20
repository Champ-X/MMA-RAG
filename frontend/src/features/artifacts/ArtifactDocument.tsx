import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'

type EvidenceItem = {
  evidence_revision_id?: string
  source?: string
  locator?: string | Record<string, unknown>
}

type ArtifactBlock = {
  type?: string
  level?: number
  text?: string
  title?: string
  caption?: string
  columns?: unknown[]
  rows?: unknown[][]
  evidence_revision_ids?: string[]
  items?: EvidenceItem[]
  origin?: string
}

function EvidenceBindings({ ids, runId }: { ids?: string[]; runId?: string | null }) {
  if (!ids?.length) return null
  return <div className="binding-line" aria-label="Evidence bindings">
    {ids.map((id) => <Link key={id} to={`/runs/${runId ?? 'browser'}/evidence/${id}`}>Evidence {id.slice(0, 8)}</Link>)}
  </div>
}

function BlockHeading({ block }: { block: ArtifactBlock }) {
  const level = Math.min(4, Math.max(2, block.level ?? 2))
  if (level === 3) return <h3>{block.text}</h3>
  if (level === 4) return <h4>{block.text}</h4>
  return <h2>{block.text}</h2>
}

export function ArtifactDocument({ document, runId }: { document: Record<string, unknown>; runId?: string | null }) {
  const blocks = (document.blocks ?? []) as ArtifactBlock[]
  return <article className="artifact-paper">
    {blocks.map((block, index) => {
      if (block.type === 'heading') return <BlockHeading key={index} block={block} />
      if (block.type === 'paragraph') return <section key={index} className={`artifact-block${block.origin === 'user' ? ' user-authored' : ''}`}>
        {block.origin === 'user' && <span className="block-origin">User-authored</span>}
        <ReactMarkdown>{block.text ?? ''}</ReactMarkdown>
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
      if (block.type === 'evidence_list') return <section key={index} className="artifact-sources">
        <h2>Evidence register</h2>
        {block.items?.map((item, itemIndex) => item.evidence_revision_id ? <Link key={item.evidence_revision_id} to={`/runs/${runId ?? 'browser'}/evidence/${item.evidence_revision_id}`}>
          <span><strong>{item.source || 'Evidence source'}</strong><small>{typeof item.locator === 'string' ? item.locator : item.locator ? JSON.stringify(item.locator) : 'Open exact locator'}</small></span>
          <code>{item.evidence_revision_id}</code>
        </Link> : <div key={itemIndex}><span>{item.source || 'Evidence source'}</span><span>Unbound reference</span></div>)}
      </section>
      return null
    })}
  </article>
}
