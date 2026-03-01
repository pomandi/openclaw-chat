#!/bin/bash
# Copy Silero VAD + ONNX runtime assets to public/vad/ for browser access
set -e

DEST="public/vad"
mkdir -p "$DEST"

# Silero VAD model (v5) + worklet
cp node_modules/@ricky0123/vad-web/dist/silero_vad_v5.onnx "$DEST/"
cp node_modules/@ricky0123/vad-web/dist/vad.worklet.bundle.min.js "$DEST/"

# ONNX Runtime WASM files (SIMD threaded)
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm "$DEST/"
cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs "$DEST/"

echo "VAD assets copied to $DEST/"
