import { MessageSquare, Radio, LayoutTemplate, Stethoscope, ArrowRightLeft } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const integrationCards = [
  {
    icon: Radio,
    title: '长连接事件（WSS）',
    accent: 'from-sky-500 to-cyan-600',
    body:
      '在独立线程中运行 lark-oapi WebSocket Client，接收 IM 消息与卡片动作等事件，与 HTTP Webhook 分流；支持 IPv4 优选、超时与连接状态快照，避免阻塞 Uvicorn 主循环。',
    paths: ['backend/app/integrations/feishu_ws.py', 'backend/app/integrations/feishu_handler.py'],
  },
  {
    icon: ArrowRightLeft,
    title: '与主 RAG 管道复用',
    accent: 'from-violet-500 to-indigo-600',
    body:
      '飞书侧用户问题进入与 Web /api/chat/stream 相同的领域服务：意图 → 画像路由 → 多路检索 → 重排 → 上下文构建 → LLM 生成；差异仅在下游适配为飞书消息格式与速率限制。',
    paths: ['backend/app/integrations/feishu_rag_card_v2.py', 'backend/app/modules/generation/'],
  },
  {
    icon: LayoutTemplate,
    title: '卡片 2.0 与 Post',
    accent: 'from-fuchsia-500 to-pink-600',
    body:
      'RAG 回答可渲染为交互卡片：多段 Markdown、图片上传至 IM、OPUS 音频引用等；体积过大时回退 Post 或多条文本消息。可选 CardKit 流式更新元素内容，配置项见 feishu_rag_card_* 与 feishu_rag_reply_format。',
    paths: ['backend/app/integrations/feishu_rag_card_v2.py', 'backend/app/integrations/feishu_cardkit.py'],
  },
  {
    icon: Stethoscope,
    title: '运维与探活',
    accent: 'from-emerald-500 to-teal-600',
    body:
      '提供只读 HTTP 接口汇总 WSS 线程存活、建连状态、最近错误与诊断提示，便于排查订阅、凭证与网络（如代理 / Fake-IP）问题。',
    paths: ['backend/app/api/feishu.py'],
  },
]

export function IntegrationsSection() {
  return (
    <section id="external-integrations" className="scroll-mt-24 space-y-5">
      <div className="inline-flex items-center gap-2 rounded-full border border-sky-200/60 bg-gradient-to-r from-sky-50 to-cyan-50 px-3 py-1 text-xs font-medium text-sky-800 shadow-sm dark:border-sky-800/50 dark:from-sky-950/50 dark:to-cyan-950/40 dark:text-sky-200">
        <MessageSquare className="h-3.5 w-3.5" />
        <span>飞书与外部集成</span>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          企业 IM 与开放平台
        </h2>
        <p className="max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-300 text-chinese-break text-description">
          <strong className="font-medium text-slate-800 dark:text-slate-200">可选能力：</strong>
          配置飞书应用后，通过长连接接收 IM 事件，将问答流量汇入与 <span className="font-mono text-[12px] text-slate-700 dark:text-slate-200">/api/chat/stream</span>{' '}
          相同的领域服务；下游再格式化为卡片 2.0、Post 或分条消息。未启用飞书时，架构页其余章节仍完整描述默认 Web + API 路径。
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {integrationCards.map((item) => {
          const Icon = item.icon
          return (
            <Card
              key={item.title}
              className="group relative overflow-hidden border-slate-200/70 bg-white/90 shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:border-sky-200/80 hover:shadow-lg dark:border-slate-800/70 dark:bg-slate-950/80 dark:hover:border-sky-800/60"
            >
              <div
                className={`pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br ${item.accent} opacity-[0.12] blur-2xl transition-opacity duration-500 group-hover:opacity-20 dark:opacity-[0.18]`}
              />
              <CardHeader className="relative space-y-0 pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-50">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${item.accent} text-white shadow-md shadow-sky-900/10`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </span>
                  {item.title}
                </CardTitle>
              </CardHeader>
              <CardContent className="relative space-y-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                <p className="text-chinese-break">{item.body}</p>
                <ul className="space-y-1 border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {item.paths.map((p) => (
                    <li key={p} className="break-all">
                      {p}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </section>
  )
}
