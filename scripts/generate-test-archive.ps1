# Generate test archive for performance testing
# Usage: .\scripts\generate-test-archive.ps1 -EntryCount 100000 -OutputPath "test-large.zip"

param(
    [int]$EntryCount = 1000,
    [string]$OutputPath = "test-large.zip"
)

Write-Host "Generating test archive with $EntryCount entries..."

# Create temp directory
$tempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }

try {
    # Create files in temp directory
    for ($i = 1; $i -le $EntryCount; $i++) {
        $filePath = Join-Path $tempDir "file-$i.txt"
        "Test content for file $i" | Out-File -FilePath $filePath -Encoding utf8
        
        if ($i % 1000 -eq 0) {
            Write-Host "Created $i files..."
        }
    }
    
    Write-Host "Compressing to $OutputPath..."
    Compress-Archive -Path "$tempDir\*" -DestinationPath $OutputPath -Force
    
    Write-Host "Done! Archive created: $OutputPath"
    Write-Host "Archive size: $((Get-Item $OutputPath).Length) bytes"
} finally {
    Remove-Item -Path $tempDir -Recurse -Force
}


