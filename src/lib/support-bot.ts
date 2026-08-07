import { botKnowledgeBase, SupportIntent } from './support-data';

export class SupportBot {
  
  /**
   * Очистка текста от лишних символов
   */
  private normalizeText(text: string): string {
    if (!text) return "";
    return text.toLowerCase().replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, "").trim();
  }

  /**
   * Умное автоопределение языка по наличию кириллицы
   */
  private detectLanguage(text: string): 'ru' | 'en' {
    const cyrillicPattern = /[\u0400-\u04FF]/;
    return cyrillicPattern.test(text) ? 'ru' : 'en';
  }

  /**
   * Алгоритм Левенштейна: вычисляет дистанцию между словами.
   * Позволяет боту понимать слова даже с опечатками (например, "парол" вместо "пароль").
   */
  private getLevenshteinDistance(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) == a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // замена
            Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1) // вставка/удаление
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  /**
   * Расчет веса совпадения (Scoring System 2.0)
   */
  private calculateScore(cleanMessage: string, words: string[], intent: SupportIntent): number {
    let score = 0;

    for (const keyword of intent.keywords) {
      // 1. Проверка на точную команду (например, /help)
      if (keyword.startsWith('/') && cleanMessage === keyword) {
        return 100; // Моментальное 100% совпадение для команд
      }

      // 2. Полное совпадение ключевой фразы
      if (cleanMessage.includes(keyword)) {
        score += 10;
        continue;
      }

      // 3. Поиск по отдельным словам с защитой от опечаток
      for (const word of words) {
        if (word.length < 3) continue; // Игнорируем предлоги

        // Если слово содержит корень ключевого слова
        if (keyword.includes(word) || word.includes(keyword)) {
          score += 3;
        } 
        // Проверка на опечатки (допускается 1-2 ошибки в зависимости от длины слова)
        else {
          const distance = this.getLevenshteinDistance(word, keyword);
          const allowedTypos = keyword.length > 5 ? 2 : 1;
          
          if (distance <= allowedTypos) {
            score += 2; // Даем баллы, если это опечатка
          }
        }
      }
    }
    return score;
  }

  /**
   * Главный метод обработки сообщений
   */
  public getReply(userMessage: string, requestedLang?: 'ru' | 'en'): string {
    const rawMessage = userMessage.trim();
    const cleanMessage = this.normalizeText(rawMessage);
    
    // Автоопределение языка, если он не передан жестко
    const lang = requestedLang || this.detectLanguage(rawMessage);
    
    if (!cleanMessage && !rawMessage.startsWith('/')) {
      return lang === 'ru' 
        ? "🤖 Приветствую! Я системный ассистент Trivo. Напишите ваш вопрос или отправьте /help для списка команд." 
        : "🤖 Greetings! I am the Trivo system assistant. Type your question or send /help for commands.";
    }
    
    const words = cleanMessage.split(/\s+/);
    let bestMatch: SupportIntent | null = null;
    let highestScore = 0;

    for (const intent of botKnowledgeBase) {
      const score = this.calculateScore(cleanMessage, words, intent);
      if (score > highestScore) {
        highestScore = score;
        bestMatch = intent;
      }
    }

    // Порог срабатывания: минимум 2 балла, чтобы избежать случайных ответов
    if (bestMatch && highestScore >= 2) {
      return lang === 'ru' ? bestMatch.replyRu : bestMatch.replyEn;
    }

    // Элитный fallback-ответ с меню (форматирование в стиле Telegram-ботов)
    return lang === 'ru' 
      ? "К сожалению, я не нашел точного ответа. 😔\n\n💡 **Попробуйте спросить иначе или используйте команды:**\n/help — Главное меню\n/security — О шифровании\n/tor — Статус сети\n/friends — Как искать контакты"
      : "I couldn't find an exact answer. 😔\n\n💡 **Try rephrasing or use commands:**\n/help — Main Menu\n/security — About Encryption\n/tor — Network Status\n/friends — Finding Contacts";
  }
}

export const supportBot = new SupportBot();