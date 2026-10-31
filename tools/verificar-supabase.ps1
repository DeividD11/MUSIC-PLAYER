$ErrorActionPreference = 'Stop'
$projectUrl = 'https://qbmhcudgtjooyyegdhkk.supabase.co'
$publishableKey = 'sb_publishable_g-fuyJg_6w7D9Fx_6iKZgA_g8rlaaOM'
$endpoint = "$projectUrl/functions/v1/music-api"

Write-Host 'Comprobando MUSIC PLAYER en Supabase...' -ForegroundColor Cyan
try {
  $response = Invoke-RestMethod -Method Post -Uri $endpoint -Headers @{ apikey = $publishableKey } -ContentType 'application/json' -Body '{"action":"health"}' -TimeoutSec 20
  if ($response.ok -and $response.data.status -eq 'ready') {
    Write-Host 'OK: music-api responde correctamente.' -ForegroundColor Green
    $response.data | Format-List
    exit 0
  }
  Write-Host 'ERROR: Supabase respondio, pero la respuesta no fue la esperada.' -ForegroundColor Red
  $response | ConvertTo-Json -Depth 8
  exit 1
}
catch {
  Write-Host 'ERROR: no fue posible comprobar music-api.' -ForegroundColor Red
  Write-Host $_.Exception.Message
  Write-Host 'Revisa que se haya ejecutado ACTUALIZAR-SUPABASE.bat y que la funcion figure como ACTIVE.'
  exit 1
}
