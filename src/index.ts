import { Client, Events } from '@fluxerjs/core';
import { createApp } from './app.js';
import { dispatch } from './commands/index.js';

const token = process.env.FLUXER_BOT_TOKEN;
if (!token) {
  console.error('Не задан FLUXER_BOT_TOKEN (см. .env.example).');
  process.exit(1);
}

/** Адрес инстанса, например https://fluxer.example.com. Пусто — официальный fluxer.app. */
const INSTANCE = process.env.FLUXER_INSTANCE?.trim();

// Для своего инстанса адреса API, гейтвея и CDN берутся из `${INSTANCE}/.well-known/fluxer`.
const client = INSTANCE ? await discover(INSTANCE) : new Client();
console.log(`Инстанс: ${INSTANCE || 'fluxer.app (по умолчанию)'}`);

const app = createApp(client, {
  prefix: process.env.BOT_PREFIX || '!',
  dbPath: process.env.STATS_DB_PATH || 'data/stats.db',
});

client.on(Events.Ready, () => {
  console.log(`Бот запущен как ${client.user?.username}`);
});

client.on(Events.MessageCreate, (message) => {
  void dispatch(message, app);
});

await client.login(token);

async function discover(origin: string): Promise<Client> {
  try {
    return await Client.fromDiscovery(origin);
  } catch (error) {
    console.error(
      `Не удалось получить ${origin}/.well-known/fluxer — проверьте FLUXER_INSTANCE.`,
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  }
}
