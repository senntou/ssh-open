package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

//go:embed all:frontend/dist
var embeddedFrontend embed.FS

type server struct {
	currentPath string
	mu          sync.RWMutex
	clients     map[chan string]struct{}
	clientsMu   sync.Mutex
	devMode     bool
}

type FileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
}

func newServer(devMode bool) *server {
	home, _ := os.UserHomeDir()
	return &server{
		currentPath: home,
		clients:     make(map[chan string]struct{}),
		devMode:     devMode,
	}
}

func (s *server) setPath(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	path := r.FormValue("path")
	if path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	s.mu.Lock()
	s.currentPath = abs
	s.mu.Unlock()
	s.broadcast(abs)
	fmt.Fprintln(w, abs)
}

func (s *server) getCurrentPath(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	path := s.currentPath
	s.mu.RUnlock()
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"path": path})
}

func (s *server) listFiles(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		s.mu.RLock()
		path = s.currentPath
		s.mu.RUnlock()
	}

	entries, err := os.ReadDir(path)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	files := make([]FileEntry, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		files = append(files, FileEntry{
			Name:    e.Name(),
			Path:    filepath.Join(path, e.Name()),
			IsDir:   e.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Unix(),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].IsDir != files[j].IsDir {
			return files[i].IsDir
		}
		return files[i].Name < files[j].Name
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (s *server) serveFile(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}
	http.ServeFile(w, r, path)
}

func (s *server) events(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch := make(chan string, 1)
	s.clientsMu.Lock()
	s.clients[ch] = struct{}{}
	s.clientsMu.Unlock()
	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, ch)
		s.clientsMu.Unlock()
	}()

	s.mu.RLock()
	current := s.currentPath
	s.mu.RUnlock()
	fmt.Fprintf(w, "data: %s\n\n", current)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}

	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case path := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", path)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		case <-r.Context().Done():
			return
		}
	}
}

func (s *server) broadcast(path string) {
	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for ch := range s.clients {
		select {
		case ch <- path:
		default:
		}
	}
}

func (s *server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/set-path", s.setPath)
	mux.HandleFunc("/api/current-path", s.getCurrentPath)
	mux.HandleFunc("/api/files", s.listFiles)
	mux.HandleFunc("/api/file", s.serveFile)
	mux.HandleFunc("/api/events", s.events)

	if !s.devMode {
		sub, err := fs.Sub(embeddedFrontend, "frontend/dist")
		if err != nil {
			log.Fatal(err)
		}
		mux.Handle("/", http.FileServer(http.FS(sub)))
	}

	return mux
}

func main() {
	port := flag.Int("port", 18766, "port to listen on")
	dev := flag.Bool("dev", false, "dev mode (don't serve embedded frontend)")
	flag.Parse()

	s := newServer(*dev)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("listening on %s (dev=%v)", addr, *dev)
	if err := http.ListenAndServe(addr, s.routes()); err != nil {
		log.Fatal(err)
	}
}
