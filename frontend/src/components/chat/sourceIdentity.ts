import { translate as tr } from '@/i18n'
import { FileText, Image as ImageIcon, Music, Video } from 'lucide-react'

export const sourceTypes = {
  doc: { label: '文档', contentLabel: '引用原文', icon: FileText },
  image: { label: '图片', contentLabel: '图片描述', icon: ImageIcon },
  audio: { label: '音频', contentLabel: '转写与描述', icon: Music },
  video: { label: '视频', contentLabel: '片段内容', icon: Video },
}

export function displayFileName(fileName?: string) {
  const name = fileName?.split(/[\\/]/).pop() || tr("未命名来源")
  // 仅清理展示名；原始文件名和路径在来源详情中完整保留。
  return name.replace(/^(?:(?:[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12})[_\s-]+)+/i, '') || name
}
