Add-Type -AssemblyName System.Drawing

$iconPath = "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\public\icono-terma.png"
$fontPath = "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\src\assets\fonts\SpaceGrotesk-VariableFont_wght.ttf"
$subFontPath = "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\src\assets\fonts\DMSans-VariableFont_opsz,wght.ttf"
$resDir = "D:\ARCHIVOS 2026\envero-totem-react\envero-totem\android\app\src\main\res"

$pfc = New-Object System.Drawing.Text.PrivateFontCollection
$pfc.AddFontFile($fontPath)
$pfc.AddFontFile($subFontPath)

$titleFontFamily = $pfc.Families[0]
$subFontFamily = if ($pfc.Families.Count -gt 1) { $pfc.Families[1] } else { $pfc.Families[0] }

$iconImg = [System.Drawing.Bitmap]::FromFile($iconPath)

$targets = @(
    @{ folder = "drawable"; w = 480; h = 320 },
    @{ folder = "drawable-land-mdpi"; w = 480; h = 320 },
    @{ folder = "drawable-land-hdpi"; w = 800; h = 480 },
    @{ folder = "drawable-land-xhdpi"; w = 1280; h = 720 },
    @{ folder = "drawable-land-xxhdpi"; w = 1600; h = 960 },
    @{ folder = "drawable-land-xxxhdpi"; w = 1920; h = 1280 },
    @{ folder = "drawable-port-mdpi"; w = 320; h = 480 },
    @{ folder = "drawable-port-hdpi"; w = 480; h = 800 },
    @{ folder = "drawable-port-xhdpi"; w = 720; h = 1280 },
    @{ folder = "drawable-port-xxhdpi"; w = 960; h = 1600 },
    @{ folder = "drawable-port-xxxhdpi"; w = 1280; h = 1920 }
)

function Create-SplashScreen($w, $h, $outputPath) {
    $bmp = New-Object System.Drawing.Bitmap($w, $h)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    
    # Fondo #0a1114
    $bgColor = [System.Drawing.ColorTranslator]::FromHtml("#0a1114")
    $g.Clear($bgColor)
    
    # Calcular escala de icono y fuentes según tamaño de pantalla
    $minDim = [Math]::Min($w, $h)
    $isLandscape = $w -gt $h
    
    $iconSize = if ($isLandscape) { [int]($minDim * 0.38) } else { [int]($minDim * 0.36) }
    $titlePt = [Math]::Max(14, [int]($iconSize * 0.17))
    $subPt = [Math]::Max(10, [int]($iconSize * 0.095))
    
    $titleFont = New-Object System.Drawing.Font($titleFontFamily, $titlePt, [System.Drawing.FontStyle]::Bold)
    $subFont = New-Object System.Drawing.Font($subFontFamily, $subPt, [System.Drawing.FontStyle]::Regular)
    
    $sf = New-Object System.Drawing.StringFormat
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    
    $titleText = "TERMA"
    $subText = "Climatizaci" + [char]0x00F3 + "n para tus cultivos"
    
    $titleSize = $g.MeasureString($titleText, $titleFont)
    $subSize = $g.MeasureString($subText, $subFont)
    
    $gap1 = [int]($iconSize * 0.10)
    $gap2 = [int]($iconSize * 0.06)
    
    $totalHeight = $iconSize + $gap1 + $titleSize.Height + $gap2 + $subSize.Height
    
    $startY = [int](($h - $totalHeight) / 2)
    $iconX = [int](($w - $iconSize) / 2)
    $iconY = $startY
    
    # Dibujar icono TERMA
    $g.DrawImage($iconImg, $iconX, $iconY, $iconSize, $iconSize)
    
    # Dibujar Título: TERMA (#2ce2b1 menta brillante)
    $titleBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#2ce2b1"))
    $titleY = $iconY + $iconSize + $gap1 + ($titleSize.Height / 2)
    $g.DrawString($titleText, $titleFont, $titleBrush, [float]($w / 2), [float]$titleY, $sf)
    
    # Dibujar Subtítulo: Climatización para tus cultivos (#a5c8c6 / #8ca6a5)
    $subBrush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml("#95b2b0"))
    $subY = $iconY + $iconSize + $gap1 + $titleSize.Height + $gap2 + ($subSize.Height / 2)
    $g.DrawString($subText, $subFont, $subBrush, [float]($w / 2), [float]$subY, $sf)
    
    # Guardar
    $bmp.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
    
    $titleBrush.Dispose()
    $subBrush.Dispose()
    $titleFont.Dispose()
    $subFont.Dispose()
    $sf.Dispose()
    $g.Dispose()
    $bmp.Dispose()
}

foreach ($t in $targets) {
    $folder = Join-Path $resDir $t.folder
    if (-not (Test-Path $folder)) {
        New-Item -ItemType Directory -Path $folder -Force | Out-Null
    }
    $outPath = Join-Path $folder "splash.png"
    Create-SplashScreen $t.w $t.h $outPath
    Write-Host "Created splash for $($t.folder) ($($t.w)x$($t.h))"
}

$iconImg.Dispose()
$pfc.Dispose()
Write-Host "All splash screens generated successfully!"
