import type { RuntimeWorld, SimulationWorld } from '../domain/types';

export interface WorldArchiveSummary {
  id: string;
  title: string;
  centerEvent: string;
  phase: string;
  pulse: number;
  confidence: number;
  updatedAt: string;
}

export interface WorldArchiveRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  world: SimulationWorld;
  runtimeWorld: RuntimeWorld;
  source?: 'llm' | 'local';
  message?: string;
}

interface ArchiveListResponse {
  ok?: boolean;
  records?: WorldArchiveSummary[];
}

interface ArchiveSaveResponse {
  ok?: boolean;
  summary?: WorldArchiveSummary;
}

interface ArchiveLoadResponse {
  ok?: boolean;
  archive?: WorldArchiveRecord;
}

interface ArchiveDeleteResponse {
  ok?: boolean;
}

export async function listWorldArchives(): Promise<WorldArchiveSummary[]> {
  try {
    const response = await fetch('/api/world-archives');
    const payload = (await response.json()) as ArchiveListResponse;
    return Array.isArray(payload.records) ? payload.records : [];
  } catch {
    return [];
  }
}

export async function saveWorldArchive(record: {
  id: string;
  world: SimulationWorld;
  runtimeWorld: RuntimeWorld;
  source?: 'llm' | 'local';
  message?: string;
}): Promise<WorldArchiveSummary | null> {
  try {
    const response = await fetch('/api/world-archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    });
    const payload = (await response.json()) as ArchiveSaveResponse;
    return payload.summary ?? null;
  } catch {
    return null;
  }
}

export async function loadWorldArchive(id: string): Promise<WorldArchiveRecord | null> {
  try {
    const response = await fetch(`/api/world-archive?id=${encodeURIComponent(id)}`);
    const payload = (await response.json()) as ArchiveLoadResponse;
    return payload.archive ?? null;
  } catch {
    return null;
  }
}

export async function deleteWorldArchive(id: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/world-archive?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const payload = (await response.json()) as ArchiveDeleteResponse;
    return Boolean(payload.ok);
  } catch {
    return false;
  }
}
