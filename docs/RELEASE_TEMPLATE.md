# Agentbits v{VERSION} — Sürüm Notları

> Yayın tarihi: {DATE}

## Yenilikler

- {FEATURE_1}
- {FEATURE_2}

## Hata düzeltmeleri

- {FIX_1}

## Kurulum

**Windows (önerilen):** `Agentbits-Setup-{VERSION}.exe` indirin ve çalıştırın.

Gereksinimler: Windows 10/11 (x64). Uygulama için Node.js gerekmez. Claude Code CLI ya da Codex CLI kullanılacaksa
bunlar ayrıca kurulup giriş yapılmalıdır (`claude auth login`, `codex login`); uygulamayla gelmezler. Anahtarsız denemek
için Demo sağlayıcısı yeterlidir.

Paket imzasızsa Windows SmartScreen uyarır → *Ek bilgi* → *Yine de çalıştır*.

## Yükseltme

Otomatik güncelleme yoktur. Agentbits'i kapatıp yeni kurulum dosyasını çalıştırın; eski sürüm yerinde değiştirilir
(önce kaldırmak gerekmez). Önceki kurulumda seçtiğiniz kapsamı ("yalnızca benim için" / "herkes") yine seçin.
Veriler (`%APPDATA%\Agentbits`) silinmez; veritabanı ilk açılışta yeni şemaya yükseltilir. Önce yedek almak için:
Ayarlar → Veri yönetimi → "Yedek al".

## Dosya doğrulama

Kurulum dosyasının SHA-256 özeti (imza değildir; yalnızca dosyanın bozulmadığını gösterir):

```powershell
Get-FileHash Agentbits-Setup-{VERSION}.exe -Algorithm SHA256
```

Beklenen hash: `{SHA256}`

## Tam değişiklik listesi

→ [CHANGELOG.md](https://github.com/godilman/agentbits/blob/main/docs/CHANGELOG.md)
