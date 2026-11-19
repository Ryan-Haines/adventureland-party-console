# The Node floor is package.json's engines.node, declared once.
# setup-console.ps1 and start-console.ps1 dot-source this before they run anything on Node.
$nodeFloor = [version]((Get-Content -Raw -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'package.json') | ConvertFrom-Json).engines.node -replace '^>=', '')
if ([version]((& node --version) -replace '^v', '') -lt $nodeFloor) { throw "Node $nodeFloor or later is required." }
