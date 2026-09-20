# Upgrade an existing patched caracAL checkout without replacing local changes.
$coordinatorPath = Join-Path (Split-Path -Parent $PSScriptRoot) '.caracal\standalones\CharacterCoordinator.js'
if (-not (Test-Path -LiteralPath $coordinatorPath)) { return }
$source = [IO.File]::ReadAllText($coordinatorPath)
if ($source.Contains('only leader can route to monster')) { return }
$normalized = $source.Replace("`r`n", "`n")
$anchor = @'
      express_inst.post("/party-api/command", function (req, res) {
        const body = req.body || {};
'@
if (-not $normalized.Contains($anchor)) { return }
$guard = @'
        if ((body.farmingMonsterIds || body.type === "party-monster-travel") &&
            body.character !== party.leader && party.followers?.[body.character] === true)
          return res.status(409).json({ error: "only leader can route to monster" });
'@
$updated = $normalized.Replace($anchor, $anchor + "`n" + $guard)
[IO.File]::WriteAllText($coordinatorPath, $updated, [Text.UTF8Encoding]::new($false))
