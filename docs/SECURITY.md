# Güvenlik — sınırlar ve 2026-10-13 incelemesinin durumu

> Agentbits ajanlara gerçek yetkiler verir: dosya düzenleme, komut çalıştırma, veritabanı / sunucu erişimi, bağlı
> uygulamalar. Bu belge **neyin nerede zorlandığını**, 2026-10-13 tarihli bağımsız güvenlik incelemesinin (27 bulgu)
> her maddesinin bugünkü durumunu ve **açık kalanları** tutar. Yeni bir güvenlik değişikliğinde bu tabloyu güncelleyin.
> Ayrıntılar: [ARCHITECTURE.md](ARCHITECTURE.md) §3, §6, §8.1, §9b, §9c, §9e, §9f · ADR-018…ADR-024.

## Temel ilkeler

- **Varsayılan reddet:** bağlantı, dosya, skill ve uygulama erişimi açık izin ister; yetki her güçlü işlemde, işlem
  anında ve main süreçte denetlenir (prompt bir erişim denetimi değildir).
- **Onay paneli:** Production değişiklikleri ve "Önce bana sor" uygulama araçları kullanıcıyı bekler; onay sonrası
  yetki yeniden denetlenir; yetki düşürülünce bekleyen istekler düşer.
- **Güvenilmeyen veri:** dosya içerikleri, sorgu sonuçları, komut çıktıları, uygulama sonuçları ve hafıza "veri, talimat
  değil" zarfında modele gider.
- **Sırlar main'de kalır** ve yalnızca işletim sisteminin anahtar zinciriyle şifreli saklanır; yoksa hiç saklanmaz.
- **Dürüst UI:** uygulanamayan bir kısıt "uygulanıyor" gibi gösterilmez (terminal izni, tarayıcı izni, CLI duraklatma).

## İnceleme bulguları

Durum: ✅ düzeltildi · 🟡 kısmen / azaltıldı · 📄 bilinçli sınır, belgelendi · ⏳ açık.

| No | Bulgu | Durum | Ne yapıldı / ne kaldı | Test |
|---|---|---|---|---|
| 01 | SSH "okuma" listesiyle komut çalıştırma (`awk`, `sed e`, `sort --compress-program`, `ip … flush`) | ✅ | `readUnsafe()`: yorumlayıcılar / sarmalayıcılar hiçbir zaman okuma sayılmaz; `sed` yalnızca `-n '<aralık>p'`; `sort -o/--compress-program/-T`, `uniq` çıktı dosyası, `ss -K`, `ip` değişiklik alt komutları, `journalctl` bakım, `find` eylemleri, `tail -f`, `date -s`, `docker` / `systemctl` değiştiren alt komutları okuma dışı. Varsayılan listeden `awk` çıktı. İkinci tur: `sed`'de **her** betik (`-e`, `--expression`, ilk işlenen) denetlenir. Kalan: gerçek güvence kısıtlı uzak OS kullanıcısıdır (belgede) | `tests/connections.classify.test.ts`, `sec.mjs` (gerçek SSH test sunucusu) |
| 02 | CLI izin matrisi gerçek sınır değil | 🟡 | Codex'te `danger-full-access` kaldırıldı (`workspace-write` + isteğe bağlı ağ), `fs_read` kapalı Codex reddedilir; Claude Code `--restricted` (2.1.248+) ile dosya araçları çalışma dizinlerinde. Kalan: Claude Code'da Terminal izni açıkken kabuk her şeyi yapabilir — UI açıkça söyler; OS düzeyinde yalıtım yok; `browser` izni uygulanmıyor (UI "henüz uygulanmıyor" der) | fake CLI argümanları |
| 03 | Claude proje / kullanıcı ayarları ve hook'lar | ✅ | `--restricted` (yalnızca yönetilen ayarlar) ya da eski CLI'da `--setting-sources user` → depodaki `.claude/settings*.json` hook / izinleri yüklenmez. 2026-10-15: CLI'lar ortamı **izin listesiyle** devralır (`agentEnv`: PATH, kullanıcı klasörleri, proxy, dil, CLI'ın kendi önekleri + kullanıcının Ayarlar → Güvenlik ve sınırlar'daki ek adları); bulut anahtarları, token'lar, `SSH_AUTH_SOCK`, `NODE_OPTIONS` geçmez. Kalan: gerçek CLI ile denenmedi | `tests/settings.test.ts` |
| 04 | SQL sınıflandırması yan etkili SQL'i okuma sayıyor | ✅ / 📄 | `WITH … SELECT INTO`, `INTO OUTFILE/@var`, MySQL `/*! */`, dosya / dblink / oturum / ayar fonksiyonları admin; `nextval`, `NEXT VALUE FOR`, advisory lock, `LOCK IN SHARE MODE` write. İkinci tur: tırnaklı adlar (`"pg_read_file"(…)`, `` `load_file` ``, `[xp_cmdshell]`) da denetlenir, PG `U&"…"` adları admin; dizelerde ters eğik çizgi iki şekilde okunur (MySQL / standart SQL) ve katı olan sonuç alınır. İkinci tur: ajan okumaları **yalnızca salt-okunur DB kullanıcısıyla** çalışır; tanımlı değilse reddedilir — denetleyicinin kaçırdığı ifade de veritabanında SELECT yetkisine çarpar. Kalan (belgede): yazma / admin sorguları ana kullanıcıyla (Production'da onaylı); sınıflandırma sezgisel | unit (20+ olumsuz örnek), `sec.mjs` |
| 05 | API sağlayıcılarında "Onay iste" çalışmıyor | ✅ | `requireApproval` tüm sağlayıcılarda; model isteği onaydan önce yapılmaz | `sec.mjs` (Anthropic ajanı `awaiting_approval`) |
| 06 | Onay beklerken kaldırılan yetki | ✅ | `stillAllowed()` onaydan sonra yeniden denetler; izin düşürme / bağlantı-uygulama düzenleme-silme / ajan silme bekleyen istekleri reddeder (`rejectApprovalsWhere`); uygulama araçlarında da aynı | `sec.mjs` (dock boşalır, sorgu DENIED) |
| 07 | İki uygulama örneği | ✅ | `requestSingleInstanceLock()` (veri klasörü başına), ikinci açılış pencereyi öne getirir | `sec.mjs` |
| 08 | Durdur / sıfırla tüm işleri beklemiyor | ✅ / 📄 | Sohbet ve incelemeler iptal edilebilir kayıtta; sıfırlama / temizlik / proje silme işlerin bitmesini bekler (`settled`); süre dolarsa (60 sn) işlem `stillRunning` hatasıyla durur; kapanışta hiçbir görev başlamaz; Unix'te CLI süreç grubu öldürülür. 2026-10-15: durdurulan çalışmanın DB sorgusu ve SSH komutu **hemen kesilir** (`ActiveRun.halt` → `AgentCtx.signal` → `cancellable`; PG/MySQL bağlantı koparılır, SQL Server `cancel()`, SSH oturumu kapanır). 📄 PG/MySQL sunucuda sorgunun durması bağlantının düştüğünü fark etmesine bağlıdır (`statement_timeout` / sorgu zaman aşımı yine sınır); CLI "duraklat" süreci dondurmaz | `tests/cancel.test.ts` |
| 09 | Ret / durdurma / duraklatma yeniden açılışta kayboluyor | ✅ | `settings.orchestrator.held` ve `.paused` kalıcı; yarıda kalan görevler bekletilir ve görev akışına not düşer | `sec.mjs` (yeniden açılışta çalışmaz) |
| 10 | Şifreleme yokken sırlar base64 | ✅ | Gerçek anahtar zinciri yoksa (Linux `basic_text` dahil) sır kaydı reddedilir; eski `plain:` değerler açılışta şifrelenir | `sec.mjs` (env olmadan kayıt reddi görüldü) |
| 11 | Yol denetimi symlink / junction / üst dizin | ✅ | `canonicalPath` (realpath), uygulama klasörünü içeren üst klasörler, sürücü kökü / kullanıcı klasörü / veri klasörü reddi (`tooBroad`), CLI başlamadan `assertRunFolder`, proje dosyası okumada gerçek konum denetimi | `sec.mjs` (home, symlink, üst klasör reddedildi) |
| 12 | Eski yedeği geri yüklerken ek dosyaları silinebilir | ✅ | `.restore` kopyası çöp toplamada referans sayılır | — (kod + `sec.mjs` geri yükleme yolu) |
| 13 | IPC göndereni ve girdiler denetlenmiyor | 🟡 | Yalnızca Agentbits penceresinin ana çerçevesi + doğru URL; yöntem `hasOwnProperty`; argüman sayısı / boyutu / `__proto__` ve dosya-kabuk-yedek metotlarında tür denetimi. 2026-10-15: `settings:update` her anahtarı ve türü denetler (`validateSettingsPatch`). Kalan: her metot için tam şema yok; dosya seçici / sürükle-bırak yolları main'de yetkilendirilmiyor | `tests/settings.test.ts` |
| 14 | Olumsuz inceleme onaya dönüşüyor | ✅ | Yalnızca **en dıştaki** JSON nesnesinin kendi boolean `approved`'u sayılır; iç içe ya da tekrarlanan `approved`, birbiriyle çelişen kararlar veya bozuk JSON → karar yok, kullanıcıya kalır | `tests/review.test.ts` |
| 15 | CLI hata kodu başarıya dönüşüyor | ✅ | Sıfır olmayan çıkış = başarısız; çıktı işleme hatası yayılır | — |
| 16 | Eşzamanlı MCP port 0 | ✅ | Tek paylaşılan başlatma sözü | apps e2e (eşzamanlı Claude + Codex) |
| 17 | DB satır sınırı bellek kullanmıyor | ✅ | Akışla okuma: 200 satır tutulur, gerisi sayılır, 100 000'de durdurulur; hücre 4000 karakter; düşen bağlantıda asılı kalmaz | `sec.mjs` (500 / 10 000 karakter / 150 000 satır) |
| 18 | Bütçe / süre / eşzamanlılık sınırları | ✅ / 📄 | API isteklerinde süre sınırı, 4 inceleme turu sonra bekletme. 2026-10-15: görev çalışması başına **süre** (varsayılan 120 dk), **token** ve **maliyet** tavanı (Ayarlar → Güvenlik ve sınırlar); aşılınca çalışma durur, görev bekletilir, sohbette nedeni yazar. 📄 Aynı ajanın görev sırasında sohbete cevap vermesi: sohbet modunda Claude Code'a dosya / kabuk aracı verilmez, Codex salt-okunur çalışır — risk yalnızca maliyet. Maliyeti yalnızca Claude Code bildirir (turda bir) | — |
| 19 | Electron sandbox ve tarayıcı politikası | ✅ | `sandbox: true`, izin işleyicileri (tarayıcı oturumunda hiçbir cihaz izni), webview sertleştirme, üretim CSP'si, Markdown bağlantı protokolleri. Kalan: Browser bölümü http adreslerini de açar (kullanıcının kendi gezinmesi) | tüm e2e (sandbox'lı pencere) |
| 20 | DB TLS varsayılan kapalı; SSH ilk anahtar | ✅ | Uzak Production DB TLS'siz kaydedilmez; ajanlar sabitlenmemiş SSH anahtarına bağlanmaz (yalnızca kullanıcının "Test"i sabitler) | `sec.mjs` |
| 21 | Log / hafıza gizliliği ve kalıcı prompt enjeksiyonu | ✅ / 📄 | Hafıza "notlar, talimat değil" ve kaynağıyla (`user` / `from chat`…) prompt'a girer. 2026-10-15: transkript satırları ve meta'ları (tam prompt dahil) kaydedilmeden önce sır benzeri metinler maskelenir (`shared/redact.ts`); denetim kaydının saklama süresi (`auditRetentionDays`, varsayılan 180 gün). 📄 Maskeleme kalıp tabanlıdır, her sırrı tanımaz; tam prompt'lar (maskeli) log saklama süresince durur | `tests/redact.test.ts` |
| 22 | Geri yükleme doğrulaması | ✅ / 📄 | `integrity_check`, temel tablolar, şema sürümü; bozuk / yeni sürüm yedek reddedilir. Belgede: yedek yalnızca DB'dir (ek orijinalleri `files/`'ta) | `sec.mjs` |
| 23 | Kurulum dosyası güncel kaynağı içermiyor | 📄 | Paket her değişiklikten sonra `npm run dist:win` ile yeniden üretilmeli; release iş akışı SHA-256 + commit yazar | — |
| 24 | Windows kurulum dosyası imzasız | ⏳ | Sertifika gerekir (`WIN_CSC_LINK` / `WIN_CERT_SUBJECT`, DEVELOPMENT §8) | — |
| 25 | CI dosyası yok, güvenlik testleri eksik | ✅ | `.github/workflows/ci.yml` (push/PR: typecheck, test:unit, build, `npm audit --omit=dev --audit-level=critical`), `release.yml` SHA256SUMS; olumsuz testler `test:unit`'te. `npm audit` ile `@modelcontextprotocol/sdk` 1.31.0'a yükseltildi (GHSA-6qxp-vccf-f47h); kurulu SDK eskiyse OAuth girişi reddedilir, `issuer`'sız eski girişler açılışta silinir (yeniden giriş). Paketlemeden önce `npm ci` şart | `npm audit --omit=dev` = 0 |
| 26 | Sahte giriş ekranı | ✅ | Kaldırıldı | — |
| 27 | Büyük veride UI / dosya kuyruğu | ⏳ | Planlı: aktif projeye göre sayfalama, kuyruk + disk kotası | — |

## Testler

- `npm run test:unit` — SQL / SSH sınıflandırma (olumsuz örnekler dahil), dosya çıkarma, skill, MCP yapılandırma, inceleme
  kararı, çeviriler.
- Uçtan uca (geliştirme makinesinde, sahte CLI'lar ve yerel test sunucularıyla — depoda değil): bağlantılar, onay
  paneli, tek örnek, klasör reddi, yedek doğrulama, yeniden açılışta bekletme. Gerçek Claude Code / Codex CLI, MySQL,
  SQL Server ve macOS ile denenmedi.

## Bilinçli sınırlar (kullanıcıya söylenenler)

- Terminal (+ ağ) izni olan Claude Code ajanı makinede kullanıcının yapabildiği her şeyi yapabilir; yalnızca güvenilen
  ajanlara verin ya da Agentbits'i kısıtlı bir OS kullanıcısıyla çalıştırın.
- Bağlantıların gerçek güvencesi sunucu tarafıdır: ayrı salt-okunur DB hesabı, kısıtlı SSH kullanıcısı.
- Yerel (stdio) MCP sunucuları kullanıcının yetkileriyle çalışan programlardır.
- Uygulama sunucusunun stderr'i ve hata metinleri, sırlar (env / başlık değerleri, OAuth anahtarları) çıkarılarak yalnızca
  denetim kaydına yazılır; ajana kısa ve arındırılmış hata gider. Arındırma bilinen değerlere dayanır: sunucunun kendi
  ürettiği başka bir sırrı tanıyamaz.
- OAuth girişini yalnızca güvendiğiniz sunuculara yapın: SDK düzeltmesi yeni bir etkileşimli girişte kötü niyetli bir
  sunucunun sizi kendi giriş sayfasına yönlendirmesini engellemez; açılan sayfanın adresini kontrol edin.
- Paketler imzasızdır (sertifika tanımlanana kadar).
