#!/usr/bin/env bash
# Runs the iPhone app in the iOS Simulator (macOS with Xcode only) and checks its self-test.
#   1. picks the newest available iPhone simulator, boots it, installs the app
#   2. launches it with its console attached; the test build (VITE_NATIVE_SELFTEST=1) prints
#      "[selftest] PASS/FAIL …" lines and finally "[selftest] DONE pass=N fail=M"
#   3. takes screenshots, then opens an app link (prometheaprograms://open/#/desk) like a
#      tapped alert would, and checks the app reports it
# Used by .github/workflows/ios.yml.
# Usage: scripts/ios-simulator-test.sh path/to/App.app [output-dir]
set -euo pipefail

APP="$1"
OUT="${2:-build/simulator}"
BUNDLE_ID="com.prometheaprograms.trader"
mkdir -p "$OUT"

xcrun simctl list devices available -j > "$OUT/devices.json"
UDID=$(python3 - "$OUT/devices.json" <<'PY'
import json, re, sys
devices = json.load(open(sys.argv[1]))["devices"]
best = None
for runtime, devs in devices.items():
    m = re.search(r"iOS-(\d+)-(\d+)", runtime)
    if not m:
        continue
    version = (int(m.group(1)), int(m.group(2)))
    for d in devs:
        name = d["name"]
        if d.get("isAvailable") and name.startswith("iPhone") and " SE" not in name and " e" not in name:
            key = (version, "Pro" in name and "Max" not in name, name)
            if best is None or key > best[0]:
                best = (key, d["udid"], name, runtime)
if not best:
    sys.exit("No iPhone simulator is available on this machine.")
print(f"Using {best[2]} ({best[3].split('.')[-1]})", file=sys.stderr)
print(best[1])
PY
)

xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"

LOG="$OUT/app-console.log"
: > "$LOG"
xcrun simctl launch --console-pty --terminate-running-process "$UDID" "$BUNDLE_ID" > "$LOG" 2>&1 &
LAUNCH_PID=$!

for _ in $(seq 1 150); do
  grep -aq '\[selftest\] DONE' "$LOG" && break
  sleep 1
done
sleep 2
xcrun simctl io "$UDID" screenshot "$OUT/1-selftest.png" || true

# Same thing iOS does when an alert's link is tapped.
xcrun simctl openurl "$UDID" 'prometheaprograms://open/#/desk' || true
for _ in $(seq 1 20); do
  grep -aq '\[selftest\] app link opened #/desk' "$LOG" && break
  sleep 1
done
sleep 5
xcrun simctl io "$UDID" screenshot "$OUT/2-trading-desk.png" || true

kill "$LAUNCH_PID" 2>/dev/null || true
xcrun simctl terminate "$UDID" "$BUNDLE_ID" 2>/dev/null || true

echo "---- self-test output from the app ----"
if ! grep -a '\[selftest\]' "$LOG"; then
  echo "The app printed no self-test output. Last 200 lines of its console:"
  tail -n 200 "$LOG"
  exit 1
fi

status=0
grep -aq '\[selftest\] DONE pass=[0-9]* fail=0' "$LOG" || { echo "::error::The in-app self-test reported failures (see above)."; status=1; }
grep -aq '\[selftest\] app link opened #/desk' "$LOG" || { echo "::error::Opening prometheaprograms://open/#/desk did not reach the app."; status=1; }
exit $status
