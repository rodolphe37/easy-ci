# Installe ou met à jour Easy CI pour l'utilisateur courant (sans droits administrateur) :
#   irm https://raw.githubusercontent.com/rodolphe37/easy-ci/main/packaging/windows/install.ps1 | iex
#
# Télécharge la dernière GitHub Release, installe dans %LOCALAPPDATA%\Programs\EasyCI et crée un
# raccourci dans le menu Démarrer. Un fichier téléchargé par PowerShell n'est pas marqué comme venant
# d'Internet : pas d'écran SmartScreen au lancement. Pour mettre à jour, relancer la même commande.
#
# Variables d'environnement facultatives :
#   $env:EASY_CI_VERSION = "v0.2.0"   installer une version précise plutôt que la dernière
#   $env:GITHUB_TOKEN = "…"           télécharger depuis un dépôt privé
#   $env:EASY_CI_ARCHIVE = "…zip"     installer une archive déjà téléchargée (hors ligne, tests de la CI)
#   $env:EASY_CI_INSTALL_DIR = "…"    dossier de destination (par défaut %LOCALAPPDATA%\Programs\EasyCI)
#   $env:EASY_CI_UNINSTALL = "1"      désinstaller

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # la barre de progression ralentit fortement Invoke-WebRequest

$Repo = if ($env:EASY_CI_REPOSITORY) { $env:EASY_CI_REPOSITORY } else { "rodolphe37/easy-ci" }
$Asset = "EasyCI-Windows-X64.zip"
$InstallDir = if ($env:EASY_CI_INSTALL_DIR) { $env:EASY_CI_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA "Programs\EasyCI" }
$Shortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Easy CI.lnk"

function Stop-EasyCI {
    $running = Get-Process -Name "EasyCI" -ErrorAction SilentlyContinue
    if ($running) {
        Write-Host "Fermeture d'Easy CI en cours d'exécution…"
        $running | Stop-Process -Force
        Start-Sleep -Seconds 2
    }
}

if ($env:EASY_CI_UNINSTALL -eq "1") {
    Stop-EasyCI
    Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    Remove-Item -Force $Shortcut -ErrorAction SilentlyContinue
    Write-Host "Easy CI a été désinstallé (vos préférences restent dans $env:LOCALAPPDATA\Easy CI)."
    return
}

if (-not [Environment]::Is64BitOperatingSystem) { throw "Seul Windows 64 bits est pris en charge." }

$work = Join-Path ([IO.Path]::GetTempPath()) ("easy-ci-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $work | Out-Null
try {
    $zip = Join-Path $work $Asset
    if ($env:EASY_CI_ARCHIVE) {
        if (-not (Test-Path $env:EASY_CI_ARCHIVE)) { throw "Archive introuvable : $($env:EASY_CI_ARCHIVE)" }
        Copy-Item $env:EASY_CI_ARCHIVE $zip
    } elseif (-not $env:GITHUB_TOKEN) {
        Write-Host "Téléchargement d'Easy CI…"
        $path = if ($env:EASY_CI_VERSION) { "download/$($env:EASY_CI_VERSION)" } else { "latest/download" }
        try {
            Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/releases/$path/$Asset" -OutFile $zip
        } catch {
            throw "Téléchargement impossible. Le dépôt est-il public et une version publiée ? (https://github.com/$Repo/releases)"
        }
    } else {
        $headers = @{ Authorization = "Bearer $($env:GITHUB_TOKEN)"; Accept = "application/vnd.github+json"; "User-Agent" = "EasyCI-installer" }
        $api = if ($env:EASY_CI_VERSION) { "https://api.github.com/repos/$Repo/releases/tags/$($env:EASY_CI_VERSION)" } else { "https://api.github.com/repos/$Repo/releases/latest" }
        $release = Invoke-RestMethod -Uri $api -Headers $headers
        $file = $release.assets | Where-Object { $_.name -eq $Asset } | Select-Object -First 1
        if (-not $file) { throw "Fichier $Asset absent de la version $($release.tag_name)." }
        $headers.Accept = "application/octet-stream"
        Invoke-WebRequest -UseBasicParsing -Uri $file.url -Headers $headers -OutFile $zip
    }

    Write-Host "Décompression…"
    Expand-Archive -Path $zip -DestinationPath $work -Force
    $source = Join-Path $work "EasyCI"
    if (-not (Test-Path (Join-Path $source "EasyCI.exe"))) { throw "Archive inattendue : EasyCI.exe introuvable." }

    Stop-EasyCI
    Write-Host "Installation dans $InstallDir…"
    Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Path (Split-Path $InstallDir) -Force | Out-Null
    Move-Item -Path $source -Destination $InstallDir

    $exe = Join-Path $InstallDir "EasyCI.exe"
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Shortcut)
    $link.TargetPath = $exe
    $link.WorkingDirectory = $InstallDir
    $link.Description = "Superviser, modifier et générer vos pipelines CI/CD"
    $link.Save()

    $version = (Get-Item $exe).VersionInfo.ProductVersion
    Write-Host ""
    Write-Host "Easy CI $version est installé. Lancez-le depuis le menu Démarrer (« Easy CI »)."
    Write-Host "Mise à jour : relancer la même commande."
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "Git est nécessaire pour les projets locaux : winget install Git.Git"
    }
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
