Add-Type -AssemblyName System.Drawing

$srcPath = "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\public\icono-terma.png"
$resDir = "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\android\app\src\main\res"

$densities = @(
    @{ name = "mipmap-mdpi"; size = 48; fgSize = 108 },
    @{ name = "mipmap-hdpi"; size = 72; fgSize = 162 },
    @{ name = "mipmap-xhdpi"; size = 96; fgSize = 216 },
    @{ name = "mipmap-xxhdpi"; size = 144; fgSize = 324 },
    @{ name = "mipmap-xxxhdpi"; size = 192; fgSize = 432 }
)

$srcImg = [System.Drawing.Bitmap]::FromFile($srcPath)

function Resize-Image($src, $w, $h) {
    $dest = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.DrawImage($src, 0, 0, $w, $h)
    $g.Dispose()
    return $dest
}

function Generate-Foreground($src, $fgSize) {
    $dest = New-Object System.Drawing.Bitmap($fgSize, $fgSize)
    $g = [System.Drawing.Graphics]::FromImage($dest)
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    
    $innerSize = [int]($fgSize * 0.72)
    $offset = [int](($fgSize - $innerSize) / 2)
    $g.DrawImage($src, $offset, $offset, $innerSize, $innerSize)
    $g.Dispose()
    return $dest
}

foreach ($d in $densities) {
    $folder = Join-Path $resDir $d.name
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
    
    $launcher = Resize-Image $srcImg $d.size $d.size
    $launcher.Save((Join-Path $folder "ic_launcher.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $launcher.Dispose()
    
    $round = Resize-Image $srcImg $d.size $d.size
    $round.Save((Join-Path $folder "ic_launcher_round.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $round.Dispose()
    
    $fg = Generate-Foreground $srcImg $d.fgSize
    $fg.Save((Join-Path $folder "ic_launcher_foreground.png"), [System.Drawing.Imaging.ImageFormat]::Png)
    $fg.Dispose()
    
    Write-Host "Generated icons for $($d.name)"
}

$srcImg.Dispose()
Write-Host "All icons generated successfully!"
