import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Node, type Editor } from '@tiptap/core'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import HardBreak from '@tiptap/extension-hard-break'
import { UndoRedo } from '@tiptap/extensions'
import type { ChatReference, ComposerValue } from '@/lib/chatReferences'
import { InlineFileChip } from './InlineFileChip'
import { getFileMentionState, type FileMentionState } from './fileMentionGroups'
import { fromMentionDocument, toMentionDocument } from './mentionDocument'

function MentionView({ node }: NodeViewProps) {
  return <NodeViewWrapper as="span" className="file-mention-node" contentEditable={false}>
    <InlineFileChip reference={node.attrs.reference} />
  </NodeViewWrapper>
}

const FileMention = Node.create({
  name: 'fileMention', group: 'inline', inline: true, atom: true, selectable: true,
  addAttributes: () => ({ reference: { default: null, rendered: false } }),
  // Pasted HTML cannot manufacture a reference or resurrect a removed attachment.
  parseHTML: () => [],
  renderHTML: ({ node }) => ['span', {}, `@${node.attrs.reference.name}`],
  renderText: ({ node }) => `@${node.attrs.reference.name}`,
  addNodeView: () => ReactNodeViewRenderer(MentionView),
})

export interface MentionComposerHandle {
  focus: () => void
  insertReference: (reference: ChatReference, range?: FileMentionState | null) => void
}

interface Props {
  value: ComposerValue
  onChange: (value: ComposerValue) => void
  onMentionChange: (state: FileMentionState | null) => void
  onKeyDown: (event: KeyboardEvent) => boolean
  disabled: boolean
  listboxId?: string
  activeOptionId?: string
}

export const MentionComposer = forwardRef<MentionComposerHandle, Props>(function MentionComposer(props, ref) {
  const current = useRef(props)
  current.current = props
  const lastValue = useRef(JSON.stringify(props.value))
  const syncMention = (editor: Editor) => {
    if (!editor.isFocused || !editor.state.selection.empty || editor.view.composing) {
      current.current.onMentionChange(null)
      return
    }
    const { $from } = editor.state.selection
    // Every atom occupies one editor position. Stop a query at an existing atom.
    const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc')
    const mention = getFileMentionState(before, before.length)
    current.current.onMentionChange(mention ? {
      ...mention, start: $from.start() + mention.start, end: $from.pos,
    } : null)
  }
  const editor = useEditor({
    extensions: [Document, Paragraph, Text, HardBreak, UndoRedo, FileMention],
    content: toMentionDocument(props.value),
    editable: !props.disabled,
    editorProps: {
      attributes: { role: 'combobox', 'aria-label': '输入对话问题', 'aria-multiline': 'true',
        'aria-autocomplete': 'list', 'aria-haspopup': 'listbox', 'data-placeholder': '输入问题，使用 @ 引用文件或本机附件' },
      handleKeyDown: (_view, event) => {
        if (event.isComposing || event.keyCode === 229 || editor?.view.composing) return false
        return current.current.onKeyDown(event)
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        event.preventDefault()
        editor?.commands.insertContent(toMentionDocument({ text: text.replace(/\r\n?/g, '\n'), mentions: [] }).content!)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      const value = fromMentionDocument(editor.getJSON())
      lastValue.current = JSON.stringify(value)
      current.current.onChange(value)
      syncMention(editor)
    },
    onSelectionUpdate: ({ editor }) => syncMention(editor),
    onFocus: ({ editor }) => syncMention(editor),
    onBlur: () => current.current.onMentionChange(null),
  })

  useEffect(() => {
    if (!editor) return
    const next = JSON.stringify(props.value)
    if (lastValue.current !== next) {
      editor.commands.setContent(toMentionDocument(props.value), { emitUpdate: false })
      lastValue.current = next
    }
  }, [editor, props.value])
  useEffect(() => { editor?.setEditable(!props.disabled) }, [editor, props.disabled])
  useEffect(() => {
    if (!editor) return
    const el = editor.view.dom
    el.setAttribute('aria-expanded', String(Boolean(props.listboxId)))
    el.setAttribute('aria-disabled', String(props.disabled))
    for (const [key, value] of [['aria-controls', props.listboxId], ['aria-activedescendant', props.activeOptionId]]) {
      if (value) el.setAttribute(key!, value)
      else el.removeAttribute(key!)
    }
  }, [editor, props.disabled, props.listboxId, props.activeOptionId])
  useImperativeHandle(ref, () => ({
    focus: () => { editor?.commands.focus() },
    insertReference: (reference, range) => {
      if (!editor) return
      const selection = range ? { from: range.start, to: range.end } : editor.state.selection
      editor.chain().focus().insertContentAt(selection, { type: 'fileMention', attrs: { reference } }).run()
      current.current.onMentionChange(null)
    },
  }), [editor])
  return <EditorContent editor={editor} className="mention-composer" />
})
