#!/usr/bin/env bash
# Manual test: send a geometry problem to the local LLM via ollama
# Usage: ./resources/prompts/test-manual.sh "Cho đường tròn (O) có đường kính CD..."
#        ./resources/prompts/test-manual.sh  (uses default problem)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SYSTEM_PROMPT="$(cat "$SCRIPT_DIR/system-prompt.txt")"
PROBLEM="${1:-Cho đường tròn (O) có đường kính CD, tiếp tuyến tại C là đường thẳng Cx. Lấy điểm E thuộc đường tròn (O) (E ≠ C, D). Qua O kẻ đường thẳng vuông góc với CE, cắt Cx tại A. a) Chứng minh rằng AE là tiếp tuyến của đường tròn (O).}"

ollama run qwen2.5:7b \
  --system "$SYSTEM_PROMPT" \
  "Convert this geometry problem into structured DSL.
Return ONLY one valid JSON object. No markdown.

Problem:
$PROBLEM"
