package server

import (
	"encoding/json"
	"net/netip"
	"os"
	"regexp"
	"slices"
	"testing"
)

// The addresses the server takes Cloudflare's header from are the ones the firewalls let reach the game: the server's
// own (deploy/nftables.conf) and Hetzner's in front of it (deploy/hetzner-firewall.json). One Cloudflare adds goes in
// all three, or its players are shut out, or counted as Cloudflare.
func TestCloudflareIsTheFirewalls(t *testing.T) {
	var want []string
	for _, p := range cloudflare {
		want = append(want, p.String())
	}
	slices.Sort(want)

	nft, err := os.ReadFile("../../deploy/nftables.conf")
	if err != nil {
		t.Fatal(err)
	}
	var fromNft []string
	sets := regexp.MustCompile(`(?s)set cloudflare[46] \{.*?elements = \{(.*?)\}`).FindAllSubmatch(nft, -1)
	if len(sets) != 2 {
		t.Fatalf("nftables.conf: %d sets of Cloudflare's addresses, not 2 (cloudflare4, cloudflare6)", len(sets))
	}
	for _, set := range sets {
		for _, s := range regexp.MustCompile(`[0-9a-f.:]+/\d+`).FindAll(set[1], -1) {
			fromNft = append(fromNft, prefix(t, string(s)))
		}
	}
	slices.Sort(fromNft)
	if !slices.Equal(fromNft, want) {
		t.Errorf("deploy/nftables.conf lets in\n%v\nthe server trusts (address.go)\n%v", fromNft, want)
	}

	raw, err := os.ReadFile("../../deploy/hetzner-firewall.json")
	if err != nil {
		t.Fatal(err)
	}
	var rules []struct {
		Direction, Protocol, Port string
		SourceIPs                 []string `json:"source_ips"`
	}
	if err := json.Unmarshal(raw, &rules); err != nil {
		t.Fatal(err)
	}
	var fromHetzner []string
	for _, r := range rules {
		if r.Direction != "in" {
			t.Errorf("hetzner-firewall.json: a rule %q: only what comes in is limited, all that goes out stays open", r.Direction)
		}
		switch r.Port {
		case "443":
			for _, s := range r.SourceIPs {
				fromHetzner = append(fromHetzner, prefix(t, s))
			}
		case "22", "":
		default:
			t.Errorf("hetzner-firewall.json opens port %s: nftables.conf doesn't", r.Port)
		}
	}
	slices.Sort(fromHetzner)
	if !slices.Equal(fromHetzner, want) {
		t.Errorf("deploy/hetzner-firewall.json lets in\n%v\nthe server trusts (address.go)\n%v", fromHetzner, want)
	}
}

func prefix(t *testing.T, s string) string {
	t.Helper()
	p, err := netip.ParsePrefix(s)
	if err != nil || p != p.Masked() {
		t.Errorf("not a network: %q", s)
	}
	return p.String()
}
