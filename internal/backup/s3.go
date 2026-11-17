package backup

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"
)

// Store is a bucket in S3-compatible storage.
type Store struct {
	// Endpoint is the storage's address (R2: https://<account>.eu.r2.cloudflarestorage.com).
	Endpoint string
	Bucket   string
	// AccessKey and SecretKey are an access key pair allowed to read, write and list the bucket's objects.
	AccessKey, SecretKey string
	// Region is the signing region ("auto" for R2).
	Region string
	Client *http.Client
}

// maxPut is the most one PUT may carry (R2's and S3's limit for a single upload).
const maxPut = 5 << 30

func (s *Store) client() *http.Client {
	if s.Client != nil {
		return s.Client
	}
	// No timeout on the whole, as a copy of gigabytes takes its time (the caller's context bounds it); a storage that
	// doesn't answer still ends it.
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.ResponseHeaderTimeout = 5 * time.Minute
	return &http.Client{Transport: t}
}

func (s *Store) url(key string, query url.Values) (*url.URL, error) {
	path := strings.TrimSuffix(s.Endpoint, "/") + "/" + s.Bucket
	if key != "" {
		path += "/" + key
	}
	u, err := url.Parse(path)
	if err != nil || u.Scheme != "https" && u.Hostname() != "127.0.0.1" {
		return nil, errors.New("the backup endpoint must be an https:// address")
	}
	u.RawQuery = query.Encode()
	return u, nil
}

// Put stores what body holds under key, with meta as the object's metadata (x-amz-meta-*, and sha256: the body's
// hash). The body is read twice: once for its hash, which the storage checks what it receives against, and once to
// send it.
func (s *Store) Put(ctx context.Context, key string, body io.ReadSeeker, meta map[string]string) error {
	h := sha256.New()
	size, err := io.Copy(h, body)
	if err != nil {
		return err
	}
	if size > maxPut {
		return fmt.Errorf("%s: %d bytes is more than one upload may carry", key, size)
	}
	if _, err := body.Seek(0, io.SeekStart); err != nil {
		return err
	}
	u, err := s.url(key, nil)
	if err != nil {
		return err
	}
	// The body as a plain reader: http would otherwise close a file it was given.
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u.String(), io.NopCloser(io.LimitReader(body, size)))
	if err != nil {
		return err
	}
	req.ContentLength = size
	sum := hex.EncodeToString(h.Sum(nil))
	for k, v := range meta {
		req.Header.Set("x-amz-meta-"+k, v)
	}
	req.Header.Set("x-amz-meta-sha256", sum) // to check it against later without opening it (Intact)
	sign(req, s.AccessKey, s.SecretKey, s.Region, sum, time.Now())
	res, err := s.do(req)
	if err != nil {
		return err
	}
	return res.Body.Close()
}

// ErrMissing is the error for a key the bucket doesn't have.
var ErrMissing = errors.New("no such copy")

// Get opens what's stored under key, to be read as it comes; the header has its metadata. The caller closes it.
func (s *Store) Get(ctx context.Context, key string) (io.ReadCloser, http.Header, error) {
	u, err := s.url(key, nil)
	if err != nil {
		return nil, nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, nil, err
	}
	sign(req, s.AccessKey, s.SecretKey, s.Region, emptyHash, time.Now())
	res, err := s.do(req)
	if err != nil {
		return nil, nil, err
	}
	return res.Body, res.Header, nil
}

// Object is one object in the bucket, as a listing gives it.
type Object struct {
	Key      string
	Size     int64
	Modified time.Time
}

// List gives the objects whose keys start with prefix, newest first.
func (s *Store) List(ctx context.Context, prefix string) ([]Object, error) {
	var all []Object
	token := ""
	for {
		q := url.Values{"list-type": {"2"}, "prefix": {prefix}}
		if token != "" {
			q.Set("continuation-token", token)
		}
		u, err := s.url("", q)
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if err != nil {
			return nil, err
		}
		sign(req, s.AccessKey, s.SecretKey, s.Region, emptyHash, time.Now())
		res, err := s.do(req)
		if err != nil {
			return nil, err
		}
		var page struct {
			Contents []struct {
				Key          string
				Size         int64
				LastModified time.Time
			}
			IsTruncated           bool
			NextContinuationToken string
		}
		err = xml.NewDecoder(io.LimitReader(res.Body, 16<<20)).Decode(&page)
		res.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("listing %s: %w", prefix, err)
		}
		for _, c := range page.Contents {
			all = append(all, Object{Key: c.Key, Size: c.Size, Modified: c.LastModified})
		}
		if !page.IsTruncated || page.NextContinuationToken == "" {
			break
		}
		token = page.NextContinuationToken
	}
	slices.SortFunc(all, func(a, b Object) int {
		if c := b.Modified.Compare(a.Modified); c != 0 {
			return c
		}
		return strings.Compare(b.Key, a.Key)
	})
	return all, nil
}

// do sends a request; an answer other than 2xx is an error (ErrMissing for a 404), its body closed.
func (s *Store) do(req *http.Request) (*http.Response, error) {
	res, err := s.client().Do(req)
	if err != nil {
		return nil, err
	}
	if res.StatusCode/100 == 2 {
		return res, nil
	}
	defer res.Body.Close()
	what := req.Method + " " + req.URL.Path
	if res.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("%s: %w", what, ErrMissing)
	}
	msg, _ := io.ReadAll(io.LimitReader(res.Body, 512))
	return nil, fmt.Errorf("%s: %s %s", what, res.Status, bytes.TrimSpace(msg))
}

// emptyHash is the hash of an empty body (SHA-256, hex).
const emptyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// sign signs a request with AWS Signature Version 4: the host and every header already set, and the body's hash
// (SHA-256, hex).
func sign(req *http.Request, accessKey, secretKey, region, payloadHash string, now time.Time) {
	now = now.UTC()
	amzDate := now.Format("20060102T150405Z")
	day := now.Format("20060102")
	req.Header.Set("x-amz-date", amzDate)
	req.Header.Set("x-amz-content-sha256", payloadHash)

	headers := map[string]string{"host": req.URL.Host}
	for k, v := range req.Header {
		headers[strings.ToLower(k)] = strings.TrimSpace(strings.Join(v, ","))
	}
	names := make([]string, 0, len(headers))
	for k := range headers {
		names = append(names, k)
	}
	slices.Sort(names)
	var canonHeaders strings.Builder
	for _, k := range names {
		canonHeaders.WriteString(k + ":" + headers[k] + "\n")
	}
	signed := strings.Join(names, ";")

	canonical := strings.Join([]string{
		req.Method,
		escapePath(req.URL.Path),
		req.URL.Query().Encode(),
		canonHeaders.String(),
		signed,
		payloadHash,
	}, "\n")
	scope := day + "/" + region + "/s3/aws4_request"
	hashed := sha256.Sum256([]byte(canonical))
	toSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(hashed[:])

	key := hmacSHA256([]byte("AWS4"+secretKey), day)
	for _, part := range []string{region, "s3", "aws4_request"} {
		key = hmacSHA256(key, part)
	}
	signature := hex.EncodeToString(hmacSHA256(key, toSign))
	req.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+accessKey+"/"+scope+
		", SignedHeaders="+signed+", Signature="+signature)
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

// escapePath encodes a path as S3 signs it: every byte but the unreserved ones and the slashes.
func escapePath(p string) string {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		c := p[i]
		if 'A' <= c && c <= 'Z' || 'a' <= c && c <= 'z' || '0' <= c && c <= '9' || strings.IndexByte("-._~/", c) >= 0 {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
