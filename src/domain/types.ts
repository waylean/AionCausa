export type EvidenceSource =
  | 'user_input'
  | 'llm_background'
  | 'knowledge_base'
  | 'system_inference'
  | 'external_connector';

export type HorizonMode = 'short' | 'strategic' | 'generational' | 'mythic';

export type BranchTone = 'stable' | 'volatile' | 'speculative';

export interface EvidenceItem {
  id: string;
  claim: string;
  source: EvidenceSource;
  confidence: number;
  usedIn: string[];
}

export interface AgentProfile {
  id: string;
  name: string;
  role: string;
  identity?: string;
  dilemma?: string;
  currentPressure?: string;
  goals: string[];
  constraints: string[];
  leverage: string[];
  actions?: string[];
  relationships?: string[];
  riskTolerance: number;
  confidence: number;
}

export interface SimulationPlan {
  startLabel: string;
  endLabel: string;
  durationLabel: string;
  totalSteps: number;
  stopReason: string;
}

export interface EventAnalysis {
  facts: string[];
  assumptions: string[];
  causes: string[];
  openQuestions: string[];
}

export interface GraphMemoryNode {
  id: string;
  label: string;
  type: 'event' | 'person' | 'group' | 'place' | 'cause' | 'assumption' | 'consequence';
  summary: string;
  confidence: number;
  links: string[];
}

export interface AgentActionLog {
  id: string;
  step: number;
  timeLabel: string;
  agentId: string;
  agentName: string;
  initiatorActorId?: string;
  targetActorIds?: string[];
  responderActorIds?: string[];
  affectedActorIds?: string[];
  actionText?: string;
  responseText?: string;
  effectText?: string;
  action: string;
  detail: string;
  impact: string;
  branchId?: string;
  confidence: number;
}

export interface PremiseNode {
  id: string;
  label: string;
  parentId?: string;
  plausibility: number;
  impact: number;
}

export interface TimelinePoint {
  year: string;
  original: string;
  branch: string;
  confidence: number;
}

export interface WorldMetric {
  id: string;
  label: string;
  value: string;
  delta: string;
  tone: BranchTone;
}

export interface SimulationBranch {
  id: string;
  title: string;
  horizon: HorizonMode;
  credibility: number;
  divergence: number;
  trigger: string;
  summary: string;
  causalChain: string[];
  storyBeats?: string[];
  metrics: WorldMetric[];
  tone: BranchTone;
}

export interface SimulationWorld {
  title: string;
  eventText: string;
  eventSummary: string;
  domain: string;
  centralQuestion: string;
  confidence: number;
  horizon: HorizonMode;
  simulationPlan: SimulationPlan;
  eventAnalysis: EventAnalysis;
  graphMemory: GraphMemoryNode[];
  evidence: EvidenceItem[];
  agents: AgentProfile[];
  actionLogs: AgentActionLog[];
  premises: PremiseNode[];
  branches: SimulationBranch[];
  timeline: TimelinePoint[];
  metrics: WorldMetric[];
}

export interface GraphNodeData {
  label: string;
  detail: string;
  kind: 'event' | 'evidence' | 'agent' | 'premise' | 'branch' | 'outcome';
  confidence?: number;
}

export type RuntimeActorStatus =
  | 'alive'
  | 'dead'
  | 'exiled'
  | 'imprisoned'
  | 'missing'
  | 'retired'
  | 'disgraced'
  | 'underground';

export type RuntimeVisibility = 'public' | 'faction' | 'private' | 'rumor' | 'secret' | 'observer_only';

export type RuntimeEventType =
  | 'speech'
  | 'move'
  | 'conflict'
  | 'alliance'
  | 'betrayal'
  | 'death'
  | 'policy'
  | 'rumor'
  | 'convergence';

export interface RuntimeActor {
  id: string;
  name: string;
  role: string;
  faction: string;
  status: RuntimeActorStatus;
  pressure: string;
  intent: string;
  risk: number;
  influence: number;
  mood: 'calculating' | 'defensive' | 'aggressive' | 'fragile' | 'withdrawn';
  memory: string[];
}

export interface RuntimeWorldEvent {
  id: string;
  pulse: number;
  timeLabel: string;
  type: RuntimeEventType;
  visibility: RuntimeVisibility;
  actorIds: string[];
  initiatorActorId?: string;
  targetActorIds?: string[];
  responderActorIds?: string[];
  affectedActorIds?: string[];
  actionText?: string;
  responseText?: string;
  effectText?: string;
  title: string;
  body: string;
  impact: string;
  confidence: number;
}

export interface RuntimeAgentSignal {
  id: string;
  pulse: number;
  actorId: string;
  actorName: string;
  visibility: RuntimeVisibility;
  readSignals: string[];
  privateIntent: string;
  plannedAction: string;
  targetActorIds: string[];
  emotionalState: string;
  confidence: number;
}

export interface RuntimeActorUpdate {
  id: string;
  pulse: number;
  action: 'add' | 'update' | 'exit';
  actorId: string;
  name: string;
  role: string;
  faction?: string;
  status?: RuntimeActorStatus;
  pressure?: string;
  intent?: string;
  risk?: number;
  influence?: number;
  mood?: RuntimeActor['mood'];
  memory?: string[];
  reason: string;
  sourceEventId?: string;
  confidence: number;
}

export interface RuntimeActorContext {
  actorId: string;
  actorName: string;
  faction: string;
  visibleEventIds: string[];
  visibleSignalIds: string[];
  visibleSummaries: string[];
  hiddenCount: number;
  rules: string[];
}

export interface RuntimeConflictHotspot {
  id: string;
  title: string;
  actors: string[];
  intensity: number;
  description: string;
  possibleBreaks: string[];
}

export type RuntimeRelationKind = 'attention' | 'alliance' | 'conflict' | 'betrayal' | 'fatal' | 'influence';

export interface RuntimeActorRelation {
  id: string;
  sourceActorId: string;
  targetActorId: string;
  kind: RuntimeRelationKind;
  intensity: number;
  confidence: number;
  label: string;
  lastEventTitle: string;
  pulse: number;
}

export interface RuntimeReactionChain {
  id: string;
  pulse: number;
  sourceEventId?: string;
  sourceTitle: string;
  readerActorId: string;
  readerActorName: string;
  triggerSummary: string;
  reactionSummary: string;
  targetActorIds: string[];
  visibility: RuntimeVisibility;
  confidence: number;
}

export interface RuntimeDialogueLine {
  actorId: string;
  actorName: string;
  stance: string;
  text: string;
}

export interface RuntimeDialogueExchange {
  id: string;
  pulse: number;
  chainId: string;
  topic: string;
  participants: string[];
  visibility: RuntimeVisibility;
  stakes: string;
  lines: RuntimeDialogueLine[];
  confidence: number;
}

export interface RuntimePressureThread {
  id: string;
  pulse: number;
  title: string;
  actorIds: string[];
  sourceDialogueId?: string;
  sourceChainId?: string;
  tension: number;
  urgency: number;
  unresolvedQuestion: string;
  nextPressure: string;
  confidence: number;
}

export interface RuntimeFocusedThreadContext {
  thread: RuntimePressureThread;
  actors: RuntimeActor[];
  relatedChains: RuntimeReactionChain[];
  relatedDialogues: RuntimeDialogueExchange[];
  relatedEvents: RuntimeWorldEvent[];
  summary: string;
}

export interface RuntimeObservationFlowFrame {
  pulse: number;
  timeLabel: string;
  phase: string;
  summary: string;
  actorIds: string[];
  signals: RuntimeAgentSignal[];
  dialogues: RuntimeDialogueExchange[];
  events: RuntimeWorldEvent[];
  threads: RuntimePressureThread[];
  dominantTension: number;
  confidence: number;
  hasExitOrDeath: boolean;
}

export type RuntimeActorLedgerEntryKind = 'event' | 'signal' | 'dialogue' | 'pressure' | 'status';

export interface RuntimeActorLedgerEntry {
  id: string;
  pulse: number;
  kind: RuntimeActorLedgerEntryKind;
  title: string;
  body: string;
  actorIds: string[];
  confidence: number;
}

export interface RuntimeActorLedger {
  actor: RuntimeActor;
  entries: RuntimeActorLedgerEntry[];
  pressureThreads: RuntimePressureThread[];
  dialogues: RuntimeDialogueExchange[];
  signals: RuntimeAgentSignal[];
  events: RuntimeWorldEvent[];
  knownActorIds: string[];
  riskScore: number;
  influenceScore: number;
  statusSummary: string;
  lastActionSummary: string;
}

export type RuntimeConfrontationSource = 'dialogue' | 'reaction' | 'pressure' | 'event';

export interface RuntimeConfrontationScene {
  id: string;
  pulse: number;
  title: string;
  source: RuntimeConfrontationSource;
  initiatorActorId: string;
  targetActorIds: string[];
  actorIds: string[];
  trigger: string;
  response: string;
  stakes: string;
  tension: number;
  visibility: RuntimeVisibility;
  confidence: number;
}

export interface RuntimePulseSlice {
  pulse: number;
  timeLabel: string;
  phase: string;
  signals: RuntimeAgentSignal[];
  events: RuntimeWorldEvent[];
  actorIds: string[];
  privateSignalCount: number;
  publicEventCount: number;
  hiddenEventCount: number;
  summary: string;
}

export interface RuntimeConvergence {
  shouldPause: boolean;
  pauseType: 'running' | 'stage_convergence' | 'confidence_decay' | 'major_branch' | 'agent_collapse' | 'budget_limit';
  summary: string;
  confidence: number;
  unresolvedConflicts: string[];
  continueOptions: string[];
}

export interface RuntimeWorld {
  id: string;
  worldTitle: string;
  centerEvent: string;
  centralQuestion: string;
  phase: string;
  pulse: number;
  maxPulses: number;
  stability: number;
  conflictLevel: number;
  confidence: number;
  actors: RuntimeActor[];
  signals: RuntimeAgentSignal[];
  stream: RuntimeWorldEvent[];
  conflicts: RuntimeConflictHotspot[];
  convergence: RuntimeConvergence;
  snapshots: RuntimeConvergence[];
}
