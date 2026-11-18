package play

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"strconv"
)

// Experiments: whether something the game does for players works can only be told against players it isn't done for.
// A player's bucket in an experiment is a hash of the experiment's name and their id, 0 to 99: the same player is in
// the same bucket of an experiment always, and their buckets in two experiments are unrelated. Nothing is kept: the
// bucket is worked out each time it's asked.
//
// The one experiment so far (the owner's call, 2026-11-18: DECISIONS.md): HeldReminders, a tenth of the players held
// out of the day's notification and the streak's mail (and the year's notification). What they would have had is kept
// as if sent, marked held (push_reminded, streak_mails, year_words), by the same rules and at the same hour, so /admin
// compares those reminded with those who weren't, and the difference is the reminder's. The day's reminder by mail
// isn't in it: a player asks for that one, and gets it (server/daymail.go); nor is the year's word by mail. /admin
// tells it from its first whole day (ExperimentFrom).

// HeldReminders is the experiment of the day's notification (server/remind.go) and the streak's mail
// (server/streakmail.go).
const HeldReminders = "reminders"

// Holdout is the share, in percent, of the players an experiment holds out.
const Holdout = 10

// Bucket is a player's bucket in an experiment: 0 to 99.
func Bucket(experiment string, userID int64) int {
	h := sha256.Sum256([]byte(experiment + ":" + strconv.FormatInt(userID, 10)))
	return int(binary.BigEndian.Uint64(h[:8]) % 100)
}

// HeldOut says whether a player is held out of an experiment: what it tries isn't done for them.
func HeldOut(experiment string, userID int64) bool { return Bucket(experiment, userID) < Holdout }

// ExperimentFrom is the first day an experiment is told from: its first whole day, kept in kv as "<name>_from" by the
// migration that began it; "" (from the start) without one, as in a database made after.
func (g *Game) ExperimentFrom(ctx context.Context, experiment string) (string, error) {
	var day string
	err := g.DB.Read.QueryRowContext(ctx, `SELECT value FROM kv WHERE key = ?`, experiment+"_from").Scan(&day)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return day, err
}
