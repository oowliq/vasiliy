import type { Client } from '@fluxerjs/core';
import type { SettingsStore } from '../settings.js';
import { chunkText } from '../util.js';

export interface AnnounceOptions {
  /** Кого пинговать (остальные упоминания показываются без уведомления). */
  ping?: string[];
  /** Канал вместо канала объявлений. */
  channelId?: string;
}

/** Отправляет сообщение в канал объявлений гильдии. false — если канала нет или отправка не удалась. */
export type Announce = (guildId: string, content: string, options?: AnnounceOptions) => Promise<boolean>;

export function createAnnouncer(client: Client, settings: SettingsStore): Announce {
  return async (guildId, content, options = {}) => {
    const channelId = options.channelId ?? settings.get(guildId).announceChannelId;
    if (!channelId) return false;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error('канал не текстовый или недоступен');
      for (const chunk of chunkText(content)) {
        await channel.send({
          content: chunk,
          allowedMentions: { parse: [], users: options.ping ?? [] },
        });
      }
      return true;
    } catch (error) {
      console.error(`[announce] не удалось отправить в ${channelId} (гильдия ${guildId}):`, error);
      return false;
    }
  };
}
