#!/bin/bash
# Generate test archive for performance testing
# Usage: ./scripts/generate-test-archive.sh [entry_count] [output_path]

ENTRY_COUNT=${1:-1000}
OUTPUT_PATH=${2:-"test-large.zip"}

echo "Generating test archive with $ENTRY_COUNT entries..."

# Create temp directory
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

# Create files
for i in $(seq 1 $ENTRY_COUNT); do
    echo "Test content for file $i" > "$TEMP_DIR/file-$i.txt"
    
    if [ $((i % 1000)) -eq 0 ]; then
        echo "Created $i files..."
    fi
done

# Create zip archive
cd "$TEMP_DIR"
zip -r "$OUTPUT_PATH" . > /dev/null
mv "$OUTPUT_PATH" "$(pwd)/$OUTPUT_PATH" 2>/dev/null || true

echo "Done! Archive created: $OUTPUT_PATH"
echo "Archive size: $(stat -f%z "$OUTPUT_PATH" 2>/dev/null || stat -c%s "$OUTPUT_PATH") bytes"


