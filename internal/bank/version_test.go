package bank

import (
	"cmp"
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
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

// pinnedVersions are questions as the game keeps them (question_versions: Encode), each with the Version it was kept
// under, one or more of every type. A version is how a play finds what it showed again, after the bank moved on and
// over a restart: if one of these moves, every version kept moves with it, and every play, review and
// recording of them is lost (play: pastVersion refuses a version that reads back as another). They're written out
// here, not taken from the sample bank, which changes.
var pinnedVersions = []struct{ body, version string }{
	{`{"id":"gen-1","type":"choice","difficulty":"easy","text":"Коя е столицата на Франция?","answer":"Париж","wrong":["Лион","Марсилия","Ница"],"fact":"Париж е столица от 987 г.","added":"2026-01-02","sources":["https://bg.wikipedia.org/wiki/Париж"]}`, "05c46870b659c4c4"},
	{`{"id":"gen-2","type":"choice","difficulty":"medium","text":"Кое е знамето на Франция?","answer":"Франция","wrong":["Италия","Ирландия","Белгия"],"pictures":[{"file":"a1.webp","w":600,"h":400,"alt":"Знаме","credit":"Някой","license":"PD","source":"https://commons.wikimedia.org/a"},{"file":"b2.webp","w":600,"h":400,"alt":"Знаме","credit":"Някой","license":"CC BY-SA","licenseVersion":"4.0","source":"https://commons.wikimedia.org/b"},{"file":"c3.webp","w":600,"h":400,"alt":"Знаме","credit":"Някой","license":"PD","source":"https://commons.wikimedia.org/c"},{"file":"d4.webp","w":600,"h":400,"alt":"Знаме","credit":"Някой","license":"PD","source":"https://commons.wikimedia.org/d"}],"added":"2026-01-02"}`, "c2f8c236538dfaf5"},
	{`{"id":"geo-3","type":"choice","difficulty":"hard","text":"Кой връх е на снимката?","answer":"Мусала","wrong":["Вихрен","Ботев","Черни връх"],"image":{"file":"e5.webp","w":800,"h":600,"alt":"Връх","credit":"Някой","license":"CC BY","licenseVersion":"2.0","source":"https://commons.wikimedia.org/e"},"bg":true,"on":["03-03"],"day":"Днес е денят."}`, "b9f8ae9ca31ec6be"},
	{`{"id":"sci-4","type":"truefalse","difficulty":"easy","text":"Водата кипи при 50 °C.","answer":false}`, "8288fdebf9bcab3c"},
	{`{"id":"sci-5","type":"truefalse","difficulty":"easy","text":"Земята е кръгла.","answer":true,"reviewBy":"2030-01-01"}`, "0287bc9a49773402"},
	{`{"id":"geo-6","type":"number","difficulty":"hard","text":"Колко метра е висок Мусала?","answer":2925.4,"unit":"м","step":0.1,"scale":"linear","tolerance":0.05}`, "2de28b074ce1a9dd"},
	{`{"id":"his-7","type":"number","difficulty":"medium","text":"В коя година е Съединението?","answer":1885,"step":1,"scale":"linear","tolerance":0}`, "6acdbd8361a964bc"},
	{`{"id":"geo-8","type":"order","difficulty":"medium","text":"Подреди по височина.","items":[{"text":"Мусала","value":2925},{"text":"Вихрен","value":2914},{"text":"Ботев","value":2376},{"text":"Черни връх","value":2290}],"direction":"desc","unit":"м"}`, "f228e6bad1556dc2"},
	{`{"id":"his-9","type":"order","difficulty":"medium","text":"Подреди по година.","items":[{"text":"А","value":681},{"text":"Б","value":864},{"text":"В","value":1185},{"text":"Г","value":1396}],"direction":"asc"}`, "7a68262020c43f75"},
	{`{"id":"geo-10","type":"match","difficulty":"medium","text":"Свържи държавите със столиците им.","pairs":[{"left":"Франция","right":"Париж"},{"left":"Италия","right":"Рим"},{"left":"Испания","right":"Мадрид"},{"left":"Германия","right":"Берлин"}],"decoy":"Милано"}`, "6fb143f1d760a23a"},
	{`{"id":"geo-11","type":"match","difficulty":"medium","text":"Свържи реките с моретата.","pairs":[{"left":"Дунав","right":"Черно"},{"left":"Нил","right":"Средиземно"},{"left":"Волга","right":"Каспийско"},{"left":"Рейн","right":"Северно"}]}`, "f4d80441329fcf1c"},
	{`{"id":"nat-12","type":"split","difficulty":"medium","text":"Бозайник или птица?","groups":["Бозайник","Птица"],"items":[{"text":"Кит","group":0},{"text":"Прилеп","group":0},{"text":"Пингвин","group":1},{"text":"Щраус","group":1},{"text":"Делфин","group":0},{"text":"Киви","group":1}]}`, "0cd1a664c03f3b19"},
	{`{"id":"lit-13","type":"clues","difficulty":"hard","text":"Кой е писателят?","clues":["Роден в Сопот.","Пише „Под игото“.","Наричат го патриарх."],"answer":"Иван Вазов","wrong":["Христо Ботев","Алеко Константинов","Пейо Яворов"],"retired":true,"retiredWhy":"weak"}`, "851717c6e2b77c70"},
}

// A version kept reads back as itself, from what was kept and from what this program encodes of it: a change to a
// type (a field gained, renamed, reshaped) that moves a version fails here, before it loses every version kept.
func TestPinnedVersions(t *testing.T) {
	pinned := map[string]bool{}
	for _, p := range pinnedVersions {
		q, err := Decode([]byte(p.body), "x")
		if err != nil {
			t.Fatal(err)
		}
		id := q.Base().ID
		pinned[q.Base().Type] = true
		if v := Version(q); v != p.version {
			t.Errorf("%s: version %s, kept as %s. What a version is hashed from has changed (askedForm): every version "+
				"kept would move, and the plays of them be lost. Put a field a type gains in its form only where it's "+
				"set; a type changed on purpose needs a migration that rewrites question_versions and runs' versions.",
				id, v, p.version)
			continue
		}
		data, err := Encode(q)
		if err != nil {
			t.Fatal(err)
		}
		back, err := Decode(data, "x")
		if err != nil || Version(back) != p.version {
			t.Errorf("%s: encoded by this program, it reads back as another version (%v)", id, err)
		}
	}
	for _, typ := range Types() {
		if !pinned[typ] {
			t.Errorf("no version of a %s pinned: add one, as the game would keep it (Encode), with its version", typ)
		}
	}
}

// pictureLabels are a picture's fields that aren't what a question asks: its size, description, credit and licence.
// The picture itself is its file (its name is its content's hash).
var pictureLabels = map[string]bool{
	"w": true, "h": true, "alt": true, "credit": true, "license": true, "licenseVersion": true, "source": true,
}

// Every field of every type is classed: set to something else, it makes another version (it's what the question asks:
// in its form, askedForm) or it doesn't (notAsked: a label, the fact, a date; or a picture's label). A field a type
// gains that's in neither fails here: say which it is.
func TestEveryFieldClassed(t *testing.T) {
	for _, typ := range Types() {
		q := types[typ]()
		n := 0
		fill(reflect.ValueOf(q).Elem(), &n)
		q.Base().Type = typ
		base := versionOf(q)
		leaves(reflect.ValueOf(q).Elem(), "", func(path string, v reflect.Value) {
			was := reflect.New(v.Type()).Elem()
			was.Set(v)
			tweak(v)
			moved := versionOf(q) != base
			v.Set(was)
			top, rest, _ := strings.Cut(strings.ReplaceAll(path, "[]", ""), ".")
			asked := !notAsked[top]
			if top == "image" || top == "pictures" {
				asked = rest == "file" || !pictureLabels[rest]
			}
			switch {
			case asked && !moved:
				t.Errorf("%s %s: changing it keeps the version. If it's what the question asks, put it in the type's "+
					"asked (only where it's set, so that no version kept moves); if it isn't, in notAsked", typ, path)
			case !asked && moved:
				t.Errorf("%s %s: a label (notAsked) that makes another version", typ, path)
			}
		})
	}
}

// fill sets every field a JSON value of v has to something of its own (n counts), lists to two of each.
func fill(v reflect.Value, n *int) {
	*n++
	switch v.Kind() {
	case reflect.String:
		v.SetString(fmt.Sprintf("x%d", *n))
	case reflect.Float32, reflect.Float64:
		v.SetFloat(float64(*n) + 0.5)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(int64(*n))
	case reflect.Bool:
		v.SetBool(true)
	case reflect.Pointer:
		v.Set(reflect.New(v.Type().Elem()))
		fill(v.Elem(), n)
	case reflect.Slice:
		v.Set(reflect.MakeSlice(v.Type(), 2, 2))
		for i := range v.Len() {
			fill(v.Index(i), n)
		}
	case reflect.Array:
		for i := range v.Len() {
			fill(v.Index(i), n)
		}
	case reflect.Struct:
		for i := range v.NumField() {
			if f := v.Type().Field(i); f.IsExported() && f.Tag.Get("json") != "-" {
				fill(v.Field(i), n)
			}
		}
	}
}

// leaves calls fn with every value of v that a JSON value of it holds (a string, a number, a truth), by its path:
// "text", "items[].value", "image.file".
func leaves(v reflect.Value, path string, fn func(string, reflect.Value)) {
	switch v.Kind() {
	case reflect.Pointer:
		leaves(v.Elem(), path, fn)
	case reflect.Slice, reflect.Array:
		for i := range v.Len() {
			leaves(v.Index(i), path+"[]", fn)
		}
	case reflect.Struct:
		for i := range v.NumField() {
			f := v.Type().Field(i)
			tag, _, _ := strings.Cut(f.Tag.Get("json"), ",")
			if !f.IsExported() || tag == "-" {
				continue
			}
			switch name := cmp.Or(tag, f.Name); {
			case f.Anonymous && tag == "":
				leaves(v.Field(i), path, fn) // Head, Tail: their fields are the question's
			case path == "":
				leaves(v.Field(i), name, fn)
			default:
				leaves(v.Field(i), path+"."+name, fn)
			}
		}
	default:
		fn(path, v)
	}
}

// tweak changes a value a little.
func tweak(v reflect.Value) {
	switch v.Kind() {
	case reflect.String:
		v.SetString(v.String() + "!")
	case reflect.Float32, reflect.Float64:
		v.SetFloat(v.Float() + 1)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		v.SetInt(v.Int() + 1)
	case reflect.Bool:
		v.SetBool(!v.Bool())
	}
}
