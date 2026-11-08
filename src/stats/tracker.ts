import { DAY_MS, WEEK_MS, dayStart, nightOverlap, weekStart } from '../time.js';
import type { Counters, StatsStore } from './store.js';

/** Голосовое состояние участника в удобном для трекера виде. */
export interface VoiceSnapshot {
  guildId: string;
  userId: string;
  /** null — вышел из голосовых каналов. */
  channelId: string | null;
  serverMute: boolean;
  selfMute: boolean;
  stream: boolean;
  video: boolean;
}

interface Session extends VoiceSnapshot {
  channelId: string;
  afk: boolean;
  /** С какого момента время ещё не записано в хранилище. */
  since: number;
}

export interface TrackerHooks {
  /** Участник впервые за день (МСК) побывал в голосе — для серий. */
  onVoiceDay?(guildId: string, userId: string, day: number): void;
  /** Участник зашёл в голос (не в AFK), до этого не сидев ни в одном канале. */
  onJoin?(guildId: string, userId: string, at: number): void;
}

/**
 * Держит в памяти, кто сейчас в голосовых каналах и в каком состоянии,
 * и сбрасывает накопленное время в {@link StatsStore}.
 *
 * Канал всегда сбрасывается целиком: при любом изменении в канале записываем время
 * всех его участников. Благодаря этому у всех сессий одного канала одинаковый `since`,
 * и совместное время пар считается без двойного учёта.
 */
export class VoiceTracker {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly store: StatsStore,
    private readonly afkChannelOf: (guildId: string) => string | null | undefined,
    private readonly hooks: TrackerHooks = {},
    private readonly now: () => number = Date.now,
  ) {}

  /** Обрабатывает изменение голосового состояния одного участника. */
  update(state: VoiceSnapshot): void {
    const at = this.now();
    const key = `${state.guildId}:${state.userId}`;
    const previous = this.sessions.get(key);
    if (previous) this.flushChannel(previous.guildId, previous.channelId, at);

    if (!state.channelId) {
      this.sessions.delete(key);
      return;
    }
    if (state.channelId !== previous?.channelId) this.flushChannel(state.guildId, state.channelId, at);

    const afkChannelId = this.afkChannelOf(state.guildId);
    const afk = !!afkChannelId && state.channelId === afkChannelId;
    if (afk && !previous?.afk) {
      this.store.add(state.guildId, state.userId, weekStart(at), { afk_moves: 1 });
    }

    this.sessions.set(key, { ...state, channelId: state.channelId, afk, since: at });
    if (!previous && !afk) this.hooks.onJoin?.(state.guildId, state.userId, at);
  }

  /**
   * Полный список голосовых состояний гильдии (старт бота или переподключение).
   * Тех, кого нет в списке, считаем вышедшими.
   */
  sync(guildId: string, states: VoiceSnapshot[]): void {
    const present = new Set(states.map((s) => s.userId));
    for (const session of [...this.sessions.values()]) {
      if (session.guildId === guildId && !present.has(session.userId)) {
        this.update({ ...session, channelId: null });
      }
    }
    for (const state of states) this.update(state);
  }

  /** Записывает накопленное время всех текущих сессий. */
  flush(): void {
    const at = this.now();
    const channels = new Set([...this.sessions.values()].map((s) => `${s.guildId}\n${s.channelId}`));
    for (const key of channels) {
      const [guildId, channelId] = key.split('\n') as [string, string];
      this.flushChannel(guildId, channelId, at);
    }
  }

  /** Кто сейчас в голосе (для проверки ачивок). */
  activeUsers(): { guildId: string; userId: string }[] {
    return [...this.sessions.values()].map(({ guildId, userId }) => ({ guildId, userId }));
  }

  private flushChannel(guildId: string, channelId: string, at: number): void {
    const members = [...this.sessions.values()].filter(
      (s) => s.guildId === guildId && s.channelId === channelId,
    );
    const together = members.filter((s) => !s.afk);
    for (let i = 0; i < together.length; i++) {
      for (let j = i + 1; j < together.length; j++) {
        const a = together[i]!;
        const b = together[j]!;
        splitByWeek(Math.max(a.since, b.since), at, (week, ms) =>
          this.store.addPair(guildId, week, a.userId, b.userId, ms),
        );
      }
    }
    for (const session of members) this.flushSession(session, at);
  }

  private flushSession(session: Session, at: number): void {
    const { guildId, userId } = session;
    splitByWeek(session.since, at, (week, ms, from, to) => {
      this.store.add(guildId, userId, week, countersFor(session, ms, from, to));
    });
    if (!session.afk && session.since < at) {
      for (let day = dayStart(session.since); day < at; day += DAY_MS) {
        if (this.store.markVoiceDay(guildId, userId, day)) {
          this.hooks.onVoiceDay?.(guildId, userId, day);
        }
      }
    }
    session.since = at;
  }
}

/** Делит интервал [from, to) по границам недель. */
function splitByWeek(
  from: number,
  to: number,
  each: (week: number, ms: number, from: number, to: number) => void,
): void {
  while (from < to) {
    const week = weekStart(from);
    const end = Math.min(to, week + WEEK_MS);
    each(week, end - from, from, end);
    from = end;
  }
}

function countersFor(session: Session, ms: number, from: number, to: number): Partial<Counters> {
  if (session.afk) return { afk_ms: ms };
  return {
    voice_ms: ms,
    server_mute_ms: session.serverMute ? ms : 0,
    // Если модератор замьютил, самомьют не считаем — иначе время задвоится.
    self_mute_ms: !session.serverMute && session.selfMute ? ms : 0,
    stream_ms: session.stream ? ms : 0,
    video_ms: session.video ? ms : 0,
    night_ms: nightOverlap(from, to),
  };
}
