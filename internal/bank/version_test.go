package bank

import (
	"encoding/json"
	"testing"
)

// A question's version is what it asks: kept and read back, it's the same question, dealt alike; its labels, fact and
// dates don't make another version, what it asks does.
func TestVersion(t *testing.T) {
	b := loadSample(t)
	seen := map[string]string{}
	for _, q := range b.Questions {
		v := Version(q)
		if len(v) != 16 || v != versionOf(q) {
			t.Fatalf("%s: version %q", q.Base().ID, v)
		}
		if other, dup := seen[v]; dup {
			t.Fatalf("%s and %s have one version", q.Base().ID, other)
		}
		seen[v] = q.Base().ID
		data, err := Encode(q)
		if err != nil {
			t.Fatal(err)
		}
		back, err := Decode(data, q.Base().Category)
		if err != nil {
			t.Fatal(err)
		}
		if Version(back) != v || back.Base().Category != q.Base().Category {
			t.Fatalf("%s read back as another version", q.Base().ID)
		}
		a, _ := json.Marshal(q.Deal(42).View())
		c, _ := json.Marshal(back.Deal(42).View())
		if string(a) != string(c) {
			t.Fatalf("%s read back deals as %s, not %s", q.Base().ID, c, a)
		}
	}
	q := b.Questions[0]
	data, _ := Encode(q)
	var fields map[string]any
	_ = json.Unmarshal(data, &fields)
	fields["fact"], fields["difficulty"], fields["updated"] = "Друго.", "hard", "2026-11-20"
	data, _ = json.Marshal(fields)
	labelled, _ := Decode(data, q.Base().Category)
	if Version(labelled) != Version(q) {
		t.Fatal("a new fact or label makes another version")
	}
	fields["text"] = fields["text"].(string) + " Отново?"
	data, _ = json.Marshal(fields)
	asked, _ := Decode(data, q.Base().Category)
	if Version(asked) == Version(q) {
		t.Fatal("another text keeps the version")
	}
	if _, err := Decode([]byte(`{"id":"x-1","type":"nothing"}`), "x"); err == nil {
		t.Fatal("an unknown type read back")
	}
}
