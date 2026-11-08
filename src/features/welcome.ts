import { mention, pick } from '../util.js';

const LINES = [
  'К нам залетел {user}! Добро пожаловать, располагайся.',
  '{user} уже здесь. Прячьте мемы.',
  'Дикий {user} появляется! Что будем делать?',
  '{user} подключился(-ась) к серверу. Голосовой канал сам себя не займёт.',
  'Встречайте: {user}! Надеемся, ты принёс(ла) пиццу.',
  '{user}, привет! Правила простые: не уходи в AFK слишком часто — бот всё видит.',
  'Йо, {user}! Тебя тут ждали. Ну, почти.',
];

export function welcomeText(userId: string): string {
  return `👋 ${pick(LINES).replace('{user}', mention(userId))}`;
}
