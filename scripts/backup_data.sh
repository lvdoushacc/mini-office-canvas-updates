#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

tar -czf "$BACKUP_DIR/xxpd-data-$STAMP.tar.gz" \
  -C "$ROOT_DIR" data assets output workflows

echo "Backup written to $BACKUP_DIR/xxpd-data-$STAMP.tar.gz"
