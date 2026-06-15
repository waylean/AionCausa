import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { jsonrepair } from 'jsonrepair'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function readRequestBody(request: import('node:http').IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '')
}

function resolveAnthropicMessagesUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl)
  return normalized.endsWith('/anthropic') ? `${normalized}/v1/messages` : `${normalized}/messages`
}

function extractProviderContent(protocol: string, text: string) {
  const payload = JSON.parse(text)
  if (protocol === 'anthropic-compatible') {
    const content = Array.isArray(payload.content) ? payload.content : []
    const textBlocks = content
      .filter((block: { type?: string; text?: string }) => block.type === 'text' && typeof block.text === 'string')
      .map((block: { text: string }) => block.text)
    return textBlocks.join('\n')
  }
  const choice = Array.isArray(payload.choices) ? payload.choices[0] : undefined
  const message = choice?.message
  const content = message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part: { text?: string; type?: string }) => {
        if (typeof part.text === 'string') return part.text
        if (typeof (part as { content?: string }).content === 'string') return (part as { content: string }).content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return message?.reasoning_content ?? message?.text ?? choice?.text ?? ''
}

function parseModelJson(content: string) {
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('模型未返回 JSON 对象')
  }
  const raw = content.slice(start, end + 1)
  try {
    return JSON.parse(raw)
  } catch (primaryError) {
    try {
      return JSON.parse(jsonrepair(raw))
    } catch (repairError) {
      const squashed = raw.replace(/,\s*,+/g, ',').replace(/([,[{])\s*,+/g, '$1')
      try {
        return JSON.parse(jsonrepair(squashed))
      } catch {
        throw repairError instanceof Error ? repairError : primaryError
      }
    }
  }
}

async function callProvider(payload: Record<string, unknown>, prompt: string, tokenOverride?: number, requireJson = false) {
  const baseUrl = normalizeBaseUrl(String(payload.baseUrl || ''))
  const protocol = payload.protocol === 'anthropic-compatible' ? 'anthropic-compatible' : 'openai-compatible'
  const apiKey = String(payload.apiKey || '')
  const model = String(payload.model || '')
  const temperature = Number(payload.temperature ?? 0.3)
  const maxTokens = Number(tokenOverride ?? payload.maxTokens ?? 1200)
  const supportsResponseFormat = payload.supportsResponseFormat !== false
  const timeoutMs = Math.max(30_000, Math.min(900_000, Number(payload.timeoutMs ?? 600_000)))

  if (!baseUrl || !apiKey || !model) {
    return {
      statusCode: 400,
      body: { ok: false, message: 'Base URL, API Key, Model 均不能为空' },
    }
  }

  const startedAt = performance.now()
  const openAiBody: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    temperature,
    messages: [
      {
        role: 'system',
        content: 'You are AionCausa. Return valid JSON only when asked for JSON.',
      },
      { role: 'user', content: prompt },
    ],
  }

  if (requireJson && supportsResponseFormat) {
    openAiBody.response_format = { type: 'json_object' }
  }

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  let upstream: Response
  try {
    upstream =
      protocol === 'anthropic-compatible'
        ? await fetch(resolveAnthropicMessagesUrl(baseUrl), {
            method: 'POST',
            signal: abortController.signal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model,
              max_tokens: maxTokens,
              temperature,
              messages: [{ role: 'user', content: prompt }],
            }),
          })
        : await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            signal: abortController.signal,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(openAiBody),
          })
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt)
    const isAbort = error instanceof Error && error.name === 'AbortError'
    return {
      statusCode: isAbort ? 504 : 502,
      body: {
        ok: false,
        message: isAbort ? `模型请求超时（${timeoutMs}ms）` : error instanceof Error ? error.message : '模型请求失败',
        latencyMs,
      },
    }
  } finally {
    clearTimeout(timeout)
  }

  const latencyMs = Math.round(performance.now() - startedAt)
  const text = await upstream.text()
  if (!upstream.ok) {
    return {
      statusCode: upstream.status,
      body: {
        ok: false,
        message: `连接失败 ${upstream.status}: ${text.slice(0, 180)}`,
        latencyMs,
      },
    }
  }

  return {
    statusCode: 200,
    body: {
      ok: true,
      content: extractProviderContent(protocol, text),
      message: 'Provider 请求成功',
      latencyMs,
    },
  }
}

const abstractAgentNamePatterns = [
  /集团/,
  /阶层/,
  /势力/,
  /派$/,
  /君主$/,
  /民众/,
  /贵族/,
  /官僚/,
  /军队/,
  /国家/,
  /政府/,
  /组织/,
  /公司/,
  /公众/,
  /决策者/,
  /代表$/,
  /阵营/,
  /宗室/,
  /改革执行者/,
  /最高决策者/,
  /外部竞争者/,
]

function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function cleanInterviewContent(content: unknown, message: unknown) {
  const text = String(content || '').trim()
  const fallback = String(message || '').trim()
  const statusOnly = /^(provider\s*请求成功|aioncausa provider check ok\.?|请求成功)$/i
  if (text && !statusOnly.test(text)) return polishInterviewAnswer(text)
  if (fallback && !statusOnly.test(fallback)) return polishInterviewAnswer(fallback)
  return ''
}

function polishInterviewAnswer(value: string) {
  const cleaned = value
    .replace(/^[\s"'“”‘’]*(?:[\u4e00-\u9fa5A-Za-z0-9·]{1,12})[：:]\s*/u, '')
    .replace(/我不会按旁观者的说法回答[，,。；;]?\s*我只能从自己看见的压力里判断[。；;]?\s*/gu, '')
    .replace(/(?:个人谋划|当前压力|可见世界|携带记忆|行动记录|观察流|人物行动)[：:]\s*/gu, '')
    .replace(/([。！？])\1+/gu, '$1')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!cleaned || /[。！？.!?]$/u.test(cleaned)) return cleaned
  const lastStop = Math.max(cleaned.lastIndexOf('。'), cleaned.lastIndexOf('！'), cleaned.lastIndexOf('？'), cleaned.lastIndexOf(';'), cleaned.lastIndexOf('；'))
  return lastStop >= 0 ? cleaned.slice(0, lastStop + 1) : `${cleaned}。`
}

function buildFallbackInterviewAnswer(agent: unknown, runtimeActor: unknown, actorContext: unknown, actorLedger: unknown, question: string) {
  const profile = toRecord(agent)
  const actor = toRecord(runtimeActor)
  const context = toRecord(actorContext)
  const ledger = toRecord(actorLedger)
  const actions = Array.isArray(profile.actions) ? profile.actions : []
  const goals = Array.isArray(profile.goals) ? profile.goals : []
  const intent = polishInterviewAnswer(String(actor.intent || actions[0] || goals[0] || '先保住下一步行动余地'))
  const visibleSummaries = Array.isArray(context.visibleSummaries) ? context.visibleSummaries.map(String) : []
  const memory = polishInterviewAnswer(String(ledger.lastActionSummary || visibleSummaries[0] || profile.identity || '眼前已经露出的信号'))
  const statusSummary = String(ledger.statusSummary || '我仍在场，但不能把主动权拱手让出')
  const suspicion = /担心|害怕|处置|杀|流放|囚|夺权|怎么办/u.test(question)
    ? '我最怕的不是明刀，而是他把我的功劳留下、把我的权柄拆散，再让旧怨替他动手。'
    : `我现在盯着的，是${memory}。`

  return polishInterviewAnswer(`${suspicion}${statusSummary}，所以我下一步会${intent}。`)
}

function hasAbstractAgentName(name: unknown) {
  const value = typeof name === 'string' ? name.trim() : ''
  return !value || /^agent[-_\s]*\d+$/iu.test(value) || abstractAgentNamePatterns.some((pattern) => pattern.test(value))
}

function extractAgents(payload: unknown) {
  const row = toRecord(payload)
  return Array.isArray(row.agents) ? row.agents : []
}

function findAgentViolations(payload: unknown) {
  const agents = extractAgents(payload)
  const violations: string[] = []
  if (agents.length < 5) {
    violations.push(`agents length is ${agents.length}; need at least 5 concrete people`)
  }
  agents.forEach((agent, index) => {
    const row = toRecord(agent)
    if (hasAbstractAgentName(row.name)) {
      violations.push(`agents[${index}].name is abstract or missing: ${String(row.name || '')}`)
    }
    const actions = Array.isArray(row.actions) ? row.actions : []
    if (!actions.length) {
      violations.push(`agents[${index}].actions is empty`)
    }
  })
  return violations
}

function findStoryViolations(payload: unknown, totalSteps: number, agentsPayload?: unknown) {
  const row = toRecord(payload)
  const branches = Array.isArray(row.branches) ? row.branches : []
  const actionLogs = Array.isArray(row.actionLogs) ? row.actionLogs : []
  const timeline = Array.isArray(row.timeline) ? row.timeline : []
  const agentRows = extractAgents(agentsPayload)
  const knownAgentIds = new Set(agentRows.map((agent) => String(toRecord(agent).id || '')).filter(Boolean))
  const knownAgentNames = new Map(agentRows.map((agent) => [String(toRecord(agent).id || ''), String(toRecord(agent).name || '')]))
  const initiatorIds = new Set(actionLogs.map((log) => String(toRecord(log).initiatorActorId || toRecord(log).agentId || '')).filter(Boolean))
  const steps = new Set(
    actionLogs.map((item) => Math.max(0, Math.round(Number(toRecord(item).step ?? -1)))).filter((step) => step >= 0),
  )
  const violations: string[] = []
  if (branches.length < 3) violations.push(`branches length is ${branches.length}; need at least 3`)
  if (timeline.length < Math.min(4, totalSteps)) {
    violations.push(`timeline length is ${timeline.length}; need at least ${Math.min(4, totalSteps)}`)
  }
  if (actionLogs.length < Math.max(totalSteps, 8)) {
    violations.push(`actionLogs length is ${actionLogs.length}; need at least ${Math.max(totalSteps, 8)}`)
  }
  for (let step = 0; step < totalSteps; step += 1) {
    if (!steps.has(step)) violations.push(`actionLogs missing step ${step}`)
  }
  actionLogs.forEach((log, index) => {
    const item = toRecord(log)
    const step = Math.round(Number(item.step ?? -1))
    if (step < 0 || step >= totalSteps) {
      violations.push(`actionLogs[${index}].step is ${String(item.step)}; valid range is 0 to ${totalSteps - 1}`)
    }
    if (hasAbstractAgentName(item.agentName)) {
      violations.push(`actionLogs[${index}].agentName is abstract or missing: ${String(item.agentName || '')}`)
    }
    const initiatorActorId = String(item.initiatorActorId || item.agentId || '')
    if (initiatorActorId && knownAgentNames.has(initiatorActorId) && String(item.agentName || '') !== knownAgentNames.get(initiatorActorId)) {
      violations.push(`actionLogs[${index}].agentName does not match initiatorActorId`)
    }
    if (!item.detail || !item.impact) {
      violations.push(`actionLogs[${index}] lacks detail or impact`)
    }
    if (!initiatorActorId || (knownAgentIds.size && !knownAgentIds.has(initiatorActorId))) {
      violations.push(`actionLogs[${index}].initiatorActorId is missing or not in agents_json`)
    }
    ;['targetActorIds', 'responderActorIds', 'affectedActorIds'].forEach((key) => {
      if (!Array.isArray(item[key])) violations.push(`actionLogs[${index}].${key} must be an array`)
      if (Array.isArray(item[key])) {
        item[key].forEach((id) => {
          if (knownAgentIds.size && !knownAgentIds.has(String(id))) {
            violations.push(`actionLogs[${index}].${key} contains unknown agent id: ${String(id)}`)
          }
        })
      }
    })
    ;['actionText', 'responseText', 'effectText'].forEach((key) => {
      if (typeof item[key] !== 'string') violations.push(`actionLogs[${index}].${key} must be a string`)
    })
  })
  agentRows.forEach((agent, index) => {
    const id = String(toRecord(agent).id || '')
    if (id && !initiatorIds.has(id)) violations.push(`agents[${index}] never appears as actionLogs[].initiatorActorId`)
  })
  return violations
}

function buildPreflightPrompt(eventText: string) {
  return `You are AionCausa's world-creation preflight reviewer.

center_event = ${JSON.stringify(eventText)}
answer_language = "zh-CN"

Task:
Decide whether this event has enough grounded information to create an event-derived virtual world.
The event may be historical, modern, fictional, literary, or user-original.

Decision rules:
1. Return canSimulate=true if the event has a clear changed point and at least 3 concrete actors can be inferred from either the user input, widely known history/current affairs/literature, or explicit user-provided setting.
2. For famous historical or literary events, use your background knowledge to identify concrete people. Do not reject merely because the user gave a short question.
3. For modern events, you may identify concrete public roles or people, but mention time-sensitivity if the exact current office holder depends on live data.
4. Return canSimulate=false if the input is purely vague, has no named/locatable source, no concrete actors, or no actionable conflict.
5. suggestedActors must be concrete people when possible. If only an official role is safe, use the role as name only when it is genuinely the acting office in the scenario and explain uncertainty in identity.
6. Do not generate the whole world. Do not write branches, timeline, or scenes.

Return JSON only:
{
  "canSimulate": true,
  "confidence": 0.72,
  "domain": "历史政治 | 地缘战略 | 现代政治 | 经济商业 | 虚构叙事 | 通用事件",
  "eventSummary": "8到18个中文字符的短标题",
  "enrichedEventText": "保留用户问题，并补充必要背景的一段话",
  "reasons": ["为什么足够创建世界，必须具体"],
  "missing": ["如果不足，缺什么；如果足够则为空数组"],
  "backgroundNotes": ["创建世界前必须带入的事实、争议点或前提"],
  "suggestedActors": [
    {"name":"具体人物名","role":"此人在事件中的作用","identity":"身份说明","reason":"为什么需要进入世界","confidence":0.7}
  ]
}

Requirements:
1. If canSimulate=true, suggestedActors length must be at least 4 unless the event naturally has only 3 actors.
2. reasons and backgroundNotes must be specific to center_event.
3. missing must be empty when canSimulate=true.
4. Write all user-facing values in Chinese.
5. Output must be directly parseable JSON.`
}

function buildAnalysisPrompt(eventText: string) {
  return `You are generating STAGE 1 of an AionCausa event-world simulation.

The following center_event is literal user input. It is NOT hidden, NOT confidential, and NOT a placeholder.
center_event = ${JSON.stringify(eventText)}
horizon_policy = "The model must choose the best simulation length and stopping point. Do not ask the user."
answer_language = "zh-CN"

Hard rules:
1. Use center_event as the only topic. Never replace it with AI strategy, quantum computing, finance, or any other example.
2. The title, centralQuestion, graphMemory, and evidence must mention concrete entities or concepts from center_event.
3. If knowledge is incomplete, express uncertainty, but do not change the topic.
4. Return JSON only. No Markdown. No prose outside JSON.

Task:
Analyze what has already happened, what the user assumes, what background must be remembered, and where the simulation should stop.
Do not generate agents, branches, actionLogs, or timeline in this stage.

JSON shape:
{
  "title": "string",
  "eventSummary": "8 to 18 Chinese characters, a compact display label for center_event",
  "domain": "string",
  "centralQuestion": "string",
  "confidence": 0.62,
  "simulationPlan": {
    "startLabel": "string",
    "endLabel": "string",
    "durationLabel": "string",
    "totalSteps": 6,
    "stopReason": "string"
  },
  "eventAnalysis": {
    "facts": ["string"],
    "assumptions": ["string"],
    "causes": ["string"],
    "openQuestions": ["string"]
  },
  "graphMemory": [
    {"id":"mem-1","label":"string","type":"person","summary":"string","confidence":0.7,"links":["agent-1"]}
  ],
  "evidence": [{"id":"ev-1","claim":"string","confidence":0.7,"usedIn":["event"]}]
}

Requirements:
1. At least 5 evidence items.
2. simulationPlan.totalSteps should be 6 to 9. Choose duration from the event logic, not from the user.
3. eventSummary must preserve the core changed event, but be short enough for a one-line page title. Do not use ellipsis.
4. graphMemory should contain causes, assumptions, named people, factions, and possible consequences.
5. Write all user-facing values in Chinese.
6. Output must be directly parseable JSON.`
}

function buildAgentsPrompt(eventText: string, analysisJson: unknown) {
  return `You are generating STAGE 2 of an AionCausa event-world simulation.

center_event = ${JSON.stringify(eventText)}
analysis = ${JSON.stringify(analysisJson)}
answer_language = "zh-CN"

Task:
Create the actual people who will act in the virtual world.
First infer the required factions or forces, then instantiate each force as one concrete person. The "name" field must always be a human name.
Use real named people when the event supplies or strongly implies them. If a force needs a representative but no reliable real name exists, create a plausible fictional person and clearly mark uncertainty in identity or confidence.

Hard ban for agent.name:
"改革执行者", "最高决策者", "旧利益集团", "外部竞争者", "秦君主", "旧贵族集团", "改革派", "宗室势力", "军功阶层", "普通民众", "反制方", "public", "elite group", "ruler".
A faction, institution, class, dynasty, army, party, or ruler group may appear in role or identity only.

For Shang Yang / Qin counterfactuals, suitable concrete people include 商鞅, 嬴驷, 公子虔, 甘龙, 杜挚, 司马错, 魏惠王 when historically appropriate.

Return JSON only:
{
  "agents": [
    {
      "id":"agent-1",
      "name":"string",
      "role":"string",
      "identity":"specific person identity",
      "dilemma":"the concrete dilemma this person faces",
      "currentPressure":"immediate pressure in the virtual world",
      "goals":["string"],
      "constraints":["string"],
      "leverage":["string"],
      "actions":["specific thing this person may do"],
      "relationships":["relationship to another named agent"],
      "riskTolerance":0.5,
      "confidence":0.65
    }
  ]
}

Requirements:
1. At least 5 concrete agents.
2. Every agent.name must be a person name, not a generic class, faction, institution, or title.
3. Each identity should explain the person and, if needed, which group they represent.
4. Each dilemma/currentPressure/actions must be concrete enough to support scene-by-scene simulation.
5. relationships must mention other agent names when possible.
6. Write all user-facing values in Chinese.
7. Output must be directly parseable JSON.`
}

function buildAgentRepairPrompt(eventText: string, analysisJson: unknown, previousJson: unknown, violations: string[]) {
  return `Repair STAGE 2 agents for AionCausa.

center_event = ${JSON.stringify(eventText)}
analysis = ${JSON.stringify(analysisJson)}
previous_agents_json = ${JSON.stringify(previousJson)}
violations = ${JSON.stringify(violations)}

Return a complete replacement JSON object with only:
{"agents":[...]}

Rules:
1. Keep the event topic unchanged.
2. Use at least 5 concrete human names.
3. Do not put group labels, titles, institutions, classes, factions, or roles in agent.name.
4. Put representation in identity/role, not name.
5. Make every action a concrete thing that person may do.
6. Chinese only. JSON only.`
}

function buildStoryPrompt(eventText: string, analysisJson: unknown, agentsJson: unknown) {
  return `You are generating STAGE 3 of an AionCausa event-world simulation.

center_event = ${JSON.stringify(eventText)}
analysis = ${JSON.stringify(analysisJson)}
agents_json = ${JSON.stringify(agentsJson)}
horizon_policy = "Use analysis.simulationPlan as the selected simulation length and stopping point."

Task:
Use only the concrete people in agents_json to create living event lines. Each branch should show what named people do, what pressure they face, and how one action causes another.
Every actionLog should describe an interaction between named people when possible, not an abstract policy movement.
Avoid vague summaries. Do not invent a different topic.

Return JSON only:
{
  "branches": [
    {
      "id":"branch-1",
      "title":"string",
      "credibility":0.66,
      "divergence":0.3,
      "trigger":"specific trigger involving named people",
      "summary":"string",
      "causalChain":["named person action -> consequence"],
      "storyBeats":["specific scene or action by named people"],
      "metrics":[{"id":"metric-1","label":"string","value":"string","delta":"+0%"}]
    }
  ],
  "actionLogs": [
    {
      "id":"act-1",
      "step":0,
      "timeLabel":"string",
      "agentId":"agent-1",
      "agentName":"string",
      "initiatorActorId":"agent-1",
      "targetActorIds":["agent-2"],
      "responderActorIds":["agent-2"],
      "affectedActorIds":["agent-3"],
      "action":"short visible action",
      "actionText":"what initiatorActorId personally does, with no other person's action mixed in",
      "responseText":"what responderActorIds do in reply; empty string if no reply yet",
      "effectText":"how target/affected people are changed if they did not actively respond",
      "detail":"specific thing the person did",
      "impact":"consequence on another person, faction, or world line",
      "branchId":"branch-1",
      "confidence":0.62
    }
  ],
  "timeline": [{"year":"string","original":"string","branch":"string","confidence":0.6}]
}

要求：
1. At least 3 branches and 4 timeline nodes.
2. Each branch must use at least 2 named agents from agents_json.
3. storyBeats must be concrete actions or scenes, not abstract labels.
4. actionLogs must cover every step from 0 to analysis.simulationPlan.totalSteps - 1.
5. actionLogs should include at least one cross-agent interaction for most steps.
6. Each concrete agent in agents_json must appear as initiatorActorId in at least one actionLog. External competitors or distant observers must still perform one concrete action by step 0 or 1 when plausible, such as probing, sending envoys, spreading rumors, mobilizing troops, or withholding support.
7. agentId and initiatorActorId must be the same concrete acting person. targetActorIds are people acted upon. responderActorIds are people who actively answer. affectedActorIds are people changed by the action but not acting.
8. actionText must describe only the initiator's own action. responseText must describe only responders' replies. effectText must describe only passive consequences. Never copy the same sentence into multiple actors.
9. Each actionLog.agentId must match an agent id from agents_json. Each actionLog.agentName must match that agent's concrete name.
10. Do not use generic action actors like 改革执行者, 最高决策者, 旧利益集团, 外部竞争者.
11. Write all user-facing values in Chinese.
12. Output must be directly parseable JSON.`
}

function buildStoryRepairPrompt(
  eventText: string,
  analysisJson: unknown,
  agentsJson: unknown,
  previousJson: unknown,
  violations: string[],
) {
  return `Repair STAGE 3 story for AionCausa.

center_event = ${JSON.stringify(eventText)}
analysis = ${JSON.stringify(analysisJson)}
agents_json = ${JSON.stringify(agentsJson)}
previous_story_json = ${JSON.stringify(previousJson)}
violations = ${JSON.stringify(violations)}

Return a complete replacement JSON object with only:
{"branches":[...],"actionLogs":[...],"timeline":[...]}

Rules:
1. Use the same event and the same concrete agents only.
2. actionLogs must cover every step from 0 to analysis.simulationPlan.totalSteps - 1.
3. actionLogs must contain concrete named-person actions, not abstract summaries.
4. Every actionLog must include initiatorActorId, targetActorIds, responderActorIds, affectedActorIds, actionText, responseText, and effectText.
5. Every concrete agent must appear as initiatorActorId in at least one actionLog.
6. timeline must have at least 4 nodes.
7. branches must have at least 3 world lines.
8. Chinese only. JSON only.`
}

function buildWorldPulsePrompt(
  world: unknown,
  runtimeWorld: unknown,
  actorContexts: unknown,
  reactionChains: unknown = [],
  dialogueExchanges: unknown = [],
  pressureThreads: unknown = [],
  focusedPressureThreadId?: string,
) {
  const runtime = toRecord(runtimeWorld)
  const actors = Array.isArray(runtime.actors) ? runtime.actors : []
  const actorRoster = actors.map((actor) => {
    const record = toRecord(actor)
    return { id: String(record.id || ''), name: String(record.name || ''), role: String(record.role || '') }
  })
  const stream = Array.isArray(runtime.stream) ? runtime.stream.slice(0, 10) : []
  const conflicts = Array.isArray(runtime.conflicts) ? runtime.conflicts : []
  const contexts = Array.isArray(actorContexts) ? actorContexts : []
  const chains = Array.isArray(reactionChains) ? reactionChains.slice(0, 6) : []
  const dialogues = Array.isArray(dialogueExchanges) ? dialogueExchanges.slice(0, 5) : []
  const pressures = Array.isArray(pressureThreads) ? pressureThreads.slice(0, 6) : []
  return `You are the World Arbiter of AionCausa V2.

Task:
Advance the event-derived virtual world into the next stable scene.
Do not summarize the whole history. Generate only the next scene after local tensions have partially converged.
Treat this as a continuous living world, not a round-based scene writer: every new action should emerge from what specific actors could see, remember, fear, or misread. A scene may contain several private signals and public events, but it must end in a readable temporary state, not a random fragment.
Before returning JSON, internally simulate about 3 to 5 rounds of interaction inside this single scene: read visible information, form private intent, attempt contact or pressure, let targets respond, then let the world arbitrate what actually becomes observable. Do not expose those internal rounds as separate scenes; compress them into one rich stable scene.

Hard rules:
1. Use existing actor ids, except when actorUpdates explicitly adds a concrete named person who becomes active in this scene.
1a. Actor-name contract: in all Chinese text fields, refer to existing actors only by their exact actor.name from actor_roster, and refer to newly added actors only by their actorUpdates.name. Do not invent aliases, substitute names, or renamed roles. If a messenger/minion is needed, keep them anonymous as "一名信使" or "亲信", not a named person.
1b. Actor roster contract: add a new actor only if the person has a concrete name, role, relation to existing actors or world pressure, and at least one signal/event in this pulse. Mark existing actors as exit/update when they die, retire, become imprisoned, disappear, lose power, or move offstage.
2. Generate each agent signal only from that agent's actor_context.visibleSummaries, not from omniscient world knowledge.
3. Agents can read public events, faction events for their faction, direct memories, rumors, and secrets they plausibly received.
4. If one agent does not have a secret in actor_context.visibleSummaries, do not let them react as if they know it.
5. Keep every actor in character. They should pursue goals, avoid risks, misread signals, form alliances, betray, hesitate, or attack when plausible.
6. Death, exile, imprisonment, disgrace, and underground activity are allowed, but must be earned by the current pressure and power balance.
7. Do not make the world immortal or harmless. Do not protect a person merely because the center event says they survived an earlier historical node.
8. recent_reaction_chains are live pressure circuits. Continue, answer, escalate, misread, or deliberately ignore at least one chain unless none are relevant.
9. recent_dialogue_exchanges are observable confrontations. Let at least one next action answer, exploit, challenge, or conceal consequences from one dialogue line, stake, or topic when available.
10. recent_pressure_threads are unresolved world tensions. Resolve, intensify, dodge, reframe, or transfer at least one pressure thread when available.
11. If focused_pressure_thread_id matches a recent_pressure_threads item, the next pulse must primarily resolve, intensify, dodge, reframe, or transfer that exact thread; mention its title, unresolvedQuestion, or nextPressure in at least one signal readSignals/plannedAction or event body/impact.
12. At least one generated event must show direct interaction, indirect pressure, surveillance, negotiation, threat, betrayal, protection, or flight between named actors when two or more actors are alive.
13. Do not flatten the world into institutional summaries. Prefer concrete human moves: who speaks, writes, hides, meets, threatens, delays, defects, kills, protects, or flees.
14. Return JSON only. Chinese user-facing text only.

world = ${JSON.stringify(world)}
runtime_summary = ${JSON.stringify({
    pulse: runtime.pulse,
    phase: runtime.phase,
    stability: runtime.stability,
    conflictLevel: runtime.conflictLevel,
    confidence: runtime.confidence,
    actors,
    recentStream: stream,
    conflicts,
  })}
actor_roster = ${JSON.stringify(actorRoster)}
actor_contexts = ${JSON.stringify(contexts)}
recent_reaction_chains = ${JSON.stringify(chains)}
recent_dialogue_exchanges = ${JSON.stringify(dialogues)}
recent_pressure_threads = ${JSON.stringify(pressures)}
focused_pressure_thread_id = ${JSON.stringify(focusedPressureThreadId || null)}

Return exactly:
{
  "actorUpdates": [
    {
      "id": "actor-update-1",
      "action": "add | update | exit",
      "actorId": "existing actor id or new stable id like runtime-actor-liu-ying",
      "name": "exact character name",
      "role": "short concrete role",
      "faction": "optional faction",
      "status": "alive | dead | exiled | imprisoned | missing | retired | disgraced | underground",
      "pressure": "what now presses this actor",
      "intent": "what this actor currently wants",
      "risk": 0.5,
      "influence": 0.5,
      "mood": "calculating | defensive | aggressive | fragile | withdrawn",
      "memory": ["short memory carried into the roster"],
      "reason": "why this actor enters, changes, or leaves now",
      "sourceEventId": "event id if applicable",
      "confidence": 0.62
    }
  ],
  "signals": [
    {
      "id": "signal-1",
      "actorId": "existing actor id or actorId from actorUpdates add",
      "visibility": "private | faction | secret | rumor | public",
      "readSignals": ["what this actor noticed from recent events or memories"],
      "privateIntent": "what this actor privately wants now",
      "plannedAction": "what this actor is preparing to do next",
      "targetActorIds": ["existing actor id or actorId from actorUpdates add"],
      "emotionalState": "short emotional/political posture",
      "confidence": 0.62
    }
  ],
  "events": [
    {
      "id": "pulse-event-1",
      "timeLabel": "string",
      "type": "speech | move | conflict | alliance | betrayal | death | policy | rumor | convergence",
      "visibility": "public | faction | private | rumor | secret | observer_only",
      "actorIds": ["existing actor id or actorId from actorUpdates add"],
      "initiatorActorId": "existing actor id or actorId from actorUpdates add who personally starts this event",
      "targetActorIds": ["actor ids acted upon"],
      "responderActorIds": ["actor ids who actively answer, refuse, bargain, fight, flee, or accept"],
      "affectedActorIds": ["actor ids changed by the event but not actively answering"],
      "actionText": "only what initiatorActorId personally does",
      "responseText": "only what responderActorIds do in reply; empty string if no active reply",
      "effectText": "only passive consequences for target/affected actors",
      "title": "short concrete event title",
      "body": "specific action with time/place texture: who does what to whom, through which messenger, meeting, order, threat, document, rumor, troop, vote, market move, or public speech; include the other actor's immediate reaction when relevant",
      "impact": "what this changes for another named actor, faction, conflict, or the world state",
      "confidence": 0.62
    }
  ]
}

Requirements:
1. Return 0 to 6 actorUpdates, 6 to 12 signals, and 6 to 10 events.
2. Signals are the Agent layer across the internal interaction rounds: what each person read, privately intends, fears, revises, and prepares.
3. Events are the arbiter layer: what becomes observable in the world after judging plausibility, opposition, failure, and response.
4. For every signal, readSignals must quote or paraphrase only items from that actor's actor_context.visibleSummaries.
5. At least one signal or event must explicitly continue one recent_reaction_chains item by naming its sourceTitle, readerActorName, triggerSummary, or reactionSummary in readSignals/body/impact.
6. If recent_dialogue_exchanges is non-empty, at least one signal or event must reference one topic, stakes, line.text, or line.stance from recent_dialogue_exchanges.
7. If recent_pressure_threads is non-empty, at least one signal or event must reference one title, unresolvedQuestion, or nextPressure from recent_pressure_threads.
8. At least four events should show one named actor acting toward, pressuring, negotiating with, surveilling, protecting, betraying, attacking, or fleeing from another named actor.
9. For every event, initiatorActorId must be one concrete actor. targetActorIds/responderActorIds/affectedActorIds must not include the initiator.
10. actionText, responseText, and effectText must not duplicate each other. They represent different subjective roles.
11. Prefer named-person interaction over abstract narration.
12. If an event is private or secret, write it as observable to the user but mark visibility correctly.
13. The output should make the observation flow readable: signals create intent, intent creates contact or pressure, targets respond, and contact or pressure creates world consequences.
14. The returned events together should feel like one stable scene after several internal exchanges: give compatible timeLabel values, one dominant conflict, and a clear temporary consequence.
15. Event bodies must be usable as a character action log. Avoid vague phrases like "局势变化", "集团调整", or "压力上升" unless they are attached to a concrete named action and response.
16. Do not use Markdown.`
}

function buildActorPulsePrompt(
  world: unknown,
  runtimeWorld: unknown,
  actorContext: unknown,
  reactionChains: unknown = [],
  dialogueExchanges: unknown = [],
  pressureThreads: unknown = [],
) {
  const runtime = toRecord(runtimeWorld)
  const context = toRecord(actorContext)
  const actors = Array.isArray(runtime.actors) ? runtime.actors : []
  const actor = actors.find((item) => toRecord(item).id === context.actorId) ?? {}
  const actorRoster = actors.map((item) => {
    const record = toRecord(item)
    return { id: String(record.id || ''), name: String(record.name || ''), role: String(record.role || '') }
  })
  const chains = Array.isArray(reactionChains) ? reactionChains.slice(0, 5) : []
  const dialogues = Array.isArray(dialogueExchanges) ? dialogueExchanges.slice(0, 4) : []
  const pressures = Array.isArray(pressureThreads) ? pressureThreads.slice(0, 4) : []
  return `You are simulating one concrete Agent inside AionCausa V2.

Task:
Generate the next stable scene from exactly one Agent's limited perspective, then produce at most one world event that plausibly follows from that action.
Treat this as one person's continuous life inside the world, not an isolated turn. The agent should carry memory, fear, leverage, and misreadings from previous visible information.

Hard rules:
1. The focused agent can use ONLY focused_actor_context.visibleSummaries and their own profile/memory.
1a. Actor-name contract: in all Chinese text fields, refer to existing actors only by their exact actor.name from actor_roster. Do not invent aliases, substitute names, rename roles, or create new major characters. If a messenger/minion is needed, keep them anonymous as "一名信使" or "亲信", not a named person.
2. Do not reveal hidden events or secrets that are not in focused_actor_context.visibleSummaries.
3. Keep the focused agent in character. They can hesitate, misread signals, bargain, betray, hide, attack, flee, or seek alliance.
4. Death, exile, imprisonment, disgrace, and underground activity are allowed if plausible.
5. The event should be what the world can observe after this focused action meets resistance from other actors, and it should land in a temporary stable state suitable to display as one scene.
6. If focused_reaction_chains contains a chain involving the focused agent, continue, answer, escalate, misread, or deliberately ignore one chain from the focused agent's perspective.
7. If focused_dialogue_exchanges contains a confrontation involving the focused agent, the next action must answer, exploit, hide from, or escalate one dialogue line/stake/topic.
8. If focused_pressure_threads contains pressure involving the focused agent, the next action must resolve, intensify, dodge, reframe, or transfer one thread.
9. If the action touches another living actor, make the contact concrete: meeting, message, threat, refusal, bribery, surveillance, escape, protection, or violence.
10. Return JSON only. Chinese user-facing text only.

world = ${JSON.stringify(world)}
runtime_summary = ${JSON.stringify({
    pulse: runtime.pulse,
    phase: runtime.phase,
    stability: runtime.stability,
    conflictLevel: runtime.conflictLevel,
    confidence: runtime.confidence,
    actors,
    recentStream: Array.isArray(runtime.stream) ? runtime.stream.slice(0, 10) : [],
    conflicts: Array.isArray(runtime.conflicts) ? runtime.conflicts : [],
  })}
actor_roster = ${JSON.stringify(actorRoster)}
focused_actor = ${JSON.stringify(actor)}
focused_actor_context = ${JSON.stringify(context)}
focused_reaction_chains = ${JSON.stringify(chains)}
focused_dialogue_exchanges = ${JSON.stringify(dialogues)}
focused_pressure_threads = ${JSON.stringify(pressures)}

Return exactly:
{
  "signals": [
    {
      "id": "focused-signal-1",
      "actorId": "${String(context.actorId || '')}",
      "visibility": "private | faction | secret | rumor | public",
      "readSignals": ["items this actor noticed from focused_actor_context.visibleSummaries"],
      "privateIntent": "what this focused actor privately wants now",
      "plannedAction": "the concrete next action this focused actor prepares",
      "targetActorIds": ["existing actor id"],
      "emotionalState": "short emotional/political posture",
      "confidence": 0.62
    }
  ],
  "events": [
    {
      "id": "focused-event-1",
      "timeLabel": "string",
      "type": "speech | move | conflict | alliance | betrayal | death | policy | rumor | convergence",
      "visibility": "public | faction | private | rumor | secret | observer_only",
      "actorIds": ["${String(context.actorId || '')}", "optional target actor id"],
      "initiatorActorId": "${String(context.actorId || '')}",
      "targetActorIds": ["optional target actor id"],
      "responderActorIds": ["optional actor id who actively answers"],
      "affectedActorIds": ["optional actor id changed by the action but not acting"],
      "title": "short concrete event title",
      "body": "specific observable action generated from the focused actor's limited perspective: include who they act toward, the concrete channel or place, and the target actor's immediate reaction when relevant",
      "actionText": "only what the focused actor personally does",
      "responseText": "only what responderActorIds actively say or do in response; empty string if no response",
      "effectText": "passive consequence for targetActorIds or affectedActorIds",
      "impact": "what this changes for another named actor, faction, conflict, or the world state",
      "confidence": 0.62
    }
  ]
}

Requirements:
1. Return exactly 1 signal for the focused actor.
2. Return 0 or 1 events. If the action remains only a private plan, return no events.
3. readSignals must quote or paraphrase only focused_actor_context.visibleSummaries.
4. If focused_reaction_chains is non-empty, readSignals or plannedAction must explicitly reference one sourceTitle, triggerSummary, or reactionSummary from focused_reaction_chains.
5. If focused_dialogue_exchanges is non-empty, readSignals or plannedAction must explicitly reference one topic, stakes, line.text, or line.stance from focused_dialogue_exchanges.
6. If focused_pressure_threads is non-empty, readSignals or plannedAction must explicitly reference one title, unresolvedQuestion, or nextPressure from focused_pressure_threads.
7. Use existing actor ids only.
8. The focused agent is not immortal; death, exile, imprisonment, disgrace, or disappearance can follow if the pressure balance makes it plausible.
9. The event body must be usable as this character's action log, not an abstract summary.
10. If an event is returned, initiatorActorId must equal the focused actor id. targetActorIds/responderActorIds/affectedActorIds must not include the initiator.
11. actionText must only describe the focused actor's action. responseText must only describe the active response from responders. effectText must only describe passive consequences. Do not duplicate the same sentence across these fields.
12. Do not use Markdown.`
}

function buildWorldSummaryPrompt(world: unknown, runtimeWorld: unknown) {
  const worldRecord = toRecord(world)
  const runtimeRecord = toRecord(runtimeWorld)
  const stream = Array.isArray(runtimeRecord.stream) ? runtimeRecord.stream.slice(0, 24) : []
  const signals = Array.isArray(runtimeRecord.signals) ? runtimeRecord.signals.slice(0, 16) : []
  const actors = Array.isArray(runtimeRecord.actors) ? runtimeRecord.actors : []
  return `You are AionCausa's world historian.
Read the current simulated world and write one vivid Chinese paragraph that summarizes the whole world's development so far.

center_event = ${JSON.stringify(worldRecord.eventText || worldRecord.centralQuestion || runtimeRecord.centerEvent || '')}
event_summary = ${JSON.stringify(worldRecord.eventSummary || '')}
runtime_phase = ${JSON.stringify(runtimeRecord.phase || '')}
actors = ${JSON.stringify(actors)}
recent_events = ${JSON.stringify(stream)}
recent_private_signals = ${JSON.stringify(signals)}
convergence = ${JSON.stringify(runtimeRecord.convergence || {})}

Requirements:
1. Return plain Chinese text only. No JSON. No Markdown. No heading.
2. Write one continuous paragraph, 130 to 260 Chinese characters.
3. Tell the overall story of the world so far, not a list of who did what.
4. Every action must have a clear subject. Do not write subjectless fragments like "用诗词试探".
5. Do not compare with the original timeline.
6. Avoid labels such as "目前已经发生的是", "从史学观察看", or "总结".
7. Avoid double punctuation, semicolon stitching, bullet-like rhythm, or "；；/。。/；。".
8. Mention the current unresolved tension or suspense at the end.`
}

function actorRosterFromRuntimeActors(actors: unknown[]) {
  return actors.map((actor) => {
    const record = toRecord(actor)
    return { id: String(record.id || ''), name: String(record.name || ''), role: String(record.role || '') }
  })
}

function collectPulseText(parsed: unknown) {
  const record = toRecord(parsed)
  const signals = Array.isArray(record.signals) ? record.signals : []
  const events = Array.isArray(record.events) ? record.events : []
  return [...signals, ...events]
    .map((item) => {
      const entry = toRecord(item)
      return [
        entry.title,
        entry.body,
        entry.impact,
        entry.actionText,
        entry.responseText,
        entry.effectText,
        entry.privateIntent,
        entry.plannedAction,
        entry.emotionalState,
        ...(Array.isArray(entry.readSignals) ? entry.readSignals : []),
      ]
        .filter((value) => typeof value === 'string')
        .join(' ')
    })
    .join(' ')
}

function textForSignalOrEvent(item: unknown) {
  const entry = toRecord(item)
  return [
    entry.title,
    entry.body,
    entry.impact,
    entry.actionText,
    entry.responseText,
    entry.effectText,
    entry.privateIntent,
    entry.plannedAction,
    ...(Array.isArray(entry.readSignals) ? entry.readSignals : []),
  ]
    .filter((value) => typeof value === 'string')
    .join(' ')
}

function findPulseActorNameViolations(parsed: unknown, actors: unknown[]) {
  const actorRoster = actorRosterFromRuntimeActors(actors)
  const violations: string[] = []
  const record = toRecord(parsed)
  const actorUpdates = Array.isArray(record.actorUpdates) ? record.actorUpdates : []
  const addedActors = actorUpdates
    .map((item) => toRecord(item))
    .filter((item) => String(item.action || '') === 'add' && String(item.actorId || '') && String(item.name || ''))
    .map((item) => ({ id: String(item.actorId || ''), name: String(item.name || ''), role: String(item.role || '') }))
  const actorNameById = new Map([...actorRoster, ...addedActors].map((actor) => [actor.id, actor.name]))
  const signals = Array.isArray(record.signals) ? record.signals : []
  const events = Array.isArray(record.events) ? record.events : []

  signals.forEach((signal, index) => {
    const entry = toRecord(signal)
    const text = textForSignalOrEvent(entry)
    const targetIds = Array.isArray(entry.targetActorIds) ? entry.targetActorIds.map(String) : []
    targetIds.forEach((id) => {
      const name = actorNameById.get(id)
      if (name && !text.includes(name)) {
        violations.push(`signal[${index}] targetActorIds includes ${id}/${name}, but text does not use exact actor.name`)
      }
    })
  })

  events.forEach((event, index) => {
    const entry = toRecord(event)
    const text = textForSignalOrEvent(entry)
    const ids = [
      entry.initiatorActorId,
      ...(Array.isArray(entry.targetActorIds) ? entry.targetActorIds : []),
      ...(Array.isArray(entry.responderActorIds) ? entry.responderActorIds : []),
    ]
      .filter(Boolean)
      .map(String)
    ids.forEach((id) => {
      const name = actorNameById.get(id)
      if (name && !text.includes(name)) {
        violations.push(`event[${index}] references ${id}/${name}, but text does not use exact actor.name`)
      }
    })
  })

  const allText = collectPulseText(parsed)
  const allowedNames = new Set([...actorRoster, ...addedActors].map((actor) => actor.name).filter(Boolean))
  const inventedRoleNames = allText.match(/(?:宰相|国王|王后|将军|公主|王子|女巫|骑士|首相|总统|舰长|司令)[\u4e00-\u9fa5]{1,3}/g) ?? []
  inventedRoleNames.forEach((name) => {
    if (!allowedNames.has(name) && !name.includes('一名') && !name.includes('亲信')) {
      violations.push(`text appears to invent or rename an actor as "${name}"`)
    }
  })

  return Array.from(new Set(violations)).slice(0, 12)
}

function buildWorldPulseRepairPrompt(parsed: unknown, actors: unknown[], violations: string[]) {
  const actorRoster = actorRosterFromRuntimeActors(actors)
  return `Repair this AionCausa world-pulse JSON so it obeys the actor-name contract.

Actor-name contract:
1. Use only actor ids and exact actor.name values from actor_roster.
2. Do not invent named characters, aliases, substitute titles, or renamed roles.
3. If a minor helper is needed, use anonymous wording such as "一名信使", "亲信", or "侍从"; never give them a personal name.
4. Keep actorId, initiatorActorId, targetActorIds, responderActorIds, and affectedActorIds as existing ids only.
5. Rewrite Chinese text fields so every referenced actor id is represented by the exact actor.name.
6. Preserve the same causal meaning as much as possible.
7. Return JSON only.

actor_roster = ${JSON.stringify(actorRoster)}
violations = ${JSON.stringify(violations)}
bad_json = ${JSON.stringify(parsed)}

Return the same shape:
{
  "actorUpdates": [],
  "signals": [],
  "events": []
}`
}

function enforcePulseActorNameContract(parsed: unknown, actors: unknown[]) {
  const actorRoster = actorRosterFromRuntimeActors(actors)
  const actorNameById = new Map(actorRoster.map((actor) => [actor.id, actor.name]))
  const record = toRecord(parsed)
  const signals = Array.isArray(record.signals) ? record.signals : []
  const events = Array.isArray(record.events) ? record.events : []
  const nameList = (ids: string[]) => ids.map((id) => actorNameById.get(id)).filter(Boolean).join('、')

  return {
    ...record,
    signals: signals.map((signal, index) => {
      const entry = toRecord(signal)
      const actorId = String(entry.actorId || '')
      const actorName = actorNameById.get(actorId) || '该人物'
      const targetIds = Array.isArray(entry.targetActorIds) ? entry.targetActorIds.map(String).filter((id) => actorNameById.has(id) && id !== actorId) : []
      const targetNames = nameList(targetIds) || '关键人物'
      return {
        ...entry,
        id: String(entry.id || `signal-${index + 1}`),
        actorId,
        targetActorIds: targetIds,
        readSignals: [`${actorName}注意到上一幕中与${targetNames}相关的压力仍未收束。`],
        privateIntent: `${actorName}想在不暴露全部底牌的情况下影响${targetNames}的下一步判断。`,
        plannedAction: `${actorName}准备通过一名信使接触${targetNames}，试探对方底线，并保留升级冲突或临时妥协的选项。`,
        emotionalState: String(entry.emotionalState || '谨慎试探'),
      }
    }),
    events: events.map((event, index) => {
      const entry = toRecord(event)
      const initiatorActorId = String(entry.initiatorActorId || '')
      const initiatorName = actorNameById.get(initiatorActorId) || '关键人物'
      const targetIds = Array.isArray(entry.targetActorIds) ? entry.targetActorIds.map(String).filter((id) => actorNameById.has(id) && id !== initiatorActorId) : []
      const responderIds = Array.isArray(entry.responderActorIds) ? entry.responderActorIds.map(String).filter((id) => actorNameById.has(id) && id !== initiatorActorId) : []
      const affectedIds = Array.isArray(entry.affectedActorIds) ? entry.affectedActorIds.map(String).filter((id) => actorNameById.has(id) && id !== initiatorActorId) : []
      const targetNames = nameList(targetIds) || '对手'
      const responderNames = nameList(responderIds)
      const affectedNames = nameList(affectedIds)
      const actorIds = Array.from(new Set([initiatorActorId, ...targetIds, ...responderIds, ...affectedIds].filter(Boolean)))
      return {
        ...entry,
        id: String(entry.id || `pulse-event-${index + 1}`),
        actorIds,
        initiatorActorId,
        targetActorIds: targetIds,
        responderActorIds: responderIds,
        affectedActorIds: affectedIds,
        title: `${initiatorName}试探${targetNames}`,
        actionText: `${initiatorName}通过一名信使向${targetNames}释放试探条件。`,
        responseText: responderNames ? `${responderNames}暂不公开摊牌，而是先观察${initiatorName}是否还有后续筹码。` : '',
        effectText: affectedNames ? `${affectedNames}因此重新评估自身站队风险。` : `${targetNames}被迫重新判断局势。`,
        body: `${initiatorName}通过一名信使向${targetNames}释放试探条件，要求对方在当前冲突中给出明确态度。${responderNames ? `${responderNames}没有立刻摊牌，而是选择继续观察${initiatorName}的后续筹码。` : ''}`,
        impact: affectedNames ? `${affectedNames}因此重新评估自身站队风险，世界暂时进入更谨慎的对峙状态。` : `${targetNames}被迫重新判断与${initiatorName}的关系，世界暂时进入更谨慎的对峙状态。`,
      }
    }),
  }
}

function writeJson(response: import('node:http').ServerResponse, statusCode: number, body: unknown) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(body))
}

const dataDir = path.resolve(process.cwd(), 'data')
const qaHistoryPath = path.resolve(dataDir, 'qa-history.json')
const worldArchiveDir = path.resolve(dataDir, 'worlds')
const worldArchiveIndexPath = path.resolve(worldArchiveDir, 'index.json')

function safeArchiveId(value: unknown) {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : `world-${Date.now()}`
  return raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80)
}

async function readQaHistory() {
  try {
    const content = await readFile(qaHistoryPath, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function appendQaHistory(record: Record<string, unknown>) {
  const history = await readQaHistory()
  const nextRecord = {
    id: typeof record.id === 'string' ? record.id : `qa-${Date.now()}`,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString(),
    ...record,
  }
  await mkdir(path.dirname(qaHistoryPath), { recursive: true })
  await writeFile(qaHistoryPath, JSON.stringify([nextRecord, ...history].slice(0, 200), null, 2), 'utf8')
  return nextRecord
}

async function readWorldArchiveIndex() {
  try {
    const content = await readFile(worldArchiveIndexPath, 'utf8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function saveWorldArchive(payload: Record<string, unknown>) {
  const id = safeArchiveId(payload.id)
  const now = new Date().toISOString()
  const archive = {
    createdAt: typeof payload.createdAt === 'string' ? payload.createdAt : now,
    updatedAt: now,
    ...payload,
    id,
  }
  const world = toRecord(payload.world)
  const runtimeWorld = toRecord(payload.runtimeWorld)
  const summary = {
    id,
    title: String(world.title || runtimeWorld.worldTitle || 'AionCausa 世界档案'),
    centerEvent: String(world.eventText || runtimeWorld.centerEvent || ''),
    phase: String(runtimeWorld.phase || ''),
    pulse: Number(runtimeWorld.pulse || 0),
    confidence: Number(runtimeWorld.confidence || world.confidence || 0),
    updatedAt: now,
  }
  const index = await readWorldArchiveIndex()
  const nextIndex = [summary, ...index.filter((item) => toRecord(item).id !== id)].slice(0, 80)

  await mkdir(worldArchiveDir, { recursive: true })
  await writeFile(path.resolve(worldArchiveDir, `${id}.json`), JSON.stringify(archive, null, 2), 'utf8')
  await writeFile(worldArchiveIndexPath, JSON.stringify(nextIndex, null, 2), 'utf8')
  return { archive, summary }
}

async function readWorldArchive(id: string) {
  const archiveId = safeArchiveId(id)
  const content = await readFile(path.resolve(worldArchiveDir, `${archiveId}.json`), 'utf8')
  return JSON.parse(content)
}

async function deleteWorldArchive(id: string) {
  const archiveId = safeArchiveId(id)
  const index = await readWorldArchiveIndex()
  const nextIndex = index.filter((item) => toRecord(item).id !== archiveId)
  await mkdir(worldArchiveDir, { recursive: true })
  await writeFile(worldArchiveIndexPath, JSON.stringify(nextIndex, null, 2), 'utf8')
  try {
    await unlink(path.resolve(worldArchiveDir, `${archiveId}.json`))
  } catch {
    // The index is the source of truth for the UI; missing archive files are harmless.
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'aioncausa-provider-proxy',
      configureServer(server) {
        server.middlewares.use('/api/provider-test', async (request, response) => {
          if (request.method !== 'POST') {
            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
            return
          }

          try {
            const payload = JSON.parse(await readRequestBody(request))
            const result = await callProvider(payload, 'Reply in one short sentence: AionCausa provider check ok.', 80)
            writeJson(response, result.statusCode, result.body)
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '未知连接错误',
            })
          }
        })

        server.middlewares.use('/api/qa-history', async (request, response) => {
          try {
            if (request.method === 'GET') {
              writeJson(response, 200, { ok: true, records: await readQaHistory() })
              return
            }

            if (request.method === 'POST') {
              const payload = JSON.parse(await readRequestBody(request))
              const record = await appendQaHistory(typeof payload === 'object' && payload ? payload : {})
              writeJson(response, 200, { ok: true, record })
              return
            }

            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '问答历史写入失败',
            })
          }
        })

        server.middlewares.use('/api/world-archives', async (request, response) => {
          try {
            if (request.method !== 'GET') {
              writeJson(response, 405, { ok: false, message: 'Method not allowed' })
              return
            }

            writeJson(response, 200, { ok: true, records: await readWorldArchiveIndex() })
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '世界档案读取失败',
            })
          }
        })

        server.middlewares.use('/api/world-archive', async (request, response) => {
          try {
            if (request.method === 'GET') {
              const url = new URL(request.url || '', 'http://localhost')
              const id = url.searchParams.get('id') || ''
              if (!id) {
                writeJson(response, 400, { ok: false, message: 'Archive id is required' })
                return
              }

              writeJson(response, 200, { ok: true, archive: await readWorldArchive(id) })
              return
            }

            if (request.method === 'POST') {
              const payload = JSON.parse(await readRequestBody(request))
              const result = await saveWorldArchive(typeof payload === 'object' && payload ? payload : {})
              writeJson(response, 200, { ok: true, archive: result.archive, summary: result.summary })
              return
            }

            if (request.method === 'DELETE') {
              const url = new URL(request.url || '', 'http://localhost')
              const id = url.searchParams.get('id') || ''
              if (!id) {
                writeJson(response, 400, { ok: false, message: 'Archive id is required' })
                return
              }

              await deleteWorldArchive(id)
              writeJson(response, 200, { ok: true })
              return
            }

            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '世界档案写入失败',
            })
          }
        })

        server.middlewares.use('/api/preflight', async (request, response) => {
          if (request.method !== 'POST') {
            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
            return
          }

          try {
            const payload = JSON.parse(await readRequestBody(request))
            const provider = typeof payload.provider === 'object' && payload.provider ? payload.provider : {}
            const eventText = String(payload.eventText || '').trim()
            if (!eventText) {
              writeJson(response, 400, { ok: false, message: '中心事件不能为空' })
              return
            }

            const result = await callProvider(
              provider as Record<string, unknown>,
              buildPreflightPrompt(eventText),
              Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 1500), 1500),
              true,
            )
            writeJson(response, result.statusCode, result.body)
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '预检失败',
            })
          }
        })

        server.middlewares.use('/api/simulate', async (request, response) => {
          if (request.method !== 'POST') {
            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
            return
          }

          try {
            const payload = JSON.parse(await readRequestBody(request))
            const provider = typeof payload.provider === 'object' && payload.provider ? payload.provider : {}
            const eventText = String(payload.eventText || '').trim()
            if (!eventText) {
              writeJson(response, 400, { ok: false, message: '中心事件不能为空' })
              return
            }

            const preflight = typeof payload.preflight === 'object' && payload.preflight ? payload.preflight : null
            const preflightRecord = toRecord(preflight)
            const enrichedEventText =
              preflight && typeof preflightRecord.enrichedEventText === 'string' && preflightRecord.enrichedEventText.trim()
                ? `${eventText}

Preflight supplement: ${preflightRecord.enrichedEventText.trim()}
Suggested actors: ${JSON.stringify(preflightRecord.suggestedActors || [])}
Required background: ${JSON.stringify(preflightRecord.backgroundNotes || [])}`
                : eventText

            const analysisResult = await callProvider(
              provider as Record<string, unknown>,
              buildAnalysisPrompt(enrichedEventText),
              Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 1800), 1800),
              true,
            )
            if (analysisResult.statusCode !== 200 || !analysisResult.body.content) {
              writeJson(response, analysisResult.statusCode, analysisResult.body)
              return
            }

            const analysisJson = parseModelJson(String(analysisResult.body.content))
            let agentsResult = await callProvider(
              provider as Record<string, unknown>,
              buildAgentsPrompt(enrichedEventText, analysisJson),
              Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 2600), 2600),
              true,
            )
            if (agentsResult.statusCode !== 200 || !agentsResult.body.content) {
              writeJson(response, agentsResult.statusCode, agentsResult.body)
              return
            }

            let agentsJson = parseModelJson(String(agentsResult.body.content))
            let agentViolations = findAgentViolations(agentsJson)
            if (agentViolations.length) {
              agentsResult = await callProvider(
                provider as Record<string, unknown>,
                buildAgentRepairPrompt(enrichedEventText, analysisJson, agentsJson, agentViolations),
                Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 2600), 2600),
                true,
              )
              if (agentsResult.statusCode !== 200 || !agentsResult.body.content) {
                writeJson(response, agentsResult.statusCode, agentsResult.body)
                return
              }
              agentsJson = parseModelJson(String(agentsResult.body.content))
              agentViolations = findAgentViolations(agentsJson)
            }

            const totalSteps = Math.max(2, Math.round(Number(toRecord(toRecord(analysisJson).simulationPlan).totalSteps ?? 6)))
            const storyResult = await callProvider(
              provider as Record<string, unknown>,
              buildStoryPrompt(enrichedEventText, analysisJson, agentsJson),
              Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 3600), 3600),
              true,
            )
            if (storyResult.statusCode !== 200 || !storyResult.body.content) {
              writeJson(response, storyResult.statusCode, storyResult.body)
              return
            }

            let storyJson = parseModelJson(String(storyResult.body.content))
            let storyViolations = findStoryViolations(storyJson, totalSteps, agentsJson)
            if (storyViolations.length) {
              const repairResult = await callProvider(
                provider as Record<string, unknown>,
                buildStoryRepairPrompt(enrichedEventText, analysisJson, agentsJson, storyJson, storyViolations),
                Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 3600), 3600),
                true,
              )
              if (repairResult.statusCode === 200 && repairResult.body.content) {
                storyJson = parseModelJson(String(repairResult.body.content))
                storyViolations = findStoryViolations(storyJson, totalSteps, agentsJson)
              }
            }

            writeJson(response, 200, {
              ok: true,
              content: JSON.stringify({ ...(analysisJson as object), ...(storyJson as object), agents: extractAgents(agentsJson) }),
              message:
                agentViolations.length || storyViolations.length
                  ? `分阶段生成完成，仍有 ${agentViolations.length + storyViolations.length} 个结构警告`
                  : '分阶段生成完成',
              latencyMs: (analysisResult.body.latencyMs || 0) + (agentsResult.body.latencyMs || 0) + (storyResult.body.latencyMs || 0),
            })
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '模型生成失败',
            })
          }
        })

        server.middlewares.use('/api/world-pulse', async (request, response) => {
          if (request.method !== 'POST') {
            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
            return
          }

          try {
            const payload = JSON.parse(await readRequestBody(request))
            const provider = typeof payload.provider === 'object' && payload.provider ? payload.provider : {}
            const world = typeof payload.world === 'object' && payload.world ? payload.world : {}
            const runtimeWorld = typeof payload.runtimeWorld === 'object' && payload.runtimeWorld ? payload.runtimeWorld : {}
            const actorContexts = Array.isArray(payload.actorContexts) ? payload.actorContexts : []
            const reactionChains = Array.isArray(payload.reactionChains) ? payload.reactionChains : []
            const dialogueExchanges = Array.isArray(payload.dialogueExchanges) ? payload.dialogueExchanges : []
            const pressureThreads = Array.isArray(payload.pressureThreads) ? payload.pressureThreads : []
            const focusedPressureThreadId = typeof payload.focusedPressureThreadId === 'string' && payload.focusedPressureThreadId.trim()
              ? payload.focusedPressureThreadId.trim()
              : undefined

            const actors = Array.isArray(toRecord(runtimeWorld).actors) ? (toRecord(runtimeWorld).actors as unknown[]) : []
            if (!actors.length) {
              writeJson(response, 400, { ok: false, message: 'Runtime world has no actors' })
              return
            }

            const result = await callProvider(
              provider as Record<string, unknown>,
              buildWorldPulsePrompt(world, runtimeWorld, actorContexts, reactionChains, dialogueExchanges, pressureThreads, focusedPressureThreadId),
              Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 2200), 2200),
              true,
            )
            if (result.statusCode !== 200 || !result.body.content) {
              writeJson(response, result.statusCode, result.body)
              return
            }

            let parsed = parseModelJson(String(result.body.content))
            let actorNameViolations = findPulseActorNameViolations(parsed, actors)
            if (actorNameViolations.length) {
              const repairResult = await callProvider(
                provider as Record<string, unknown>,
                buildWorldPulseRepairPrompt(parsed, actors, actorNameViolations),
                Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 2200), 2200),
                true,
              )
              if (repairResult.statusCode === 200 && repairResult.body.content) {
                parsed = parseModelJson(String(repairResult.body.content))
                actorNameViolations = findPulseActorNameViolations(parsed, actors)
              }
            }
            if (actorNameViolations.length) {
              parsed = enforcePulseActorNameContract(parsed, actors)
              actorNameViolations = findPulseActorNameViolations(parsed, actors)
            }
            const parsedRecord = toRecord(parsed)
            const actorUpdates = Array.isArray(parsedRecord.actorUpdates) ? (parsedRecord.actorUpdates as unknown[]) : []
            const events = Array.isArray(parsedRecord.events) ? (parsedRecord.events as unknown[]) : []
            const signals = Array.isArray(parsedRecord.signals) ? (parsedRecord.signals as unknown[]) : []
            writeJson(response, 200, {
              ok: true,
              content: JSON.stringify({ actorUpdates: actorUpdates.slice(0, 6), signals: signals.slice(0, 12), events: events.slice(0, 10) }),
              message: actorNameViolations.length ? `世界脉冲生成完成，仍有 ${actorNameViolations.length} 个角色名一致性警告` : '世界脉冲生成完成',
              latencyMs: result.body.latencyMs,
            })
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '世界脉冲生成失败',
            })
          }
        })

        server.middlewares.use('/api/actor-pulse', async (request, response) => {
          if (request.method !== 'POST') {
            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
            return
          }

          try {
            const payload = JSON.parse(await readRequestBody(request))
            const provider = typeof payload.provider === 'object' && payload.provider ? payload.provider : {}
            const world = typeof payload.world === 'object' && payload.world ? payload.world : {}
            const runtimeWorld = typeof payload.runtimeWorld === 'object' && payload.runtimeWorld ? payload.runtimeWorld : {}
            const actorContext = typeof payload.actorContext === 'object' && payload.actorContext ? payload.actorContext : {}
            const reactionChains = Array.isArray(payload.reactionChains) ? payload.reactionChains : []
            const dialogueExchanges = Array.isArray(payload.dialogueExchanges) ? payload.dialogueExchanges : []
            const pressureThreads = Array.isArray(payload.pressureThreads) ? payload.pressureThreads : []
            const actorId = String(toRecord(actorContext).actorId || payload.actorId || '')
            const actors = Array.isArray(toRecord(runtimeWorld).actors) ? (toRecord(runtimeWorld).actors as unknown[]) : []

            if (!actors.some((actor) => toRecord(actor).id === actorId)) {
              writeJson(response, 400, { ok: false, message: 'Focused actor is missing from runtime world' })
              return
            }

            const result = await callProvider(
              provider as Record<string, unknown>,
              buildActorPulsePrompt(world, runtimeWorld, actorContext, reactionChains, dialogueExchanges, pressureThreads),
              Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 1000), 1000),
              true,
            )
            if (result.statusCode !== 200 || !result.body.content) {
              writeJson(response, result.statusCode, result.body)
              return
            }

            const parsed = parseModelJson(String(result.body.content))
            const events = Array.isArray(toRecord(parsed).events) ? (toRecord(parsed).events as unknown[]) : []
            const signals = Array.isArray(toRecord(parsed).signals) ? (toRecord(parsed).signals as unknown[]) : []
            writeJson(response, 200, {
              ok: true,
              content: JSON.stringify({ signals: signals.slice(0, 1), events: events.slice(0, 1) }),
              message: 'Agent 视角脉冲生成完成',
              latencyMs: result.body.latencyMs,
            })
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : 'Agent 视角脉冲生成失败',
            })
          }
        })

        server.middlewares.use('/api/world-summary', async (request, response) => {
          if (request.method !== 'POST') {
            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
            return
          }

          try {
            const payload = JSON.parse(await readRequestBody(request))
            const provider = typeof payload.provider === 'object' && payload.provider ? payload.provider : {}
            const world = typeof payload.world === 'object' && payload.world ? payload.world : {}
            const runtimeWorld = typeof payload.runtimeWorld === 'object' && payload.runtimeWorld ? payload.runtimeWorld : {}
            const result = await callProvider(
              provider as Record<string, unknown>,
              buildWorldSummaryPrompt(world, runtimeWorld),
              Math.max(Number((provider as Record<string, unknown>).maxTokens ?? 700), 700),
              false,
            )
            writeJson(response, result.statusCode, result.body)
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : '世界总结生成失败',
            })
          }
        })

        server.middlewares.use('/api/interview', async (request, response) => {
          if (request.method !== 'POST') {
            writeJson(response, 405, { ok: false, message: 'Method not allowed' })
            return
          }

          try {
            const payload = JSON.parse(await readRequestBody(request))
            const provider = typeof payload.provider === 'object' && payload.provider ? payload.provider : {}
            const agent = payload.agent || {}
            const world = payload.world || {}
            const runtimeWorld = typeof payload.runtimeWorld === 'object' && payload.runtimeWorld ? payload.runtimeWorld : {}
            const actorContext = typeof payload.actorContext === 'object' && payload.actorContext ? payload.actorContext : {}
            const actorLedger = typeof payload.actorLedger === 'object' && payload.actorLedger ? payload.actorLedger : {}
            const confrontationScenes = Array.isArray(payload.confrontationScenes) ? payload.confrontationScenes.slice(0, 5) : []
            const observationFlow = Array.isArray(payload.observationFlow) ? payload.observationFlow.slice(0, 4) : []
            const question = String(payload.question || '').trim()

            if (!question) {
              writeJson(response, 400, { ok: false, message: 'Question is required' })
              return
            }

            const agentLogs = Array.isArray(world.actionLogs)
              ? world.actionLogs.filter((log: { agentId?: string }) => log.agentId === agent.id)
              : []
            const runtimeActors = Array.isArray(toRecord(runtimeWorld).actors) ? (toRecord(runtimeWorld).actors as unknown[]) : []
            const runtimeActor = runtimeActors.find((item) => toRecord(item).id === toRecord(agent).id) || {}
            const prompt = `You are being interviewed as one living Agent inside AionCausa V2.
Answer in Chinese, first person, from this specific person's limited perspective.
Do not answer as the narrator, developer, model, or provider.
Do not reveal secrets outside visible_context or this actor's own ledger.
If the character does not know something, say what they suspect instead of becoming omniscient.

world_title = ${JSON.stringify(world.title || '')}
center_event = ${JSON.stringify(world.eventText || '')}
simulation_plan = ${JSON.stringify(world.simulationPlan || {})}
agent_profile = ${JSON.stringify(agent)}
runtime_actor = ${JSON.stringify(runtimeActor)}
visible_context = ${JSON.stringify(actorContext)}
actor_ledger = ${JSON.stringify(actorLedger)}
active_confrontation_scenes = ${JSON.stringify(confrontationScenes)}
personal_observation_flow = ${JSON.stringify(observationFlow)}
agent_action_logs = ${JSON.stringify(agentLogs)}
user_question = ${JSON.stringify(question)}

Answer as this agent.
Requirements:
1. 80 to 220 Chinese characters.
2. Mention one concrete memory, pressure, confrontation, or planned action from actor_ledger, visible_context, active_confrontation_scenes, or personal_observation_flow.
3. Keep the voice personal: fear, calculation, anger, loyalty, hesitation, or ambition are allowed if supported by context.
4. Speak like a person in a private interview, not like a data card. Do not use labels such as "个人谋划：", "当前压力：", "可见世界：", "携带记忆：", or "人物行动：".
5. Do not begin with the character name plus colon. Do not explain "我不会按旁观者的说法回答" or mention narrator/observer/model/provider.
6. End with a complete sentence.
7. No Markdown. No JSON. Return the interview answer text only.`

            let result = await callProvider(provider as Record<string, unknown>, prompt, 520)
            if (result.statusCode === 200 && !String(result.body.content || '').trim()) {
              result = await callProvider(
                provider as Record<string, unknown>,
                `${prompt}\n\nThe previous answer was empty. Return the character interview answer text only, in Chinese.`,
                520,
              )
            }
            const content =
              cleanInterviewContent(result.body.content, result.body.message) ||
              buildFallbackInterviewAnswer(agent, runtimeActor, actorContext, actorLedger, question)
            writeJson(response, result.statusCode, {
              ok: result.statusCode === 200 && Boolean(content),
              content,
              message: content ? result.body.message : '模型没有返回采访内容，请换一个问题重试。',
              latencyMs: result.body.latencyMs,
            })
          } catch (error) {
            writeJson(response, 500, {
              ok: false,
              message: error instanceof Error ? error.message : 'Interview failed',
            })
          }
        })
      },
    },
  ],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test-setup.ts',
  },
})
