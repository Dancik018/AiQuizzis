import {
  ready,
  needsAnalysis,
  type DocumentSet,
  type Question,
  type SolvedQuestions,
  type ProcessingMetrics,
} from './model';
import { planBatches, type SolverProfile } from './batching';

export class BatchError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryAfter = 60,
  ) {
    super(message);
  }
}
type Job = NonNullable<DocumentSet['processing']>['queue'][number];
type QueueIO = {
  solve: (
    questions: Question[],
    generate: boolean,
    provider: SolverProfile['id'],
    strong?: boolean,
  ) => Promise<SolvedQuestions>;
  save: (doc: DocumentSet) => Promise<unknown>;
  update: (doc: DocumentSet) => void;
  shouldStop: () => boolean;
  priority?: () => string[];
  optionsOnly?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// A rolling worker pool. Each successful result commits before its worker releases a slot.
// Queue snapshots include in-flight IDs so closing/reloading never loses pending work.
export async function runSolverQueue(
  doc: DocumentSet,
  profiles: SolverProfile[],
  generate: boolean,
  io: QueueIO,
) {
  if (!profiles.length) throw new Error('Niciun serviciu AI configurat.');
  // Retain the saved queue shape for old documents; there is only one OpenAI profile.
  profiles = profiles.slice(0, 1);
  const now = io.now || Date.now;
  const sleep =
    io.sleep || ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const resume = Boolean(doc.processing?.queue.length);
  generate = resume ? doc.processing!.generateOptions : generate;
  const optionsOnly = resume ? doc.processing?.optionsOnly : io.optionsOnly;
  const needsWork = (q: Question) =>
    optionsOnly
      ? (!q.options.length || q.status === 'verifying') && q.language !== 'foreign'
      : needsAnalysis(q) ||
        (generate && !q.options.length && q.language !== 'foreign') ||
        (q.solved && !ready(q) && !q.strengthened && !q.reviewed && q.language !== 'foreign');
  let current: DocumentSet = {
    ...doc,
    status: 'processing',
    error: undefined,
    questions: doc.questions.map((q) =>
      resume || !q.solveError
        ? q
        : {
            ...q,
            solveError: undefined,
            passes: undefined,
            solved: false,
            strengthened: false,
            status: 'parsing',
          },
    ),
  };
  const attempted = (q: Question) => q.solved || !needsAnalysis(q) || Boolean(q.solveError);
  const initial = current.questions.filter(attempted).length;
  const minReady = profiles[0].minReady || 20;
  const started = now();
  const previousTime = resume ? doc.processing!.elapsedMs : 0;
  const metrics: ProcessingMetrics = structuredClone(
    doc.processing?.metrics || {
      requests: 0,
      sent: 0,
      retries: 0,
      rateLimits: 0,
      waitMs: 0,
      latencyMs: 0,
      successful: 0,
      recent: [],
      usage: [],
    },
  );
  let jobs: Job[] = resume
    ? structuredClone(doc.processing!.queue).map((j) => ({
        ...j,
        provider: j.provider < profiles.length ? j.provider : 0,
        tries: 0,
      }))
    : [];
  if (!resume) {
    const pending = current.questions.filter(needsWork);
    const first = pending.splice(0, Math.max(0, minReady - current.questions.filter(ready).length));
    jobs = [
      ...planBatches(first, profiles[0], generate),
      ...planBatches(pending, profiles[0], generate),
    ].map((batch) => ({ ids: batch.map((q) => q.id), provider: 0, tries: 0 }));
  }
  const active = new Map<Job, Promise<void>>();
  const disabled = new Set<number>();
  const nextStart = profiles.map(() => doc.retryAt || 0);
  const limits = profiles.map((p) => Math.max(1, Math.min(10, p.concurrency || 1)));
  const rates = profiles.map(() => 0);
  let lastProvider = doc.processing?.provider || profiles[0].id;
  let lastSuccess = now(),
    lastPriority = '',
    stoppedForQuota = false;
  let fatal: unknown;
  let writes = Promise.resolve();
  const atomic = (action: () => Promise<void>) => {
    const task = writes.then(action);
    writes = task.catch((error) => {
      fatal = error;
    });
    return task;
  };
  const snapshot = (): DocumentSet => ({
    ...current,
    processing: {
      queue: jobs.map((j) => ({ ...j, ids: [...j.ids] })),
      elapsedMs: previousTime + now() - started,
      finished: current.questions.filter(attempted).length,
      workDone:
        (resume ? doc.processing?.workDone || 0 : 0) +
        current.questions.filter(attempted).length -
        initial,
      failed: current.questions.filter((q) => q.solveError).length,
      batchSize:
        Array.from(active.keys()).reduce((n, j) => n + j.ids.length, 0) || jobs[0]?.ids.length || 0,
      provider: lastProvider,
      generateOptions: generate,
      optionsOnly,
      metrics: structuredClone(metrics),
    },
  });
  const publish = async () => {
    current = snapshot();
    await io.save(current);
    io.update(current);
  };
  const remove = (job: Job) => {
    jobs = jobs.filter((j) => j !== job);
  };
  const order = () => {
    const priority = io.priority?.() || [];
    const signature = priority.join(',');
    if (signature === lastPriority) return;
    lastPriority = signature;
    const rank = new Map(priority.map((id, i) => [id, i]));
    const idle = jobs
      .filter((j) => !active.has(j))
      .flatMap((j) => j.ids.map((id) => ({ ...j, ids: [id] })));
    idle.sort((a, b) => (rank.get(a.ids[0]) ?? Infinity) - (rank.get(b.ids[0]) ?? Infinity));
    const regrouped: Job[] = [];
    for (const item of idle) {
      const last = regrouped.at(-1);
      if (
        last &&
        last.provider === item.provider &&
        last.tries === item.tries &&
        last.readyAt === item.readyAt &&
        last.cap === item.cap &&
        last.ids.length <
          Math.min(
            item.cap || 100,
            profiles[item.provider]?.maxQuestions || 40,
            generate &&
              [...last.ids, ...item.ids].some(
                (id) => !current.questions.find((q) => q.id === id)?.options.length,
              )
              ? profiles[item.provider]?.generationBatchSize || 16
              : 100,
          )
      )
        last.ids.push(...item.ids);
      else regrouped.push(item);
    }
    jobs = [...jobs.filter((j) => active.has(j)), ...regrouped];
  };
  const recover = (job: Job, error: unknown) => {
    const code = error instanceof BatchError ? error.code : 'PROVIDER_ERROR';
    metrics.retries++;
    current.error = error instanceof Error ? error.message : 'Lot eșuat.';
    if (job.ids.length === 1 && ['INVALID_INPUT', 'TOO_LARGE'].includes(code)) {
      current.questions = current.questions.map((q) =>
        q.id === job.ids[0]
          ? { ...q, solved: true, strengthened: true, status: 'failed', solveError: current.error }
          : q,
      );
      remove(job);
      return;
    }
    if (
      ['TOO_LARGE', 'AI_TIMEOUT', 'AI_INCOMPLETE', 'INVALID_INPUT', 'AI_INVALID'].includes(code) &&
      job.ids.length > 1
    ) {
      const half = Math.ceil(job.ids.length / 2);
      const index = jobs.indexOf(job);
      jobs.splice(
        index,
        1,
        ...[job.ids.slice(0, half), job.ids.slice(half)].map((ids) => ({
          ids,
          provider: 0,
          tries: 0,
          cap: half,
        })),
      );
      return;
    }
    if (
      [
        'AI_QUOTA',
        'AI_AUTH',
        'AI_ACCESS',
        'AI_MISSING',
        'AI_MODEL',
        'AI_CONFIG',
        'AI_KEY_FORMAT',
        'CLIENT_OUTDATED',
      ].includes(code)
    ) {
      disabled.add(job.provider);
      job.provider++;
      job.tries = 0;
    } else if (code === 'RATE_LIMIT') {
      metrics.rateLimits++;
      limits[job.provider] = Math.max(1, Math.floor(limits[job.provider] / 2));
      const seconds = error instanceof BatchError ? error.retryAfter : 60;
      nextStart[job.provider] = now() + Math.max(2, seconds) * 1000;
      current.retryAt = nextStart[job.provider];
      if (++rates[job.provider] > 3 || seconds > 120) disabled.add(job.provider);
      job.tries = 0;
    } else if (++job.tries < 4 && code !== 'TOO_LARGE') {
      job.readyAt = now() + 1000 * 2 ** (job.tries - 1);
    } else {
      job.provider++;
      job.tries = 0;
      job.readyAt = undefined;
    }
  };
  const execute = async (job: Job) => {
    const profile = profiles[job.provider];
    const questions = job.ids.map((id) => current.questions.find((q) => q.id === id)!);
    const strong =
      job.tries > 0 ||
      questions.some((q) => q.status === 'verifying' || (q.solved && !ready(q) && !q.strengthened));
    const requestStarted = now();
    metrics.requests++;
    metrics.sent += questions.length;
    lastProvider = profile.id;
    try {
      const solved = await io.solve(questions, generate, profile.id, strong);
      metrics.cacheHits = (metrics.cacheHits || 0) + (solved.cacheHits || 0);
      metrics.sent -= solved.cacheHits || 0;
      if (solved.cacheHits === questions.length) metrics.requests--;
      else metrics.latencyMs += now() - requestStarted;
      const byId = new Map(solved.map((q) => [q.id, q]));
      if (byId.size !== solved.length || solved.some((q) => !job.ids.includes(q.id)))
        throw new BatchError('Identificatori invalizi.', 'AI_INVALID');
      await atomic(async () => {
        current.questions = current.questions.map((q) => {
          const answer = byId.get(q.id);
          if (!answer) return q;
          return {
            ...answer,
            strengthened: answer.status
              ? answer.status !== 'verifying'
              : strong || answer.strengthened,
          };
        });
        job.ids = job.ids.filter((id) => !byId.has(id));
        if (solved.usage) metrics.usage = [...(metrics.usage || []), solved.usage];
        if (solved.length) {
          current.error = undefined;
          metrics.successful += solved.length;
          const newlyReady = solved.filter(ready).length;
          if (newlyReady) {
            metrics.recent = [
              ...metrics.recent,
              { ms: now() - lastSuccess, count: newlyReady },
            ].slice(-5);
            lastSuccess = now();
          }
          rates[job.provider] = 0;
          if (
            metrics.first20Ms === undefined &&
            current.questions.filter(ready).length >= Math.min(minReady, current.questions.length)
          )
            metrics.first20Ms = previousTime + now() - started;
          const low = current.questions.filter(
            (q) =>
              byId.has(q.id) &&
              q.solved &&
              !ready(q) &&
              !q.strengthened &&
              !q.reviewed &&
              q.language !== 'foreign',
          );
          if (low.length)
            jobs.unshift({ ids: low.map((q) => q.id), provider: job.provider, tries: 0 });
        }
        if (!job.ids.length) remove(job);
        else recover(job, new BatchError('Se reîncearcă doar răspunsurile lipsă.', 'AI_INVALID'));
        current.retryAt = undefined;
        await publish();
      });
    } catch (error) {
      if (fatal) return;
      await atomic(async () => {
        recover(job, error);
        await publish();
      });
    }
  };
  await publish();
  const timer = io.now ? undefined : setInterval(() => io.update(snapshot()), 1000);
  try {
    while (jobs.length && !fatal) {
      if (!io.shouldStop()) {
        order();
        for (const job of [...jobs]) {
          if (active.has(job)) continue;
          job.ids = job.ids.filter((id) =>
            current.questions.some((q) => q.id === id && needsWork(q)),
          );
          if (!job.ids.length) {
            remove(job);
            continue;
          }
          while (disabled.has(job.provider)) job.provider++;
          if (job.provider >= profiles.length) {
            if (disabled.size === profiles.length) {
              stoppedForQuota = true;
              continue;
            }
            if (job.ids.length > 1) {
              const half = Math.ceil(job.ids.length / 2);
              const index = jobs.indexOf(job);
              jobs.splice(
                index,
                1,
                ...[job.ids.slice(0, half), job.ids.slice(half)].map((ids) => ({
                  ids,
                  provider: 0,
                  tries: 0,
                  cap: half,
                })),
              );
            } else {
              current.questions = current.questions.map((q) =>
                q.id === job.ids[0]
                  ? {
                      ...q,
                      solveError:
                        'AI nu a putut rezolva această întrebare după reîncercări. Verifică manual.',
                    }
                  : q,
              );
              remove(job);
            }
            await atomic(publish);
            continue;
          }
          const profile = profiles[job.provider];
          const providerActive = [...active.keys()].filter(
            (j) => j.provider === job.provider,
          ).length;
          const warming =
            current.questions.filter(ready).length < Math.min(minReady, current.questions.length);
          if (
            providerActive >= limits[job.provider] ||
            (warming && active.size >= (generate ? Math.min(2, limits[job.provider]) : 1)) ||
            nextStart[job.provider] > now() ||
            (job.readyAt || 0) > now()
          )
            continue;
          const qs = job.ids.map((id) => current.questions.find((q) => q.id === id)!);
          const batches = planBatches(
            qs,
            {
              ...profile,
              maxQuestions: Math.min(
                profile.maxQuestions,
                job.cap || 100,
                warming ? minReady : 100,
              ),
            },
            generate,
          );
          if (batches.length > 1) {
            const index = jobs.indexOf(job);
            jobs.splice(
              index,
              1,
              ...batches.map((batch) => ({ ...job, ids: batch.map((q) => q.id) })),
            );
            continue;
          }
          nextStart[job.provider] = now() + profile.intervalMs;
          const promise = execute(job)
            .catch((e) => {
              fatal = e;
            })
            .finally(() => active.delete(job));
          active.set(job, promise);
        }
      }
      if (active.size) {
        await Promise.race(active.values());
        continue;
      }
      if (io.shouldStop() || stoppedForQuota || !jobs.length) break;
      // No worker is running: persist the earliest actual retry/quota deadline.
      const until = Math.min(
        ...jobs.map((j) => Math.max(j.readyAt || 0, nextStart[j.provider] || 0)),
      );
      if (until > now()) {
        current.retryAt = until;
        await atomic(publish);
        const begin = now();
        while (now() < until && !io.shouldStop()) {
          io.update({
            ...snapshot(),
            error: `Următorul lot · Reîncercare automată în ${Math.ceil((until - now()) / 1000)} secunde. Progresul este salvat.`,
          });
          await sleep(Math.min(250, until - now()));
          if ((io.priority?.() || []).join(',') !== lastPriority) break;
        }
        metrics.waitMs += now() - begin;
      }
    }
    await Promise.all(active.values());
    await writes;
    if (fatal) throw fatal;
    current.status = jobs.length || current.questions.some(needsAnalysis) ? 'partial' : 'ready';
    current.error = stoppedForQuota
      ? `${current.error || 'OpenAI este indisponibil sau are cota epuizată.'} Progresul și loturile rămase sunt salvate.`
      : jobs.length
        ? 'Procesare oprită. Poți continua de unde ai rămas.'
        : current.questions.some((q) => q.solveError)
          ? 'Toate întrebările au fost încercate. Unele necesită verificare manuală.'
          : undefined;
    if (!jobs.length) current.retryAt = undefined;
    await publish();
    return current;
  } finally {
    if (timer) clearInterval(timer);
  }
}
