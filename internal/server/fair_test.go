package server

import (
	"bytes"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/almanac-bg/almanac/internal/account"
)

// A game keeps its network as a mark (netMark): one for the addresses of a /64 (or one IPv4 address), another for
// another network, none for the machine's own or an unknown one; never the address itself.
func TestNetMark(t *testing.T) {
	s := addressServer(false)
	s.accounts = &account.Accounts{Secret: []byte("a secret")}
	mark := func(addr string) []byte {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = addr
		return s.netMark(r)
	}
	home, again, phone := mark("[2001:db8:1:2::5]:443"), mark("[2001:db8:1:2:ffff::9]:443"), mark("[2001:db8:1:3::5]:443")
	if len(home) == 0 || !bytes.Equal(home, again) || bytes.Equal(home, phone) {
		t.Fatalf("one /64 is one mark, another another: %x %x %x", home, again, phone)
	}
	if v4, other := mark("198.51.100.7:5000"), mark("198.51.100.8:5000"); len(v4) == 0 || bytes.Equal(v4, other) ||
		bytes.Contains(v4, []byte("198.51")) {
		t.Fatalf("IPv4: %x %x", v4, other)
	}
	for _, addr := range []string{"127.0.0.1:5000", "[::1]:5000", "nonsense"} {
		if m := mark(addr); m != nil {
			t.Errorf("%s has a mark: %x", addr, m)
		}
	}
	s.accounts = &account.Accounts{Secret: []byte("another")}
	if bytes.Equal(mark("[2001:db8:1:2::5]:443"), home) {
		t.Fatal("the mark doesn't depend on the secret")
	}
}

// Why a duel moved no rating is said the same in a notification (unratedWords) and on its result in the client
// (screens/outcome.ts), every reason the game gives.
func TestUnratedWordsMatchTheClient(t *testing.T) {
	src, err := os.ReadFile("../../web/src/screens/outcome.ts")
	if err != nil {
		t.Fatal(err)
	}
	client := strings.Join(strings.Fields(string(src)), " ")
	for _, why := range []string{"again", "network", "newcomers", "known"} {
		words, ok := unratedWords[why]
		if !ok {
			t.Errorf("no words for %q", why)
			continue
		}
		if !strings.Contains(client, why+": "+strconv.Quote(words)) {
			t.Errorf("the client says %q otherwise, or not at all: %s", why, words)
		}
	}
}
