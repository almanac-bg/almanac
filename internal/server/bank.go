package server

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// A bank reload (cmd/almanac: SIGHUP, after deploy/bank.sh pulls) offers the server a bank already loaded and checked.
// The game keeps its questions' versions first (play.Game.Keep): a play is graded against the version it showed,
// whatever the bank has become since, and a live game (a live duel, Роял, a room) through the questions it dealt. Even
// so, a new bank never goes into play while Роял is on, from its lobby until its games are over: the evening's
// questions are one game for fifty, and nothing of it changes under them. It's held, and goes in as the evening ends.
// /api/health tells which bank is played, which is held, and which was refused, for bank.sh to confirm what became of
// its pull.

// banks is what became of the banks offered.
type banks struct {
	mu      sync.Mutex
	held    *bank.Bank
	refused *RefusedBank
}

// BankStatus is the bank's part of /api/health.
type BankStatus struct {
	// Commit is the bank played: its commit in the bank's repository ("" when not known), and Questions its live
	// questions.
	Commit    string `json:"commit"`
	Questions int    `json:"questions"`
	// Held is a newer bank's commit, checked and waiting for Роял to be over.
	Held string `json:"held,omitempty"`
	// Refused is the newest bank that had errors, and was left out.
	Refused *RefusedBank `json:"refused,omitempty"`
}

// RefusedBank is a bank left out for its errors.
type RefusedBank struct {
	Commit string    `json:"commit"`
	Errors int       `json:"errors"`
	At     time.Time `json:"at"`
}

// SetBank puts a bank in play at once, whatever is under way (its versions kept first: a question showing is graded
// as it showed). A reload goes through OfferBank instead.
func (s *Server) SetBank(b *bank.Bank) {
	s.keep(b)
	s.bank.Store(b)
}

// keep keeps a bank's versions of its questions, before it goes into play (play.Game.Keep). One that can't be kept
// still goes in: a question shown from it is graded as it showed while it's in play, and only once it's gone would
// that version be lost.
func (s *Server) keep(b *bank.Bank) {
	if err := s.game.Keep(context.Background(), b); err != nil {
		slog.Error("keeping the bank's versions", "commit", b.Commit, "err", err)
		s.Problem("bank: its questions' versions couldn't be kept")
	}
}

// Bank is the bank in play.
func (s *Server) Bank() *bank.Bank { return s.bank.Load() }

// Banks are the banks the server holds: the one in play, and the one held for Роял to be over, if there is one. Their
// directories must stay as long as they're held (pictures are served from there).
func (s *Server) Banks() []*bank.Bank {
	s.banks.mu.Lock()
	defer s.banks.mu.Unlock()
	out := []*bank.Bank{s.bank.Load()}
	if s.banks.held != nil {
		out = append(out, s.banks.held)
	}
	return out
}

// OfferBank puts a newly loaded bank in play, or holds it while Роял is on (then it says so). It replaces a bank held
// before it, and clears a refusal: a good bank came after it.
func (s *Server) OfferBank(b *bank.Bank) (held bool) {
	s.keep(b)
	s.banks.mu.Lock()
	defer s.banks.mu.Unlock()
	s.banks.refused = nil
	if s.royal.Near(0) {
		s.banks.held = b
		slog.Info("bank held until Роял is over", "commit", b.Commit, "questions", len(b.Live("", "")))
		return true
	}
	s.banks.held = nil
	s.bank.Store(b)
	return false
}

// RefuseBank records a bank left out for its errors (the one in play, and one held, stay).
func (s *Server) RefuseBank(commit string, errors int) {
	s.banks.mu.Lock()
	defer s.banks.mu.Unlock()
	s.banks.refused = &RefusedBank{Commit: commit, Errors: errors, At: s.game.Now()}
}

// BankStatus is which bank is played, and what became of the latest offered.
func (s *Server) BankStatus() BankStatus {
	s.banks.mu.Lock()
	defer s.banks.mu.Unlock()
	b := s.bank.Load()
	st := BankStatus{Commit: b.Commit, Questions: len(b.Live("", "")), Refused: s.banks.refused}
	if s.banks.held != nil {
		st.Held = s.banks.held.Commit
	}
	return st
}

// bankStep puts the held bank in play once Роял is over. Run it every second or so.
func (s *Server) bankStep() {
	s.banks.mu.Lock()
	defer s.banks.mu.Unlock()
	if s.banks.held == nil || s.royal.Near(0) {
		return
	}
	b := s.banks.held
	s.banks.held = nil
	s.bank.Store(b)
	slog.Info("bank in play, Роял over", "commit", b.Commit, "questions", len(b.Live("", "")))
}
