$ErrorActionPreference = 'Stop'

try {
  & docker info --format '{{.ServerVersion}}' *> $null
  if ($LASTEXITCODE -eq 0) { Write-Output 'Docker Desktop ya está disponible.'; exit 0 }
} catch { }

$localData = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\')
$desktop = 'C:\Program Files\Docker\Docker\Docker Desktop.exe'
if (-not (Test-Path -LiteralPath $desktop)) { throw 'Docker Desktop no está instalado en la ruta esperada.' }

# Solo cambia sockets temporales de Docker. No toca volúmenes, imágenes ni datos PostgreSQL.
Get-Process | Where-Object { $_.ProcessName -in @('Docker Desktop', 'com.docker.backend', 'docker', 'docker-compose', 'docker-ai') } | Stop-Process -Force
foreach ($relative in @('Docker\run', 'docker-secrets-engine')) {
  $runtime = [IO.Path]::GetFullPath((Join-Path $localData $relative))
  $parent = [IO.Path]::GetFullPath((Split-Path $runtime -Parent))
  $destination = [IO.Path]::GetFullPath((Join-Path $parent ((Split-Path $runtime -Leaf) + '-stale-' + (Get-Date -Format 'yyyyMMddHHmmss'))))
  if (-not $runtime.StartsWith($localData + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $destination.StartsWith($localData + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Ruta temporal inesperada; no se cambia.' }
  if (Test-Path -LiteralPath $runtime) { Rename-Item -LiteralPath $runtime -NewName (Split-Path $destination -Leaf) }
}

Start-Process -FilePath $desktop -WindowStyle Hidden
Write-Output 'Docker Desktop se ha iniciado. Comprueba con: docker compose ps'
