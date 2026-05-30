#!/bin/bash
set -e

echo ">>> Unpacking project files..."
tar -xzvf deploy.tar.gz

echo ">>> Checking for Docker..."
if ! command -v docker &> /dev/null; then
    echo ">>> Installing Docker..."
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl gnupg
    sudo install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    sudo chmod a+r /etc/apt/keyrings/docker.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    sudo usermod -aG docker $USER
    echo ">>> Docker installed. You might need to log out and log back in for docker group changes to take effect."
else
    echo ">>> Docker is already installed."
fi

# Ensure docker daemon is accessible for this script run
sudo chmod 666 /var/run/docker.sock || true

echo ">>> Building NotificationTracker APK..."
cd android-tracker
# Run the build script which uses Docker
bash build.sh
cd ..

echo ">>> Starting Backend Services..."
cd backend
# Build the backend image and start the stack
docker compose up -d --build

echo ">>> Backend is running on port 3001 and ws-scrcpy on port 8000!"
