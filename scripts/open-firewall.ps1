$ports = @(3000, 6185)

foreach ($port in $ports) {
  $ruleName = "Medical_PBL_$port"
  $existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
  if (-not $existing) {
    try {
      New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $port `
        -ErrorAction Stop | Out-Null
      Write-Host "Created firewall rule: $ruleName"
    } catch {
      Write-Host "Failed to create firewall rule: $ruleName"
      Write-Host $_.Exception.Message
    }
  } else {
    Write-Host "Firewall rule already exists: $ruleName"
  }
}

Write-Host "Finished processing ports 3000 and 6185."
