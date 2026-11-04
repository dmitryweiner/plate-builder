import { describe, expect, it } from 'vitest';
import { defaultState } from '../geo/state';
import { csgPolicy, WorkerClient, type JobPolicy, type WorkerFactory } from './client';

/** Test jobs: two lanes, one of them with an export that must survive previews. */
type TestJob = { kind: 'outline'; n: number } | { kind: 'mesh'; n: number; export?: boolean; buffer?: ArrayBuffer };

const policy: JobPolicy<TestJob> = {
  lane: (job) => job.kind,
  kept: (job) => job.kind === 'mesh' && job.export === true,
  transfer: (job) => (job.kind === 'mesh' && job.buffer ? [job.buffer] : []),
};

interface Posted {
  jobId: number;
  job: TestJob;
  transfer: Transferable[];
}

/** A worker double: records what is posted, lets the test answer. */
function fakeWorkers() {
  const workers: { posted: Posted[]; terminated: boolean; receive: (data: unknown) => void; broke: (message: string) => void }[] = [];
  const factory: WorkerFactory<TestJob> = (receive, broke) => {
    const worker = { posted: [] as Posted[], terminated: false, receive, broke };
    workers.push(worker);
    return {
      post: (message, transfer) => worker.posted.push({ ...message, transfer }),
      terminate: () => {
        worker.terminated = true;
      },
    };
  };
  const last = () => {
    const worker = workers.at(-1);
    if (!worker) throw new Error('no worker yet');
    return worker;
  };
  /** The job the worker was given last and the reply helpers for it. */
  const current = () => {
    const posted = last().posted.at(-1);
    if (!posted) throw new Error('nothing posted');
    return posted;
  };
  const done = (result: string, ms = 5) => last().receive({ type: 'done', jobId: current().jobId, result, ms });
  return { factory, workers, last, current, done };
}

const outline = (n: number): TestJob => ({ kind: 'outline', n });
const preview = (n: number): TestJob => ({ kind: 'mesh', n });
const exportJob = (n: number): TestJob => ({ kind: 'mesh', n, export: true });

describe('WorkerClient', () => {
  it('creates the worker only for the first job', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    expect(fake.workers).toHaveLength(0);
    const result = client.run(outline(1));
    expect(fake.workers).toHaveLength(1);
    expect(fake.current().job).toEqual(outline(1));
    fake.done('one', 12);
    expect(await result).toEqual({ result: 'one', ms: 12 });
  });

  it('passes progress to the callback of the running job', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    const progress: unknown[] = [];
    const result = client.run(preview(1), (p) => progress.push(p));
    fake.last().receive({ type: 'progress', jobId: fake.current().jobId, step: 1, total: 3, label: 'base' });
    fake.done('mesh');
    await result;
    expect(progress).toEqual([{ step: 1, total: 3, label: 'base' }]);
  });

  it('keeps one waiting job per lane: a fresher one replaces it and the replaced resolves null', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    const first = client.run(preview(1));
    const second = client.run(preview(2));
    const third = client.run(preview(3));
    expect(await second).toBeNull();
    expect(fake.last().posted).toHaveLength(1);
    fake.done('r1');
    expect(await first).toEqual({ result: 'r1', ms: 5 });
    expect(fake.current().job).toEqual(preview(3));
    fake.done('r3');
    expect(await third).toEqual({ result: 'r3', ms: 5 });
  });

  it('never replaces a waiting export with a preview', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    void client.run(preview(1));
    const exported = client.run(exportJob(2));
    const later = client.run(preview(3));
    expect(await later).toBeNull();
    fake.done('r1');
    expect(fake.current().job).toEqual(exportJob(2));
    fake.done('stl');
    expect(await exported).toEqual({ result: 'stl', ms: 5 });
  });

  it('lets a preview wait behind a running export', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    const exported = client.run(exportJob(1));
    const next = client.run(preview(2));
    fake.done('stl');
    expect(await exported).toEqual({ result: 'stl', ms: 5 });
    expect(fake.current().job).toEqual(preview(2));
    fake.done('mesh');
    expect(await next).toEqual({ result: 'mesh', ms: 5 });
  });

  it('keeps waiting jobs of different lanes in the order they first came', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    void client.run(preview(1));
    void client.run(preview(2));
    void client.run(outline(3));
    void client.run(preview(4));
    fake.done('r1');
    expect(fake.current().job).toEqual(preview(4));
    fake.done('r4');
    expect(fake.current().job).toEqual(outline(3));
  });

  it('rejects a failed job and goes on with the next', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    const failed = client.run(preview(1));
    const next = client.run(outline(2));
    fake.last().receive({ type: 'error', jobId: fake.current().jobId, message: 'not manifold' });
    await expect(failed).rejects.toThrow('not manifold');
    fake.done('ok');
    expect(await next).toEqual({ result: 'ok', ms: 5 });
  });

  it('ignores replies to jobs nobody waits for and foreign messages', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    const result = client.run(outline(1));
    fake.last().receive({ type: 'done', jobId: 999, result: 'stale', ms: 1 });
    fake.last().receive('hello');
    fake.last().receive({ jobId: fake.current().jobId, type: 'other' });
    fake.done('fresh');
    expect(await result).toEqual({ result: 'fresh', ms: 5 });
  });

  it('fails every pending job when the worker breaks and starts a fresh one next time', async () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    const running = client.run(preview(1));
    const waiting = client.run(outline(2));
    fake.last().broke('WASM crashed');
    await expect(running).rejects.toThrow('WASM crashed');
    await expect(waiting).rejects.toThrow('WASM crashed');
    expect(fake.workers[0]?.terminated).toBe(true);
    const again = client.run(outline(3));
    expect(fake.workers).toHaveLength(2);
    fake.done('back');
    expect(await again).toEqual({ result: 'back', ms: 5 });
  });

  it('transfers the buffers the policy names', () => {
    const fake = fakeWorkers();
    const client = new WorkerClient<TestJob, string>(fake.factory, policy);
    const buffer = new ArrayBuffer(8);
    void client.run({ kind: 'mesh', n: 1, buffer });
    expect(fake.current().transfer).toEqual([buffer]);
  });
});

describe('csgPolicy', () => {
  it('keeps an export and gives each job kind its lane', () => {
    const state = defaultState();
    expect(csgPolicy.kept({ kind: 'mesh', quality: 'export', state })).toBe(true);
    expect(csgPolicy.kept({ kind: 'mesh', quality: 'preview', state })).toBe(false);
    expect(csgPolicy.lane({ kind: 'outline', state })).not.toBe(csgPolicy.lane({ kind: 'mesh', quality: 'preview', state }));
  });
});
