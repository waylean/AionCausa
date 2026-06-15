import type { Edge, Node } from 'reactflow';
import type { GraphNodeData, SimulationWorld } from './types';

export function buildGraph(world: SimulationWorld): {
  nodes: Node<GraphNodeData>[];
  edges: Edge[];
} {
  const nodes: Node<GraphNodeData>[] = [
    {
      id: 'event',
      type: 'default',
      position: { x: 0, y: 170 },
      data: {
        label: '中心事件',
        detail: world.eventText,
        kind: 'event',
        confidence: world.confidence,
      },
      className: 'graph-node graph-node-event',
    },
  ];

  world.evidence.forEach((evidence, index) => {
    nodes.push({
      id: evidence.id,
      position: { x: -360, y: 40 + index * 105 },
      data: {
        label: evidence.claim,
        detail: evidence.source,
        kind: 'evidence',
        confidence: evidence.confidence,
      },
      className: 'graph-node graph-node-evidence',
    });
  });

  world.agents.forEach((agent, index) => {
    nodes.push({
      id: agent.id,
      position: { x: 330, y: 10 + index * 120 },
      data: {
        label: agent.name,
        detail: agent.role,
        kind: 'agent',
        confidence: agent.confidence,
      },
      className: 'graph-node graph-node-agent',
    });
  });

  world.branches.forEach((branch, index) => {
    nodes.push({
      id: branch.id,
      position: { x: 30 + index * 260, y: 560 },
      data: {
        label: branch.title,
        detail: branch.summary,
        kind: 'branch',
        confidence: branch.credibility,
      },
      className: `graph-node graph-node-branch graph-node-${branch.tone}`,
    });
  });

  if (!world.branches.length) {
    nodes.push({
      id: 'awaiting-generation',
      position: { x: 320, y: 170 },
      data: {
        label: '等待生成',
        detail: '点击生成沙盘后，系统会分阶段生成具体人物与事件线。',
        kind: 'outcome',
        confidence: 0,
      },
      className: 'graph-node graph-node-branch',
    });
  }

  world.premises.slice(1).forEach((premise, index) => {
    nodes.push({
      id: premise.id,
      position: { x: -140 + index * 230, y: -120 },
      data: {
        label: premise.label,
        detail: `plausibility ${Math.round(premise.plausibility * 100)}%`,
        kind: 'premise',
        confidence: premise.plausibility,
      },
      className: 'graph-node graph-node-premise',
    });
  });

  const edges: Edge[] = [
    ...world.evidence.map((evidence) => ({
      id: `edge-${evidence.id}`,
      source: evidence.id,
      target: 'event',
      animated: true,
      className: 'graph-edge',
    })),
    ...world.agents.map((agent) => ({
      id: `edge-${agent.id}`,
      source: 'event',
      target: agent.id,
      className: 'graph-edge',
    })),
    ...world.branches.map((branch) => ({
      id: `edge-${branch.id}`,
      source: 'event',
      target: branch.id,
      animated: branch.tone !== 'stable',
      className: 'graph-edge',
    })),
    ...world.premises.slice(1).map((premise) => ({
      id: `edge-${premise.id}`,
      source: premise.parentId === 'premise-root' ? 'event' : premise.parentId || 'event',
      target: premise.id,
      className: 'graph-edge graph-edge-premise',
    })),
  ];

  if (!world.branches.length) {
    edges.push({
      id: 'edge-awaiting-generation',
      source: 'event',
      target: 'awaiting-generation',
      className: 'graph-edge',
    });
  }

  return { nodes, edges };
}
