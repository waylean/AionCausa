import { afterEach, describe, expect, it, vi } from 'vitest';
import { deleteWorldArchive, listWorldArchives, loadWorldArchive, saveWorldArchive } from './archives';
import { createDraftWorld } from '../domain/simulator';
import { createRuntimeWorld } from '../domain/worldRuntime';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('world archive service', () => {
  it('lists archive summaries from the local API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        records: [{ id: 'world-1', title: 'AionCausa', centerEvent: 'event', phase: '观察', pulse: 2, confidence: 0.7 }],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listWorldArchives()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/world-archives');
  });

  it('saves a world snapshot without provider credentials', async () => {
    const world = createDraftWorld('如果商鞅没有被杀，秦国会如何发展？', 'strategic');
    const runtimeWorld = createRuntimeWorld(world);
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        ok: true,
        summary: { id: 'world-1', title: world.title, centerEvent: world.eventText, phase: runtimeWorld.phase, pulse: 0, confidence: 0.7 },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await saveWorldArchive({ id: 'world-1', world, runtimeWorld, source: 'local', message: 'saved' });
    const [, request] = fetchMock.mock.calls[0] as [string, { body: string }];
    const body = JSON.parse(request.body);
    expect(body.provider).toBeUndefined();
    expect(body.world.eventText).toBe(world.eventText);
  });

  it('loads a saved archive by id', async () => {
    const world = createDraftWorld('玄武门之变没有发生会怎样？', 'strategic');
    const runtimeWorld = createRuntimeWorld(world);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: async () => ({ ok: true, archive: { id: 'world-2', createdAt: 'now', updatedAt: 'now', world, runtimeWorld } }),
      }),
    );

    const archive = await loadWorldArchive('world-2');
    expect(archive?.id).toBe('world-2');
    expect(archive?.runtimeWorld.centerEvent).toBe(world.eventText);
  });

  it('deletes a saved archive by id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(deleteWorldArchive('world-3')).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('/api/world-archive?id=world-3', { method: 'DELETE' });
  });
});
