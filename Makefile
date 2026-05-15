.PHONY: dev build install clean

PORT ?= 18766
BINARY := ssh-open-server

-include .remote

dev:
	@echo "Starting dev servers (Go :$(PORT), Vite :5173)..."
	@trap 'kill 0' INT; \
	  go run . --dev --port $(PORT) & \
	  cd frontend && npm run dev & \
	  wait

build: frontend/node_modules
	cd frontend && npm run build
	go build -o $(BINARY) .

install: build
ifndef REMOTE_HOST
	$(error REMOTE_HOST is not set. Create a .remote file with: REMOTE_HOST=user@your-server)
endif
	ssh $(REMOTE_HOST) 'mkdir -p ~/.local/bin'
	scp $(BINARY) $(REMOTE_HOST):~/.local/bin/$(BINARY).new
	ssh $(REMOTE_HOST) 'mv ~/.local/bin/$(BINARY).new ~/.local/bin/$(BINARY)'
	scp scripts/ssh-open $(REMOTE_HOST):~/.local/bin/ssh-open
	@echo "Installed to $(REMOTE_HOST):~/.local/bin/"

frontend/node_modules:
	cd frontend && npm install

clean:
	rm -f $(BINARY)
	rm -rf frontend/dist
	touch frontend/dist/.gitkeep
