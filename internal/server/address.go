package server

import (
	"net/http"
	"net/netip"
	"time"
)

// Where a request comes from, for the limits and the log.
//
// Behind Cloudflare (Config.TrustCloudflare) the connection is Cloudflare's, and the player's address is in
// CF-Connecting-IP. That header is taken only from a connection that comes from Cloudflare's own addresses: anyone who
// reached the server another way could claim any address with it, and get past every limit. One that comes with the
// header from elsewhere is a problem to hear of: the server can be reached past Cloudflare, or Cloudflare has
// addresses this list doesn't know yet (its players would then share Cloudflare's address in the limits).
//
// A limit counts by a network, not by an address (clientNet): an IPv4 address as it is, since one is costly and many
// players may be behind it (a school's, a carrier's); an IPv6 address by its /64, since whoever has one address has
// the /64 around it to choose from, 2^64 of them, and a /64 is what one home, one school's network or one phone is
// given. Wherever a key can be farmed (anything anyone may do without a profile, and every write), a wider limit
// counts the site too (clientSite): an IPv6 /48, the 65,536 /64s one customer is given at most, and an IPv4 /24, the
// block one owner of many addresses rents (review 2026-11-18, S3, S11). Its budget is a few networks', so a school or
// a company fits under it. Behind a carrier's NAT (thousands of phones behind a few addresses of a /24), each address
// has a school's budget, never one player's, and the /24 a few schools' (S9).
//
// The keys of what many may do at no cost and that is only counted (a page visited) are kept by home (clientHome):
// the /48 of an IPv6 address, so that one site can't make thousands of them (S8); an IPv4 address as it is.

// cloudflare are the addresses Cloudflare connects from: https://www.cloudflare.com/ips/ (the same since 2021; checked
// November 2026).
var cloudflare = func() []netip.Prefix {
	var ps []netip.Prefix
	for _, s := range []string{
		"173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18", "108.162.192.0/18",
		"190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
		"104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
		"2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32", "2a06:98c0::/29",
		"2c0f:f248::/32",
	} {
		ps = append(ps, netip.MustParsePrefix(s))
	}
	return ps
}()

// fromCloudflare says whether an address is Cloudflare's.
func fromCloudflare(a netip.Addr) bool {
	for _, p := range cloudflare {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// peer is the address the connection comes from (the zero Addr if it can't be read).
func peer(r *http.Request) netip.Addr {
	if ap, err := netip.ParseAddrPort(r.RemoteAddr); err == nil {
		return ap.Addr().Unmap()
	}
	a, _ := netip.ParseAddr(r.RemoteAddr)
	return a.Unmap()
}

// spoofed is the problem of a request with CF-Connecting-IP from an address that isn't Cloudflare's.
const spoofed = "a request came with CF-Connecting-IP from outside Cloudflare's addresses: the server is reachable " +
	"past Cloudflare, or Cloudflare has new addresses (server/address.go)"

// clientAddr is the player's address: CF-Connecting-IP when the connection is Cloudflare's, else the connection's own.
func (s *Server) clientAddr(r *http.Request) netip.Addr {
	p := peer(r)
	if !s.cfg.TrustCloudflare {
		return p
	}
	h := r.Header.Get("CF-Connecting-IP")
	if h == "" {
		return p
	}
	if !fromCloudflare(p) {
		s.problems.add(spoofed)
		return p
	}
	a, err := netip.ParseAddr(h)
	if err != nil {
		return p
	}
	return a.Unmap()
}

// clientIP is the player's address as the log writes it.
func (s *Server) clientIP(r *http.Request) string {
	if a := s.clientAddr(r); a.IsValid() {
		return a.String()
	}
	return r.RemoteAddr
}

// clientNet is the network a limit on an address counts by: an IPv4 address, or the /64 of an IPv6 one.
func (s *Server) clientNet(r *http.Request) string { return network(s.clientAddr(r), 64) }

// clientSite is the wider network a limit counts by as well: the /48 of an IPv6 address, the /24 of an IPv4 one.
func (s *Server) clientSite(r *http.Request) string { return site(s.clientAddr(r)) }

// clientHome is what the keys only counted are kept by: the /48 of an IPv6 address, an IPv4 address as it is.
func (s *Server) clientHome(r *http.Request) string { return network(s.clientAddr(r), 48) }

// network is the prefix of bits around an IPv6 address, or an IPv4 address as it is.
func network(a netip.Addr, bits int) string {
	if !a.IsValid() {
		return "unknown"
	}
	if a.Is4() {
		return a.String()
	}
	p, _ := a.Prefix(bits)
	return p.String()
}

// site is the /48 around an IPv6 address, or the /24 around an IPv4 one.
func site(a netip.Addr) string {
	if !a.IsValid() {
		return "unknown"
	}
	bits := 48
	if a.Is4() {
		bits = 24
	}
	p, _ := a.Prefix(bits)
	return p.String()
}

// allowFrom counts one of what from the request's network, and says whether that's within n a period; and, with
// site above 0, within site a period from its site too (clientSite). For the limits that keep players safe, guardFrom.
func (s *Server) allowFrom(r *http.Request, what string, n, site int, per time.Duration) bool {
	return s.from(s.limits, r, what, n, site, per)
}

// guardFrom is allowFrom in the guard's limiter (Server.guard), which no flood of other keys can push a count out of.
func (s *Server) guardFrom(r *http.Request, what string, n, site int, per time.Duration) bool {
	return s.from(s.guard, r, what, n, site, per)
}

// from counts one of what from the request's network and site in l. Once the site's budget is spent, nothing more is
// counted, so no new key is made for a network of it: one site makes at most site keys a period, however many of its
// networks it sends from.
func (s *Server) from(l *limiter, r *http.Request, what string, n, site int, per time.Duration) bool {
	wide := what + ":site:" + s.clientSite(r)
	if site > 0 && l.spent(wide, site) {
		return false
	}
	if !l.allow(what+":"+s.clientNet(r), n, per) {
		return false
	}
	return site <= 0 || l.allow(wide, site, per)
}
