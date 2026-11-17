// Package banktest gives tests the public sample bank (bank/sample), loaded once per test program and shared: tests
// only read it, and loading it for every test was a good part of their time.
package banktest

import (
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/almanac-bg/almanac/internal/bank"
)

var (
	once     sync.Once
	sample   *bank.Bank
	problems []bank.Problem
)

// Sample is the sample bank. Every test of the program gets the same one, so a test that changes a question (retires
// it, dates it) loads its own with bank.Load instead.
func Sample(t testing.TB) *bank.Bank {
	t.Helper()
	once.Do(func() {
		_, here, _, _ := runtime.Caller(0)
		sample, problems = bank.Load(filepath.Join(filepath.Dir(here), "../../../bank/sample"))
	})
	if sample == nil {
		t.Fatal(problems)
	}
	return sample
}
