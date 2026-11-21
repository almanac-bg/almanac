package bank

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// lineWidth is how wide the bank's files are written: a value that fits stays on one line, a longer one opens up.
const lineWidth = 120

// Format writes questions the one way the bank's files are kept: fields in a fixed order, short values on one line,
// longer ones opened up. Tools that edit the bank write through it, so a change shows in a diff as just that change.
// It sets the typography the bank keeps one way too (tidy: „…“, the dash, „г.“ held to its year), so that nobody has
// to remember it.
func Format(questions []Question) ([]byte, error) {
	items := make([]any, len(questions))
	for i, q := range questions {
		items[i] = q
	}
	return format(items)
}

// format is Format of questions, or of a question as its file had it (json.RawMessage: a leftover, bank.go).
func format(items []any) ([]byte, error) {
	if len(items) == 0 {
		return []byte("[]\n"), nil
	}
	var b bytes.Buffer
	b.WriteString("[\n")
	for i, q := range items {
		raw, err := marshal(q)
		if err != nil {
			return nil, err
		}
		n, err := parseNode(raw)
		if err != nil {
			return nil, err
		}
		b.WriteString("  ")
		n.expand(&b, 1)
		if i < len(items)-1 {
			b.WriteByte(',')
		}
		b.WriteByte('\n')
	}
	b.WriteString("]\n")
	return b.Bytes(), nil
}

// Write writes a category's file of the bank into a bank directory: its questions as Format keeps them, a question
// changed (by its id) in its place, more at the end, and the questions of a retired kind the file had (RetiredKinds)
// as they were, where they were, unless changed names them (a question of a retired kind made one the game has).
func (b *Bank) Write(dir, category string, changed map[string]Question, more []Question) error {
	var items []any
	add := func(after string) {
		for {
			found := false
			for id, l := range b.left {
				if l.category != category || l.after != after {
					continue
				}
				if q, ok := changed[id]; ok {
					items = append(items, q)
				} else {
					items = append(items, l.raw)
				}
				after, found = id, true
				break
			}
			if !found {
				return
			}
		}
	}
	add("")
	for _, q := range b.InCategory(category) {
		if c, ok := changed[q.Base().ID]; ok {
			items = append(items, c)
		} else {
			items = append(items, q)
		}
		add(q.Base().ID)
	}
	for _, q := range more {
		items = append(items, q)
	}
	return writeCategory(dir, category, items)
}

// writeCategory writes a category's file into a bank directory.
func writeCategory(dir, category string, items []any) error {
	data, err := format(items)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(dir, QuestionsDir), 0o755); err != nil {
		return err
	}
	return writeFile(filepath.Join(dir, QuestionsDir, category+".json"), data)
}

// WriteCategories writes categories.json.
func WriteCategories(dir string, categories []Category) error {
	var b bytes.Buffer
	b.WriteString("[\n")
	for i, c := range categories {
		raw, err := marshal(c)
		if err != nil {
			return err
		}
		b.WriteString("  ")
		b.Write(spaced(raw))
		if i < len(categories)-1 {
			b.WriteByte(',')
		}
		b.WriteByte('\n')
	}
	b.WriteString("]\n")
	return writeFile(filepath.Join(dir, CategoriesFile), b.Bytes())
}

// writeFile replaces a file whole or not at all: a crash halfway never leaves half a bank.
func writeFile(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// marshal is json.Marshal without escaping <, > and &: the bank is read by people too.
func marshal(v any) ([]byte, error) {
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSpace(b.Bytes()), nil
}

// node is a JSON value with its object keys kept in order.
type node struct {
	scalar json.RawMessage // a string, number, true, false or null
	keys   []string        // an object's keys, in order
	vals   []*node         // an object's values, or an array's items
	object bool
}

func parseNode(raw []byte) (*node, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	return readNode(dec)
}

func readNode(dec *json.Decoder) (*node, error) {
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch t := tok.(type) {
	case json.Delim:
		n := &node{object: t == '{'}
		for dec.More() {
			if n.object {
				key, err := dec.Token()
				if err != nil {
					return nil, err
				}
				n.keys = append(n.keys, key.(string))
			}
			v, err := readNode(dec)
			if err != nil {
				return nil, err
			}
			n.vals = append(n.vals, v)
		}
		if _, err := dec.Token(); err != nil {
			return nil, err
		}
		return n, nil
	case string:
		s, err := marshal(tidy(t))
		return &node{scalar: s}, err
	case json.Number:
		return &node{scalar: json.RawMessage(t.String())}, nil
	case bool:
		return &node{scalar: json.RawMessage(fmt.Sprint(t))}, nil
	case nil:
		return &node{scalar: json.RawMessage("null")}, nil
	}
	return nil, errors.New("unexpected JSON token")
}

// inline is the value on one line, with a space after each colon and comma.
func (n *node) inline() string {
	if n.scalar != nil {
		return string(n.scalar)
	}
	parts := make([]string, len(n.vals))
	for i, v := range n.vals {
		parts[i] = v.inline()
		if n.object {
			key, _ := marshal(n.keys[i])
			parts[i] = string(key) + ": " + parts[i]
		}
	}
	if n.object {
		return "{" + strings.Join(parts, ", ") + "}"
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// write puts the value on one line if it fits after what the line already holds, else opens it up.
func (n *node) write(b *bytes.Buffer, depth, used int) {
	if s := n.inline(); n.scalar != nil || used+utf8.RuneCountInString(s) <= lineWidth {
		b.WriteString(s)
		return
	}
	n.expand(b, depth)
}

// expand writes an object or array one member per line.
func (n *node) expand(b *bytes.Buffer, depth int) {
	open, close := "[", "]"
	if n.object {
		open, close = "{", "}"
	}
	if len(n.vals) == 0 {
		b.WriteString(open + close)
		return
	}
	indent := strings.Repeat("  ", depth+1)
	b.WriteString(open + "\n")
	for i, v := range n.vals {
		b.WriteString(indent)
		used := len(indent)
		if n.object {
			key, _ := marshal(n.keys[i])
			b.WriteString(string(key) + ": ")
			used += utf8.RuneCount(key) + 2
		}
		v.write(b, depth+1, used+1)
		if i < len(n.vals)-1 {
			b.WriteByte(',')
		}
		b.WriteByte('\n')
	}
	b.WriteString(strings.Repeat("  ", depth) + close)
}

// spaced is compact JSON with a space after each colon and comma (one line).
func spaced(raw []byte) []byte {
	n, err := parseNode(raw)
	if err != nil {
		return raw
	}
	return []byte(n.inline())
}
