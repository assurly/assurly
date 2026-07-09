#!/usr/bin/env bash
# Prints npm download counts for all published Assurly packages.
# Downloads are a rough popularity proxy, not a user count — the registry's
# own mirrors, security scanners (Socket.dev, Snyk, OSS Index), and CI caches
# fetch every new package automatically, especially in the first few days.
set -euo pipefail

PACKAGES=("assurly" "@assurly/scanner-core" "@assurly/mcp-server")
PERIODS=("last-day" "last-week" "last-month")

fetch_downloads() {
  local pkg="$1" period="$2"
  local encoded="${pkg/@/%40}"
  curl -s "https://api.npmjs.org/downloads/point/${period}/${encoded}" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('downloads','-'))" 2>/dev/null || echo "-"
}

printf "%-24s %10s %10s %10s\n" "package" "day" "week" "month"
printf "%-24s %10s %10s %10s\n" "-------" "---" "----" "-----"
for pkg in "${PACKAGES[@]}"; do
  day=$(fetch_downloads "$pkg" "last-day")
  week=$(fetch_downloads "$pkg" "last-week")
  month=$(fetch_downloads "$pkg" "last-month")
  printf "%-24s %10s %10s %10s\n" "$pkg" "$day" "$week" "$month"
done

echo ""
echo "Trend charts: https://npm-stat.com/charts.html?package=assurly&package=%40assurly%2Fscanner-core&package=%40assurly%2Fmcp-server"
