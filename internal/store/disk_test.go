package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The disk is low under 15% free, or under three times the database (its log included); unknown, it isn't said to be.
func TestDiskLow(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "almanac.db")
	if err := os.WriteFile(path, make([]byte, 2<<20), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path+"-wal", make([]byte, 1<<20), 0o600); err != nil {
		t.Fatal(err)
	}
	defer func(f func(string) (uint64, uint64, bool)) { spaceFree = f }(spaceFree)
	for _, c := range []struct {
		free, total uint64
		ok, low     bool
	}{
		{free: 50 << 20, total: 100 << 20, ok: true, low: false},
		{free: 14 << 20, total: 100 << 20, ok: true, low: true},   // under 15%
		{free: 8 << 20, total: 40 << 20, ok: true, low: true},     // 20%, but under 3× the 3 MB
		{free: 10 << 20, total: 100 << 20, ok: false, low: false}, // not known
	} {
		spaceFree = func(string) (uint64, uint64, bool) { return c.free, c.total, c.ok }
		low, room := DiskLow(path)
		if low != c.low || c.ok && !strings.Contains(room, "the database 3 MB") {
			t.Errorf("%d of %d MB: low %v (%s), want %v", c.free>>20, c.total>>20, low, room, c.low)
		}
	}
	spaceFree = freeSpace
	if _, room := DiskLow(path); room == "" {
		t.Error("the real disk isn't measured")
	}
}
