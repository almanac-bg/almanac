package play

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/almanac-bg/almanac/internal/account"
	"github.com/almanac-bg/almanac/internal/store"
)

// A recording is a stranger's game, and goes both ways unnamed (review 2026-11-18, S13). The one playing against it
// sees it as the animal its player started as, in that animal's avatar (RecordedAs): no name, tag, title or frame, no
// way to their profile; their answers and how long each took are the recording itself. The recorded player hears what
// others' duels against their recordings came to (RecordingsNews), in numbers: never who played.

// RecordedAs is how the player of a recording shows to the one playing against it: the animal they started as
// (account.AnimalOf), and its avatar, with their level.
func RecordedAs(userID int64, level int) (string, Look) {
	return account.AnimalOf(userID).Name, Look{Avatar: DefaultAvatar(userID), Level: level}
}

// RecordingsNews is what others' duels against the player's recordings came to (duels.go): how many people played
// how many, and how many the recordings won. It's told quietly, with a game's news and never in a push: once a day at
// most, from one duel up, and only while the news has room for it (NewsCards).
type RecordingsNews struct {
	Text string `json:"text"`
}

// NewsCards is how many cards a game's news shows at most (web/src/game/news.ts): the goals, the one biggest event,
// what's new; the recordings take a place left free.
const NewsCards = 3

// cards is how many of a game's news cards this news fills.
func (n News) cards() int {
	c := 0
	for _, has := range []bool{
		len(n.Goals) > 0,
		n.League != nil || n.Division != nil || n.LevelUp,
		len(n.Achievements) > 0 || len(n.Unlocks) > 0 || len(n.Mastery) > 0,
	} {
		if has {
			c++
		}
	}
	return c
}

// recordingsNews is the news of the duels played against the player's recordings since they last heard of them, at
// most since yesterday began, if there's any and they haven't heard today (in Bulgaria); telling it is kept.
func (g *Game) recordingsNews(tx *sql.Tx, userID int64) (*RecordingsNews, error) {
	now := g.Now()
	local := now.In(Bulgaria)
	midnight := time.Date(local.Year(), local.Month(), local.Day(), 0, 0, 0, 0, Bulgaria)
	var told int64
	if err := tx.QueryRow(`SELECT recordings_told FROM users WHERE id = ?`, userID).Scan(&told); err != nil {
		return nil, err
	}
	if told >= store.Ms(midnight) {
		return nil, nil
	}
	rows, err := tx.Query(`SELECT d.a_id, d.outcome, d.ended_at
		FROM runs r JOIN duels d ON d.ghost_run = r.id
		WHERE r.user_id = ? AND d.ended_at > ? AND d.outcome IN ('ghost_won', 'ghost_lost', 'ghost_draw') AND d.challenge_id IS NULL
		ORDER BY d.ended_at DESC`, userID, max(told, store.Ms(midnight.AddDate(0, 0, -1))))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var n RecordingsNews
	seen := map[int64]bool{}
	games, won := 0, 0
	first, last := int64(0), int64(0)
	for rows.Next() {
		var id, at int64
		var outcome string
		if err := rows.Scan(&id, &outcome, &at); err != nil {
			return nil, err
		}
		games++
		if outcome == "ghost_lost" { // the player lost to the recording
			won++
		}
		if last == 0 {
			last = at
		}
		first = at
		seen[id] = true
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if games == 0 {
		return nil, nil
	}
	if _, err := tx.Exec(`UPDATE users SET recordings_told = ? WHERE id = ?`, store.Ms(now), userID); err != nil {
		return nil, err
	}
	today := store.Ms(midnight)
	n.Text = recordingsWords(first >= today, last >= today, len(seen), games, won)
	return &n, nil
}

// recordingsWords says what others' duels against the player's recordings came to: when (all today, all yesterday,
// or both), how many people played how many games, and how many the recordings won.
func recordingsWords(firstToday, lastToday bool, people, games, won int) string {
	when := "Вчера и днес"
	switch {
	case firstToday:
		when = "Днес"
	case !lastToday:
		when = "Вчера"
	}
	who := fmt.Sprintf("%d души играха", people)
	if people == 1 {
		who = "един човек игра"
	}
	against := "записи на твои игри"
	if games == 1 {
		against = "запис на твоя игра"
	}
	s := fmt.Sprintf("%s %s срещу %s.", when, who, against)
	switch {
	case won == 0:
	case games == 1:
		s += " Записът ти спечели дуела."
	case won == games:
		s += " Записите ти спечелиха всички дуели."
	default:
		s += fmt.Sprintf(" Записите ти спечелиха %d от %d дуела.", won, games)
	}
	return s
}
