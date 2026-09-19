import { ready, needsAnalysis, type DocumentSet, type Question } from './model';
import { estimatedTokens, planBatches, type SolverProfile } from './batching';

export class BatchError extends Error {
  constructor(
    message: string,
    public code: string,
    public retryAfter = 60,
  ) {
    super(message);
  }
}
type QueueIO = {
  solve: (
    questions: Question[],
    generate: boolean,
    provider: SolverProfile['id'],
    strong?: boolean,
  ) => Promise<Question[]>;
  save: (doc: DocumentSet) => Promise<unknown>;
  update: (doc: DocumentSet) => void;
  shouldStop: () => boolean;
  priority?: () => string[];
  optionsOnly?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export async function runSolverQueue(
  doc: DocumentSet,
  profiles: SolverProfile[],
  generate: boolean,
  io: QueueIO,
) {
  const now = io.now || Date.now;
  const sleep = io.sleep || ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (!profiles.length) throw new Error('Niciun serviciu AI configurat.');
  const resume = Boolean(doc.processing?.queue.length);
  generate = resume ? doc.processing!.generateOptions : generate;
  let current: DocumentSet = {
    ...doc,
    status: 'processing',
    error: undefined,
    questions: doc.questions.map((q) =>
      resume || !q.solveError ? q : { ...q, solveError: undefined },
    ),
  };
  const attempted = (q: Question) => q.solved || !needsAnalysis(q) || Boolean(q.solveError);
  const initial = current.questions.filter(attempted).length;
  const optionsOnly = resume ? doc.processing?.optionsOnly : io.optionsOnly;
  const needsWork = (q: Question) =>
    optionsOnly
      ? !q.options.length && q.language !== 'foreign'
      : needsAnalysis(q) ||
        (generate && !q.options.length && q.language !== 'foreign') ||
        (q.solved && !ready(q) && !q.strengthened && !q.reviewed && q.language !== 'foreign');
  const metrics = structuredClone(
    doc.processing?.metrics || {
      requests: 0,
      sent: 0,
      retries: 0,
      rateLimits: 0,
      waitMs: 0,
      latencyMs: 0,
      successful: 0,
      recent: [],
    },
  );
  let lastSuccess = now();
  let lastPriority = '';
  let concurrency = Math.max(1, Math.min(3, profiles[0].concurrency || 1));
  let lastProvider = doc.processing?.provider || profiles[0].id;
  const started = now(),
    previousTime = resume ? doc.processing!.elapsedMs : 0;
  const queue = resume
    ? structuredClone(doc.processing!.queue).map((job) => ({
        ...job,
        provider: job.provider < profiles.length ? job.provider : 0,
        tries: 0,
      }))
    : planBatches(current.questions.filter(needsWork), profiles[0], generate).map((batch) => ({
        ids: batch.map((q) => q.id),
        provider: 0,
        tries: 0,
      }));
  const disabled = new Set<number>();
  const cooldown = profiles.map(() => doc.retryAt || 0);
  let totalRateRetries = 0;
  const snapshot = () => ({
    ...current,
    processing: {
      queue: structuredClone(queue),
      elapsedMs: previousTime + now() - started,
      finished: current.questions.filter(attempted).length,
      workDone:
        (resume ? doc.processing?.workDone || 0 : 0) +
        current.questions.filter(attempted).length -
        initial,
      failed: current.questions.filter((q) => q.solveError).length,
      batchSize: queue[0]?.ids.length || 0,
      provider: queue.length ? profiles[queue[0].provider]?.id || lastProvider : lastProvider,
      generateOptions: generate,
      optionsOnly,
      metrics,
    },
  });
  const publish = async () => {
    current = snapshot();
    await io.save(current);
    io.update(current);
  };
  const wait = async (until: number, label: string) => {
    const waitStarted = now();
    current.retryAt = until;
    await publish();
    while (now() < until && !io.shouldStop()) {
      io.update({
        ...snapshot(),
        error: `${label} în ${Math.ceil((until - now()) / 1000)} secunde. Progresul este salvat.`,
      });
      await sleep(Math.min(250, Math.max(1, until - now())));
    }
    metrics.waitMs += now() - waitStarted;
    if (io.shouldStop()) return false;
    current.retryAt = undefined;
    current.error = undefined;
    return true;
  };
  const pause = async (message: string) => {
    current.status = 'partial';
    current.error = message;
    await publish();
    return current;
  };
  await publish();
  while (queue.length && !io.shouldStop()) {
    const priority = io.priority?.() || [];
    const signature = priority.join(',');
    if (signature !== lastPriority) {
      lastPriority = signature;
      const rank = new Map(priority.map((id, i) => [id, i]));
      const items = queue.flatMap((job) =>
        job.ids.map((id) => ({ id, provider: job.provider, tries: job.tries })),
      );
      items.sort((a, b) => (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity));
      queue.length = 0;
      for (const item of items) {
        const last = queue.at(-1);
        if (
          last &&
          last.provider === item.provider &&
          last.tries === item.tries &&
          last.ids.length < 40
        )
          last.ids.push(item.id);
        else queue.push({ ids: [item.id], provider: item.provider, tries: item.tries });
      }
    }
    const job = queue[0];
    job.ids = job.ids.filter((id) => current.questions.some((q) => q.id === id && needsWork(q)));
    if (!job.ids.length) {
      queue.shift();
      continue;
    }
    while (disabled.has(job.provider)) job.provider++;
    if (job.provider >= profiles.length) {
      if (disabled.size === profiles.length)
        return pause(
          'Toți furnizorii configurați sunt indisponibili sau au cota epuizată. Întrebările rămase sunt salvate; continuă după remedierea cotei/configurării.',
        );
      if (job.ids.length > 1) {
        const middle = Math.ceil(job.ids.length / 2);
        queue.splice(
          0,
          1,
          ...[job.ids.slice(0, middle), job.ids.slice(middle)].map((ids) => ({
            ids,
            provider: 0,
            tries: 0,
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
        queue.shift();
      }
      await publish();
      continue;
    }
    const profile = profiles[job.provider];
    lastProvider = profile.id;
    if (current.questions.filter(ready).length < 20 && job.ids.length > 20) {
      const tail = job.ids.slice(20);
      if (queue.slice(1).every((j) => j.provider === job.provider && j.tries === job.tries)) {
        tail.push(...queue.slice(1).flatMap((j) => j.ids));
        queue.splice(
          1,
          queue.length - 1,
          ...planBatches(
            tail.map((id) => current.questions.find((q) => q.id === id)!),
            profile,
            generate,
          ).map((batch) => ({ ...job, ids: batch.map((q) => q.id) })),
        );
      } else queue.splice(1, 0, { ...job, ids: tail });
      job.ids = job.ids.slice(0, 20);
    }
    const questions = job.ids.map((id) => current.questions.find((q) => q.id === id)!);
    const smaller = planBatches(questions, profile, generate);
    if (smaller.length > 1) {
      queue.splice(0, 1, ...smaller.map((batch) => ({ ...job, ids: batch.map((q) => q.id) })));
      continue;
    }
    if (
      cooldown[job.provider] > now() &&
      !(await wait(cooldown[job.provider], 'Următorul lot / reîncercare automată'))
    )
      break;
    if ((io.priority?.() || []).join(',') !== lastPriority) continue;
    current.error = undefined;
    await publish();
    const timer = io.now ? undefined : setInterval(() => io.update(snapshot()), 1000);
    try {
      cooldown[job.provider] = now() + profile.intervalMs;
      // Parallel groups share ONE token budget; extra prompt overhead is included.
      const count =
        current.questions.filter(ready).length < 20
          ? 1
          : Math.min(concurrency, profile.concurrency || 1, questions.length);
      const cost =
        questions.reduce((sum, q) => sum + estimatedTokens(q, generate), 0) + 1400 * count;
      const groups: Question[][] = [];
      const width = Math.ceil(questions.length / (cost <= profile.tokenBudget ? count : 1));
      for (let i = 0; i < questions.length; i += width) groups.push(questions.slice(i, i + width));
      let merge = Promise.resolve();
      const outcomes = await Promise.allSettled(
        groups.map(async (group) => {
          const requestStarted = now();
          metrics.requests++;
          metrics.sent += group.length;
          const strong = group.every((q) => q.solved && !q.strengthened && !ready(q));
          const solved = await io.solve(group, generate, profile.id, strong);
          metrics.latencyMs += now() - requestStarted;
          const byId = new Map(solved.map((q) => [q.id, q]));
          if (
            byId.size !== solved.length ||
            solved.some((q) => !group.some((original) => original.id === q.id))
          )
            throw new BatchError('Identificatori invalizi.', 'AI_INVALID');
          merge = merge.then(async () => {
            current.questions = current.questions.map((q) => {
              const answer = byId.get(q.id);
              if (!answer) return q;
              if (q.solved && !strong && !(generate && !q.options.length))
                return {
                  ...q,
                  language: answer.language,
                  languageConfidence: answer.languageConfidence,
                  solveError: undefined,
                };
              return {
                ...answer,
                strengthened: strong || answer.strengthened,
                solveError: undefined,
              };
            });
            job.ids = job.ids.filter((id) => !byId.has(id));
            if (solved.length) {
              metrics.successful += solved.length;
              metrics.recent.push({ ms: now() - lastSuccess, count: solved.length });
              metrics.recent = metrics.recent.slice(-5);
              lastSuccess = now();
              if (
                metrics.first20Ms === undefined &&
                current.questions.filter(ready).length >= Math.min(20, current.questions.length)
              )
                metrics.first20Ms = previousTime + now() - started;
              // One stronger pass only, queued after upcoming unprepared questions.
              const low = current.questions.filter(
                (q) =>
                  byId.has(q.id) &&
                  q.solved &&
                  !ready(q) &&
                  !q.strengthened &&
                  q.language !== 'foreign',
              );
              if (low.length)
                queue.push({ ids: low.map((q) => q.id), provider: job.provider, tries: 0 });
              await publish();
            }
          });
          await merge;
          if (solved.length < group.length)
            throw new BatchError('Se reîncearcă doar răspunsurile lipsă.', 'AI_INVALID');
        }),
      );
      const failed = outcomes.find((r) => r.status === 'rejected');
      if (failed?.status === 'rejected') throw failed.reason;
      queue.shift();
      totalRateRetries = 0;
      await publish();
    } catch (error) {
      const code = error instanceof BatchError ? error.code : 'PROVIDER_ERROR';
      current.error = error instanceof Error ? error.message : 'Lot eșuat.';
      metrics.retries++;
      if (!job.ids.length) {
        queue.shift();
        continue;
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
        ].includes(code)
      ) {
        disabled.add(job.provider);
        job.provider++;
        job.tries = 0;
      } else if (code === 'RATE_LIMIT') {
        concurrency = 1;
        metrics.rateLimits++;
        totalRateRetries++;
        const seconds = error instanceof BatchError ? error.retryAfter : 60;
        cooldown[job.provider] = now() + Math.max(2, seconds) * 1000;
        const alternative = profiles.findIndex(
          (_, i) => i !== job.provider && !disabled.has(i) && cooldown[i] <= now(),
        );
        if (totalRateRetries > 3 * profiles.length) {
          current.retryAt = Math.min(...cooldown.filter((_, i) => !disabled.has(i)));
          return pause(
            'Limitele tuturor furnizorilor persistă. Progresul este salvat; continuă după resetarea cotei.',
          );
        } else if (alternative >= 0) {
          job.provider = alternative;
          job.tries = 0;
        } else if (seconds > 120) {
          current.retryAt = cooldown[job.provider];
          return pause(
            'Limitele tuturor furnizorilor persistă. Progresul și lotul curent sunt salvate; continuă după resetarea cotei.',
          );
        } else if (
          !(await wait(cooldown[job.provider], 'Limită temporară AI. Reîncercare automată'))
        )
          break;
      } else if (++job.tries < 2 && code !== 'TOO_LARGE') {
        if (!(await wait(now() + 1000, 'Reîncercare lot'))) break;
      } else {
        job.provider++;
        job.tries = 0;
      }
      await publish();
    } finally {
      if (timer) clearInterval(timer);
    }
  }
  current.status = current.questions.some(needsAnalysis) ? 'partial' : 'ready';
  current.error = queue.length
    ? 'Procesare oprită. Poți continua de unde ai rămas.'
    : current.questions.some((q) => q.solveError)
      ? 'Toate întrebările au fost încercate. Unele necesită verificare manuală; celelalte sunt salvate.'
      : undefined;
  if (!queue.length) current.retryAt = undefined;
  await publish();
  return current;
}
