#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ARTIFACT_DIR="${1:-$ROOT_DIR/.deploy/artifact}"

if [[ "$ARTIFACT_DIR" == "-h" || "$ARTIFACT_DIR" == "--help" ]]; then
  echo "Usage: $0 [artifact-dir]"
  exit 0
fi

rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"

cd "$ROOT_DIR"

npm run build

cp -a dist "$ARTIFACT_DIR/"
cp -a web "$ARTIFACT_DIR/"
cp -a package.json "$ARTIFACT_DIR/"
cp -a package-lock.json "$ARTIFACT_DIR/"
cp -a .env.example "$ARTIFACT_DIR/"

echo "Artifact ready: $ARTIFACT_DIR"
