export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  rarity: Rarity;
  xp: number;
  /** Achievements with a goal show a progress bar. */
  goal?: number;
}

export const RARITIES: Record<Rarity, { name: string; color: string }> = {
  common: { name: 'Обикновено', color: '#94a3b8' },
  rare: { name: 'Рядко', color: '#38bdf8' },
  epic: { name: 'Епично', color: '#c084fc' },
  legendary: { name: 'Легендарно', color: '#fbbf24' },
};

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_game', name: 'Първи стъпки', description: 'Завърши първия си мач.', icon: '🚀', rarity: 'common', xp: 50, goal: 1 },
  { id: 'games_10', name: 'Вече е навик', description: 'Изиграй 10 мача.', icon: '🎟️', rarity: 'common', xp: 100, goal: 10 },
  { id: 'games_100', name: 'Стара школа', description: 'Изиграй 100 мача.', icon: '🎖️', rarity: 'epic', xp: 500, goal: 100 },
  { id: 'first_win', name: 'Вкус на победа', description: 'Спечели мултиплейър мач.', icon: '🏆', rarity: 'common', xp: 100, goal: 1 },
  { id: 'duelist', name: 'Дуелен инстинкт', description: 'Спечели 10 класирани дуела.', icon: '⚔️', rarity: 'rare', xp: 300, goal: 10 },
  { id: 'trio_win', name: 'Начело на триото', description: 'Спечели класиран мач Трио.', icon: '🥇', rarity: 'common', xp: 120, goal: 1 },
  { id: 'squad_win', name: 'Арената е твоя', description: 'Спечели класиран мач Арена.', icon: '🦸', rarity: 'rare', xp: 200, goal: 1 },
  { id: 'royale_win', name: 'Короната на Роял', description: 'Спечели Роял с 8 играчи.', icon: '👑', rarity: 'epic', xp: 400, goal: 1 },
  { id: 'party_animal', name: 'Душата на купона', description: 'Изиграй 25 мултиплейър мача.', icon: '🎉', rarity: 'rare', xp: 250, goal: 25 },
  { id: 'host', name: 'Добре дошли!', description: 'Бъди домакин на мач в частна стая.', icon: '🏠', rarity: 'common', xp: 75, goal: 1 },
  { id: 'streak_5', name: 'В огън', description: 'Отговори вярно 5 пъти подред.', icon: '🔥', rarity: 'common', xp: 75, goal: 5 },
  { id: 'streak_10', name: 'Неудържима серия', description: 'Отговори вярно 10 пъти подред.', icon: '☄️', rarity: 'rare', xp: 250, goal: 10 },
  { id: 'speed_demon', name: 'Демон на скоростта', description: 'Отговори вярно за под 1,5 секунди.', icon: '⚡', rarity: 'rare', xp: 150 },
  { id: 'perfect', name: 'Перфектен мач', description: 'Отговори вярно на всичко в мач с 10+ въпроса.', icon: '💎', rarity: 'rare', xp: 250 },
  { id: 'correct_100', name: 'Светъл ум', description: 'Събери 100 верни отговора.', icon: '📘', rarity: 'common', xp: 150, goal: 100 },
  { id: 'correct_1000', name: 'Научна степен', description: 'Събери 1000 верни отговора.', icon: '🎓', rarity: 'epic', xp: 750, goal: 1000 },
  { id: 'polymath', name: 'Всестранен ум', description: 'Отговори вярно във всички 10 категории.', icon: '🌈', rarity: 'rare', xp: 250, goal: 10 },
  { id: 'specialist', name: 'Тясна специалност', description: 'Събери 50 верни отговора в една категория.', icon: '🔬', rarity: 'rare', xp: 300, goal: 50 },
  { id: 'high_scorer', name: 'Рекордна игра', description: 'Събери 9000+ точки в една соло игра.', icon: '📈', rarity: 'epic', xp: 400, goal: 9000 },
  { id: 'power_player', name: 'Тактически ум', description: 'Използвай 25 жокера.', icon: '🃏', rarity: 'common', xp: 100, goal: 25 },
  { id: 'comeback', name: 'Голям обрат', description: 'Спечели мач, в който по средата си на последно място.', icon: '🔄', rarity: 'epic', xp: 400 },
  { id: 'flawless_duel', name: 'Безупречна победа', description: 'Спечели дуел без нито един грешен отговор.', icon: '🛡️', rarity: 'epic', xp: 350 },
  { id: 'photo_finish', name: 'Фотофиниш', description: 'Спечели мултиплейър мач с под 100 точки разлика.', icon: '📸', rarity: 'rare', xp: 200 },
  { id: 'giant_slayer', name: 'Давид и Голиат', description: 'Победи играч с поне 5 нива над теб.', icon: '🗡️', rarity: 'rare', xp: 200 },
  { id: 'level_10', name: 'Изгряваща звезда', description: 'Достигни ниво 10.', icon: '⭐', rarity: 'rare', xp: 250, goal: 10 },
  { id: 'level_25', name: 'Елит', description: 'Достигни ниво 25.', icon: '🌠', rarity: 'epic', xp: 600, goal: 25 },
  { id: 'level_50', name: 'Легенда', description: 'Достигни ниво 50.', icon: '🐐', rarity: 'legendary', xp: 1500, goal: 50 },
  { id: 'team_win', name: 'Отборен дух', description: 'Спечели отборен мач 2 на 2.', icon: '🤝', rarity: 'common', xp: 120, goal: 1 },
  { id: 'team_carry', name: 'Носиш отбора', description: 'Спечели отборен мач като най-резултатния играч.', icon: '🏋️', rarity: 'rare', xp: 250 },
  { id: 'daily_first', name: 'Дневна доза', description: 'Изиграй дневното предизвикателство.', icon: '📅', rarity: 'common', xp: 75, goal: 1 },
  { id: 'daily_streak_7', name: 'Седмица подред', description: 'Играй дневното предизвикателство 7 дни поред.', icon: '🗓️', rarity: 'rare', xp: 300, goal: 7 },
  { id: 'daily_streak_30', name: 'Месец подред', description: 'Играй дневното предизвикателство 30 дни поред.', icon: '📆', rarity: 'epic', xp: 750, goal: 30 },
  { id: 'daily_streak_100', name: 'Сто изгрева', description: 'Играй дневното предизвикателство 100 дни поред.', icon: '🌅', rarity: 'legendary', xp: 2000, goal: 100 },
  { id: 'daily_perfect', name: 'Перфектен ден', description: '10 от 10 в дневното предизвикателство.', icon: '🌞', rarity: 'epic', xp: 400 },
  { id: 'friends_5', name: 'Компанията', description: 'Имай 5 приятели.', icon: '👯', rarity: 'common', xp: 100, goal: 5 },
  { id: 'freezer', name: 'Ледена епоха', description: 'Замрази 10 съперници с „Леден удар“.', icon: '🧊', rarity: 'rare', xp: 200, goal: 10 },
  { id: 'author_1', name: 'Първо перо', description: 'Получи одобрение за свой въпрос.', icon: '✍️', rarity: 'rare', xp: 200, goal: 1 },
  { id: 'author_10', name: 'Златно перо', description: 'Получи одобрение за 10 свои въпроса.', icon: '📝', rarity: 'epic', xp: 600, goal: 10 },
  { id: 'season_gold', name: 'Златен сезон', description: 'Завърши сезон в ранг Злато или по-висок.', icon: '🏅', rarity: 'epic', xp: 500 },
  { id: 'rank_gold', name: 'Златен стандарт', description: 'Достигни ранг Злато (1250) в класиран режим.', icon: '🥂', rarity: 'epic', xp: 500 },
  { id: 'rank_master', name: 'Гросмайстор', description: 'Достигни ранг Майстор (1700) в класиран режим.', icon: '🔮', rarity: 'legendary', xp: 2000 },
];

export const achievementById = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);
