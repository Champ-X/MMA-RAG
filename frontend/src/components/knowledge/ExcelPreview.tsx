import React from 'react'
import * as XLSX from 'xlsx'
import { FileSpreadsheet, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 行数阈值：超过则启用窗口化（virtualization）渲染，避免一次性绘制 1w+ <tr> 阻塞主线程 */
const VIRTUALIZE_THRESHOLD = 2000
/** 默认行高（虚拟化使用，单位 px）；与 td 的 py-2 + 文本高度大致对齐 */
const ROW_HEIGHT = 36
/** 虚拟化滚动容器最大高度（vh） */
const VIRTUAL_VIEWPORT_VH = 60
/** 单元格内文本最大显示长度，超出截断（鼠标悬浮显示完整内容） */
const CELL_MAX_CHARS = 200
/** 上下额外渲染的「缓冲行」数，避免快速滚动出现白边 */
const VIRTUAL_OVERSCAN = 8

interface ExcelPreviewProps {
  blob: Blob
  fileType: 'xlsx' | 'xls' | 'csv'
  filename?: string
}

interface SheetData {
  name: string
  /** 二维数组，第 0 行视为表头；空 sheet 为 [] */
  matrix: string[][]
  rowCount: number
  colCount: number
}

/** SheetJS 单元格值统一转字符串：null/undefined → ""；数字保留原样 */
function cellToStr(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

/** 把 SheetJS 解析出的二维数组规范化：每行长度补齐到 maxCols；过长字符串截断 */
function normalizeMatrix(rawRows: unknown[][]): { matrix: string[][]; cols: number } {
  let maxCols = 0
  for (const r of rawRows) {
    if (Array.isArray(r) && r.length > maxCols) maxCols = r.length
  }
  const matrix: string[][] = rawRows.map((r) => {
    const row: string[] = []
    const arr = Array.isArray(r) ? r : []
    for (let c = 0; c < maxCols; c += 1) {
      const s = cellToStr(arr[c])
      row.push(s.length > CELL_MAX_CHARS ? s.slice(0, CELL_MAX_CHARS - 1) + '…' : s)
    }
    return row
  })
  return { matrix, cols: maxCols }
}

export const ExcelPreview: React.FC<ExcelPreviewProps> = ({ blob, fileType, filename }) => {
  const [sheets, setSheets] = React.useState<SheetData[] | null>(null)
  const [activeSheetIdx, setActiveSheetIdx] = React.useState<number>(0)
  const [error, setError] = React.useState<string | null>(null)
  const [parsing, setParsing] = React.useState<boolean>(true)

  React.useEffect(() => {
    let cancelled = false
    setParsing(true)
    setError(null)
    setSheets(null)
    setActiveSheetIdx(0)
    blob
      .arrayBuffer()
      .then((buf) => {
        try {
          const wb = XLSX.read(buf, {
            type: 'array',
            // CSV 在浏览器端走 SheetJS 默认编码嗅探，对 utf-8-sig/latin-1 都能兼容
            raw: false,
            cellDates: false,
            cellNF: false,
            cellText: true,
          })
          const parsed: SheetData[] = wb.SheetNames.map((name) => {
            const ws = wb.Sheets[name]
            const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, {
              header: 1,
              defval: '',
              blankrows: false,
              raw: false,
            }) as unknown[][]
            const { matrix, cols } = normalizeMatrix(rows)
            return {
              name,
              matrix,
              rowCount: matrix.length,
              colCount: cols,
            }
          })
          if (!cancelled) {
            setSheets(parsed.length > 0 ? parsed : [{ name: 'Sheet1', matrix: [], rowCount: 0, colCount: 0 }])
            setParsing(false)
          }
        } catch (e: any) {
          if (!cancelled) {
            setError(e?.message || '解析失败：文件可能损坏或格式不受支持')
            setParsing(false)
          }
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message || '读取文件流失败')
          setParsing(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [blob])

  if (parsing) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500 border-t-transparent" />
        <div className="mt-3 text-sm">表格解析中…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
          <AlertCircle className="h-4 w-4" aria-hidden />
          表格预览失败
        </div>
        <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-amber-700 dark:text-amber-300">{error}</div>
        <div className="mt-2 text-xs text-amber-700/90 dark:text-amber-300/90">
          可切换到「分块」查看后端解析后的内容；若文件确为有效的 xlsx/xls/csv，请联系管理员排查。
        </div>
      </div>
    )
  }

  if (!sheets || sheets.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
        表格为空。
      </div>
    )
  }

  const activeSheet = sheets[Math.min(activeSheetIdx, sheets.length - 1)]
  const totalRows = activeSheet.rowCount
  const dataRowCount = Math.max(0, totalRows - 1) // 第 0 行为表头
  const useVirtualization = dataRowCount > VIRTUALIZE_THRESHOLD

  return (
    <div className="space-y-3">
      {/* 顶部信息条：文件名 + sheet 标签 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 dark:border-slate-800 dark:bg-slate-900/40">
        <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {filename || `${fileType.toUpperCase()} 表格`}
        </span>
        <span className="text-[11px] text-slate-400 dark:text-slate-500">
          {activeSheet.rowCount} 行 × {activeSheet.colCount} 列
          {useVirtualization ? '（已启用虚拟滚动）' : ''}
        </span>
      </div>

      {sheets.length > 1 && (
        <div
          role="tablist"
          aria-label="工作表切换"
          className="-mb-px flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800"
        >
          {sheets.map((s, idx) => {
            const active = idx === activeSheetIdx
            return (
              <button
                key={`${s.name}-${idx}`}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSheetIdx(idx)}
                className={cn(
                  'group relative -mb-px max-w-[16rem] truncate rounded-t-md border border-b-0 px-3 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-emerald-200 bg-white text-emerald-700 shadow-[inset_0_-2px_0_0_rgb(16,185,129)] dark:border-emerald-900/50 dark:bg-slate-900 dark:text-emerald-300 dark:shadow-[inset_0_-2px_0_0_rgb(52,211,153)]'
                    : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:border-slate-800 dark:hover:bg-slate-900/40 dark:hover:text-slate-200'
                )}
                title={s.name}
              >
                {s.name}
                <span className="ml-1.5 text-[10px] text-slate-400 dark:text-slate-500">{s.rowCount}</span>
              </button>
            )
          })}
        </div>
      )}

      {useVirtualization ? (
        <VirtualizedSheetTable sheet={activeSheet} />
      ) : (
        <FullSheetTable sheet={activeSheet} />
      )}
    </div>
  )
}

/** 普通滚动表格：直接渲染全部行；适用于 ≤ VIRTUALIZE_THRESHOLD 行 */
const FullSheetTable: React.FC<{ sheet: SheetData }> = ({ sheet }) => {
  const headerRow = sheet.matrix[0] || []
  const bodyRows = sheet.matrix.slice(1)
  const colCount = sheet.colCount
  return (
    <div
      className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
      style={{ maxHeight: `${VIRTUAL_VIEWPORT_VH}vh` }}
    >
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-100/95 text-slate-700 backdrop-blur dark:bg-slate-800/95 dark:text-slate-200">
            <RowNumHeader />
            {Array.from({ length: colCount }).map((_, idx) => (
              <th
                key={idx}
                className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap dark:border-slate-700"
                title={cellToStr(headerRow[idx])}
              >
                {cellToStr(headerRow[idx]) || colLabel(idx)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.length === 0 ? (
            <tr>
              <td colSpan={colCount + 1} className="px-3 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
                （无数据行）
              </td>
            </tr>
          ) : (
            bodyRows.map((row, rIdx) => (
              <tr
                key={rIdx}
                className={cn(
                  rIdx % 2 === 0
                    ? 'bg-white dark:bg-slate-950'
                    : 'bg-slate-50/70 dark:bg-slate-900/40',
                  'hover:bg-emerald-50/40 dark:hover:bg-emerald-900/10'
                )}
              >
                <RowNumCell num={rIdx + 1} />
                {Array.from({ length: colCount }).map((_, cIdx) => (
                  <td
                    key={cIdx}
                    className="border-b border-slate-100 px-3 py-2 align-top text-slate-700 dark:border-slate-800/70 dark:text-slate-200"
                    title={row[cIdx]}
                  >
                    {row[cIdx]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

/** 虚拟化表格：仅渲染可视范围内的行，适用于 > VIRTUALIZE_THRESHOLD 行 */
const VirtualizedSheetTable: React.FC<{ sheet: SheetData }> = ({ sheet }) => {
  const headerRow = sheet.matrix[0] || []
  const bodyRows = sheet.matrix.slice(1)
  const colCount = sheet.colCount
  const total = bodyRows.length

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = React.useState(0)
  const [viewportHeight, setViewportHeight] = React.useState(0)

  React.useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => setViewportHeight(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - VIRTUAL_OVERSCAN)
  const visibleCount = viewportHeight > 0 ? Math.ceil(viewportHeight / ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2 : 30
  const endIdx = Math.min(total, startIdx + visibleCount)
  const offsetY = startIdx * ROW_HEIGHT
  const totalHeight = total * ROW_HEIGHT

  return (
    <div
      ref={containerRef}
      onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950"
      style={{ maxHeight: `${VIRTUAL_VIEWPORT_VH}vh` }}
    >
      <table className="min-w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-slate-100/95 text-slate-700 backdrop-blur dark:bg-slate-800/95 dark:text-slate-200">
            <RowNumHeader />
            {Array.from({ length: colCount }).map((_, idx) => (
              <th
                key={idx}
                className="border-b border-slate-200 px-3 py-2 text-left text-xs font-semibold tracking-wide whitespace-nowrap dark:border-slate-700"
                title={cellToStr(headerRow[idx])}
              >
                {cellToStr(headerRow[idx]) || colLabel(idx)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* 顶部填充：撑高到 startIdx 对应位置 */}
          {offsetY > 0 && (
            <tr aria-hidden style={{ height: offsetY }}>
              <td colSpan={colCount + 1} className="p-0" />
            </tr>
          )}
          {bodyRows.slice(startIdx, endIdx).map((row, i) => {
            const rIdx = startIdx + i
            return (
              <tr
                key={rIdx}
                style={{ height: ROW_HEIGHT }}
                className={cn(
                  rIdx % 2 === 0
                    ? 'bg-white dark:bg-slate-950'
                    : 'bg-slate-50/70 dark:bg-slate-900/40',
                  'hover:bg-emerald-50/40 dark:hover:bg-emerald-900/10'
                )}
              >
                <RowNumCell num={rIdx + 1} />
                {Array.from({ length: colCount }).map((_, cIdx) => (
                  <td
                    key={cIdx}
                    className="overflow-hidden text-ellipsis whitespace-nowrap border-b border-slate-100 px-3 py-2 align-middle text-slate-700 dark:border-slate-800/70 dark:text-slate-200"
                    title={row[cIdx]}
                  >
                    {row[cIdx]}
                  </td>
                ))}
              </tr>
            )
          })}
          {/* 底部填充：撑到总高度 */}
          {endIdx < total && (
            <tr aria-hidden style={{ height: totalHeight - endIdx * ROW_HEIGHT }}>
              <td colSpan={colCount + 1} className="p-0" />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

const RowNumHeader: React.FC = () => (
  <th className="sticky left-0 z-20 w-12 border-b border-r border-slate-200 bg-slate-100/95 px-2 py-2 text-center text-[11px] font-semibold text-slate-400 backdrop-blur dark:border-slate-700 dark:bg-slate-800/95 dark:text-slate-500">
    #
  </th>
)

const RowNumCell: React.FC<{ num: number }> = ({ num }) => (
  <td className="sticky left-0 z-[1] w-12 border-b border-r border-slate-100 bg-slate-50/80 px-2 py-2 text-center text-[11px] font-mono text-slate-400 dark:border-slate-800/70 dark:bg-slate-900/60 dark:text-slate-500">
    {num}
  </td>
)

/** 把 0-based 列索引转为 Excel 风格列号（A、B、…、Z、AA），用于列标题缺失时兜底显示 */
function colLabel(n: number): string {
  let s = ''
  let v = n + 1
  while (v > 0) {
    const r = (v - 1) % 26
    s = String.fromCharCode(65 + r) + s
    v = Math.floor((v - 1) / 26)
  }
  return s
}

export default ExcelPreview
