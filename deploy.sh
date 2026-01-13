#!/bin/bash
# ============================================
# Neon Arena - Auto Deploy Script
# Usage: ./deploy.sh "commit message"
# ============================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO_DIR="/workspace/neon-arena"
SSH_KEY="/workspace/deploy_key"

echo -e "${GREEN}🚀 Neon Arena Deploy Script${NC}"
echo "================================"

# Check for commit message
if [ -z "$1" ]; then
    echo -e "${YELLOW}Usage: ./deploy.sh \"commit message\"${NC}"
    exit 1
fi

# Configure git
cd "$REPO_DIR"
git config user.email "deploy@neon-arena" 2>/dev/null || true
git config user.name "MiniMax Agent" 2>/dev/null || true

echo "📁 Working in: $(pwd)"

# Add and commit
echo "📝 Committing changes..."
git add -A
git commit -m "$1" 2>/dev/null && echo "✅ Committed!" || echo "ℹ️  Nothing to commit"

# Push to GitHub
echo "🚀 Pushing to GitHub..."
GIT_SSH_COMMAND="ssh -i $SSH_KEY -o StrictHostKeyChecking=no" git push origin main

echo ""
echo -e "${GREEN}✅ Done! Don't forget to redeploy on Render.com${NC}"
