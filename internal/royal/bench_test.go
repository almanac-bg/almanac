package royal

import (
	"encoding/json"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/almanac-bg/almanac/internal/bank"
)

// screens follows the evening as the server's streams do: one goroutine a screen, each sending what it's shown after
// every change it hears of (without the stream's pause between looks: the worst case).
type screens struct {
	looks, bytes atomic.Int64
	busy         sync.WaitGroup
	stop         chan struct{}
}

func (w *world) screens(subs []*Sub) *screens {
	s := &screens{stop: make(chan struct{})}
	for _, sub := range subs {
		s.busy.Add(1)
		go func() {
			defer s.busy.Done()
			for {
				select {
				case <-sub.C:
					s.looks.Add(1)
					s.bytes.Add(int64(w.look(sub)))
				case <-s.stop:
					return
				}
			}
		}()
	}
	return s
}

func (s *screens) close() {
	close(s.stop)
	s.busy.Wait()
}

// look is what one screen does when told of a change: the evening as its viewer sees it, made into what's sent.
func (w *world) look(s *Sub) int {
	data, _ := w.h.Look(s)
	return len(data)
}

// quick is a right (or wrong) answer to question n, without looking at the screen.
func (w *world) quick(n int, right bool) json.RawMessage {
	raw, _ := json.Marshal(w.h.night.dealt[n].Reveal(nil))
	var rv struct {
		Pick  *int  `json:"pick"`
		Truth *bool `json:"truth"`
	}
	_ = json.Unmarshal(raw, &rv)
	var a any
	switch {
	case rv.Pick != nil:
		pick := *rv.Pick
		if !right {
			pick = (pick + 1) % bank.ChoiceOptions
		}
		a = map[string]int{"pick": pick}
	case rv.Truth != nil:
		a = map[string]bool{"truth": *rv.Truth == right}
	}
	out, _ := json.Marshal(a)
	return out
}

// settled waits for the screens to have looked at everything they were told of.
func (s *screens) settled() {
	for last := int64(-1); ; {
		runtime.Gosched()
		time.Sleep(2 * time.Millisecond)
		if n := s.looks.Load(); n == last {
			return
		} else {
			last = n
		}
	}
}

// An evening of k full tournaments (50 each), every player on its screen and as many again only watching, answers its
// first question: what it costs the hub and the screens, from the first answer to the last screen's look.
func BenchmarkAnswers(b *testing.B) {
	for _, k := range []int{1, 10, 40} {
		b.Run(fmt.Sprintf("players=%d", k*50), func(b *testing.B) {
			var looks, bytes int64
			var answers time.Duration
			for range b.N {
				b.StopTimer()
				w := setup(b)
				w.at(20, 46, 0)
				ps, subs := w.lobby(k * 50)
				for range k * 50 {
					subs = append(subs, w.follow(0))
				}
				w.at(21, 0, 0)
				n := w.question()
				s := w.screens(subs)
				s.settled()
				s.looks.Store(0)
				s.bytes.Store(0)
				b.StartTimer()
				for i, p := range ps {
					at := time.Now()
					if err := w.h.Answer(b.Context(), p.ID, n, w.quick(n, i%2 == 0)); err != nil {
						b.Fatal(err)
					}
					answers += time.Since(at)
				}
				s.settled()
				b.StopTimer()
				looks += s.looks.Load()
				bytes += s.bytes.Load()
				s.close()
			}
			b.ReportMetric(float64(answers.Microseconds())/float64(b.N*k*50), "µs/answer")
			b.ReportMetric(float64(looks)/float64(b.N), "looks/question")
			b.ReportMetric(float64(bytes)/float64(b.N)/1e6, "MB/question")
			b.ReportMetric(float64(bytes)/float64(looks)/1e3, "kB/look")
		})
	}
}

// k players come into the lobby one after another, each on its screen: what the lobby costs before the start.
func BenchmarkLobby(b *testing.B) {
	for _, k := range []int{50, 200, 500} {
		b.Run(fmt.Sprintf("players=%d", k), func(b *testing.B) {
			var looks, bytes int64
			for range b.N {
				b.StopTimer()
				w := setup(b)
				w.at(20, 46, 0)
				var ps []Player
				for range k {
					ps = append(ps, w.player())
				}
				var subs []*Sub
				for _, p := range ps {
					subs = append(subs, w.follow(p.ID))
				}
				s := w.screens(subs)
				s.settled()
				s.looks.Store(0)
				s.bytes.Store(0)
				b.StartTimer()
				for _, p := range ps {
					if err := w.h.Join(b.Context(), p); err != nil {
						b.Fatal(err)
					}
				}
				s.settled()
				b.StopTimer()
				looks += s.looks.Load()
				bytes += s.bytes.Load()
				s.close()
			}
			b.ReportMetric(float64(looks)/float64(b.N), "looks/lobby")
			b.ReportMetric(float64(bytes)/float64(b.N)/1e6, "MB/lobby")
			b.ReportMetric(float64(bytes)/float64(looks)/1e3, "kB/look")
		})
	}
}

// question is the question showing.
func (w *world) question() int { return w.h.night.n }
