#!/bin/bash
# Benchmark claude-hud performance against the 300ms budget
# Usage: ./scripts/benchmark.sh [iterations]

ITERATIONS=${1:-20}
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
RUNTIME=$(command -v bun 2>/dev/null || command -v node 2>/dev/null)
SOURCE="$SCRIPT_DIR/dist/index.js"

if command -v bun >/dev/null 2>&1; then
  SOURCE="$SCRIPT_DIR/src/index.ts"
fi

SAMPLE='{"model":{"display_name":"Opus 4.6"},"context_window":{"current_usage":{"input_tokens":90000,"output_tokens":5000},"context_window_size":200000}}'

echo "Benchmarking claude-hud ($ITERATIONS iterations)"
echo "Runtime: $RUNTIME"
echo "Source: $SOURCE"
echo "---"

total=0
max=0
min=999999

# Portable millisecond timestamp: use GNU date if available, else python3
ms_now() {
  if date +%s%3N 2>/dev/null | grep -qE '^[0-9]{13}$'; then
    date +%s%3N
  else
    python3 -c 'import time; print(int(time.time()*1000))'
  fi
}

for i in $(seq 1 $ITERATIONS); do
  start=$(ms_now)
  echo "$SAMPLE" | "$RUNTIME" "$SOURCE" > /dev/null 2>&1
  end=$(ms_now)
  elapsed=$((end - start))
  total=$((total + elapsed))

  if [ $elapsed -gt $max ]; then max=$elapsed; fi
  if [ $elapsed -lt $min ]; then min=$elapsed; fi

  printf "  Run %2d: %dms\n" "$i" "$elapsed"
done

avg=$((total / ITERATIONS))
echo "---"
echo "Results:"
echo "  Average: ${avg}ms"
echo "  Min:     ${min}ms"
echo "  Max:     ${max}ms"
echo "  Budget:  300ms"

if [ $avg -le 300 ]; then
  echo "  Status:  ✓ WITHIN BUDGET"
else
  echo "  Status:  ✘ OVER BUDGET (${avg}ms > 300ms)"
fi
