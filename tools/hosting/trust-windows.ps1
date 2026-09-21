param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$certificateBytes = [Convert]::FromBase64String('__CERT_BASE64__')
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new($certificateBytes)
$fingerprint = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($certificate.RawData)).Replace('-', ':')
if ($fingerprint -ne '__FINGERPRINT__') { throw 'Certificate fingerprint mismatch' }
Write-Host "Party Console certificate: $fingerprint"
Write-Host 'Trusting this certificate allows this Party Console installation to issue trusted HTTPS certificates.'
$operation = if ($Remove) { 'Remove' } else { 'Trust' }
if ((Read-Host "$operation this certificate for your Windows user? Type YES") -cne 'YES') { exit 0 }
$store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
$store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
    if ($Remove) { $store.Remove($certificate) } else { $store.Add($certificate) }
} finally { $store.Close() }
Write-Host "$operation complete. Restart the Adventure Land Steam client, or the browser you play in."
Write-Host 'Refresh setup. Restart that browser only if it still reports a certificate error.'
Write-Host 'To check Firefox trust, open the HTTPS /setup address, not /setup/continue.'
Write-Host 'If needed: Firefox menu > Settings; search certificates > View Certificates > Authorities > Import.'
Write-Host 'Select party-console-root.crt from Download certificate in setup, and enable trust for identifying websites.'
