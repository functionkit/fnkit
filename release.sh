#!/bin/bash
# Release script for FNKIT CLI
# Usage: ./release.sh [major|minor|patch] or ./release.sh v1.2.3

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get current version from package.json
CURRENT_VERSION=$(grep '"version"' package.json | sed 's/.*"version": "\(.*\)".*/\1/')
echo -e "${YELLOW}Current version: v${CURRENT_VERSION}${NC}"

# Parse version components
IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# Determine new version
if [ -z "$1" ]; then
    echo -e "${YELLOW}Usage: ./release.sh [major|minor|patch|vX.Y.Z]${NC}"
    echo "  major  - Bump major version (1.0.0 -> 2.0.0)"
    echo "  minor  - Bump minor version (1.0.0 -> 1.1.0)"
    echo "  patch  - Bump patch version (1.0.0 -> 1.0.1)"
    echo "  vX.Y.Z - Set specific version"
    exit 1
fi

case "$1" in
    major)
        MAJOR=$((MAJOR + 1))
        MINOR=0
        PATCH=0
        ;;
    minor)
        MINOR=$((MINOR + 1))
        PATCH=0
        ;;
    patch)
        PATCH=$((PATCH + 1))
        ;;
    v*)
        # Extract version from vX.Y.Z format
        NEW_VERSION="${1#v}"
        IFS='.' read -r MAJOR MINOR PATCH <<< "$NEW_VERSION"
        ;;
    *)
        echo -e "${RED}Invalid argument: $1${NC}"
        exit 1
        ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
TAG="v${NEW_VERSION}"

echo -e "${GREEN}New version: ${TAG}${NC}"

# Confirm
read -p "Continue with release ${TAG}? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
fi

# Update package.json
echo -e "${YELLOW}Updating package.json...${NC}"
sed -i.bak "s/\"version\": \".*\"/\"version\": \"${NEW_VERSION}\"/" package.json
rm -f package.json.bak

# Update version in src/index.ts
echo -e "${YELLOW}Updating src/index.ts...${NC}"
sed -i.bak "s/const VERSION = '.*'/const VERSION = '${NEW_VERSION}'/" src/index.ts
rm -f src/index.ts.bak

# Commit changes
echo -e "${YELLOW}Committing changes...${NC}"
git add package.json src/index.ts
git commit -m "chore: bump version to ${TAG}"

# Create tag
echo -e "${YELLOW}Creating tag ${TAG}...${NC}"
git tag -a "${TAG}" -m "Release ${TAG}"

# Push
echo -e "${YELLOW}Pushing to origin...${NC}"
git push origin main || git push origin master
git push origin "${TAG}"

echo ""
echo -e "${GREEN}✓ Released ${TAG}!${NC}"
echo ""
echo "GitHub Actions will now build binaries for all platforms."
echo "Check the release at: https://github.com/functionkit/fnkit/releases/tag/${TAG}"
