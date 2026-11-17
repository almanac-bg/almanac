package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"time"
)

// A run of the server that ends without its clean stop (a panic nothing stopped, a kill, out of memory, the machine
// going down) leaves nothing in its log to say so, and its problems, kept in memory, go with it. So the server notes
// that it runs (Config.RunningFile) as it starts, and takes the note away as it stops cleanly: a note found at the
// start is a run that ended otherwise, told as a problem. The note counts such runs in a row, so that a server that
// keeps falling over says how often, once a run lives long enough to mail (MailProblems mails its first a minute
// after the start).

// runNote is what the note holds: the run it's for, and how many runs before it in a row ended without a clean stop.
type runNote struct {
	Since   time.Time `json:"since"`
	Version string    `json:"version"`
	Unclean int       `json:"unclean,omitempty"`
}

// noteRunning notes the run as it starts, and tells of the last one if it ended without a clean stop.
func (s *Server) noteRunning() {
	path := s.cfg.RunningFile
	if path == "" {
		return
	}
	note := runNote{Since: time.Now(), Version: s.cfg.Version}
	switch data, err := os.ReadFile(path); {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		slog.Error("reading the note of the last run", "err", err)
	default:
		var last runNote
		_ = json.Unmarshal(data, &last) // a note that can't be read is still a run that didn't stop cleanly
		note.Unclean = last.Unclean + 1
		slog.Error("the last run ended without a clean stop", "since", last.Since, "version", last.Version,
			"inARow", note.Unclean)
		s.Problem(fmt.Sprintf("the server's last run (%s, from %s) ended without a clean stop: a crash, a kill, out of "+
			"memory or the machine; %d in a row. The log of that run says why: journalctl -u almanac",
			last.Version, last.Since.Format("02.01 15:04"), note.Unclean))
	}
	data, _ := json.Marshal(note)
	tmp := path + ".part"
	err := os.WriteFile(tmp, data, 0o600)
	if err == nil {
		err = os.Rename(tmp, path)
	}
	if err != nil {
		slog.Error("noting the run", "err", err)
	}
}

// noteStopped takes the note away: the run stops cleanly.
func (s *Server) noteStopped() {
	if s.cfg.RunningFile == "" {
		return
	}
	if err := os.Remove(s.cfg.RunningFile); err != nil && !errors.Is(err, fs.ErrNotExist) {
		slog.Error("taking the note of the run away", "err", err)
	}
}
