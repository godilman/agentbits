# Agentbits — Değişiklik Günlüğü

> Her değişiklikten sonra **en üste** tarihli bir kayıt ekleyin (en yeni üstte). Biçim:
> `## YYYY-MM-DD — kısa başlık`, ardından **Eklendi / Değişti / Düzeltildi / Kaldırıldı / Bilinen** maddeleri
> ve ilgili dosyalar.

## 2026-10-15 — Paylaşım: birim / takım / ajan dışa-içe aktarma

### Eklendi
- Birim (altındaki her şeyle) ya da ajan **`.agentbits`** dosyasına dışa aktarılır; dosyadan ya da GitHub bağlantısından
  (özel depo: Skill'ler'deki GitHub token'ı) **önizlemeli** içe aktarılır. Ayrıntı: FEATURES §2, ARCHITECTURE §4.2, SECURITY.
- IPC `share:export`, `share:preview`, `share:import`; `core/share.ts`, `shared/share.ts`, `features/org/Share.tsx`;
  skill kaynak türü `package`.

### Doğrulandı
- `tests/share.test.ts` (doğrulayıcı: bozuk JSON, yeni sürüm, yinelenen / bilinmeyen ref, çoklu kök, döngü, `../` ve sürücü
  harfli yollar, sınırlar; izin tavanı). Gerçek SQLite ile uçtan uca (paketlenmiş Electron'un better-sqlite3'ü, depoda değil):
  dışa aktar → önizle → içe aktar; yol / sağlayıcı kimliği sızmıyor, çalıştırılabilir dosya ne çıkıyor ne giriyor, şüpheli
  kişilik işaretleniyor, ad çakışması, sağlayıcı eşlemesi, onay zorunlu, alt birim / lider / unvan, kurulu skill korunuyor,
  süresi dolan önizleme reddediliyor. GitHub yolu gerçek ağla: paket olmayan dosya, olmayan dosya, GitHub dışı adres.
  Arayüz sahte köprüyle tarayıcıda (önizleme, Paylaş kartı, Yarış modu ayarı) ekran görüntüsüyle denetlendi.

## 2026-10-15 — Yarış modu

### Eklendi
- **Yarış modu** (Ayarlar → Genel, varsayılan kapalı): görev başlarken kopyası başka sağlayıcı ya da modeldeki boştaki bir üyeye
  de verilir; ikisi de bitince lider karşılaştırır, kazanan tamamlanır (worktree'de birleşir), kaybeden kapanır ve dalı silinir.
  Kartta 🏁 rozeti. Lider incelemesi açık olmalı; klasörlü projede worktree yalıtımı gerekir (yoksa yarış atlanır ve nedeni yazılır).
  Uygun rakip yoksa görev tek başına çalışır. Demo sağlayıcıda denenebilir.
- Migration **v14**: `tasks.race_of`, `tasks.race_result`. `shared/review.ts` → `parseRaceVerdict`, `pickRival` (+ testler).

## 2026-10-15 — Faz 6: RTF, Office 97–2003 (.doc / .xls / .ppt) ve OCR (ADR-026)

### Eklendi
- **RTF** (kendi ayrıştırıcısı: kod sayfaları, `\uN`, tablolar / resimler / `\*` hedefleri atlanır).
- **.doc** (word-extractor), **.xls** (kendi BIFF8 okuyucusu, cfb: paylaşılan dizeler, CONTINUE, RK / MULRK, formül önbelleği,
  tarih biçimleri, gizli sayfalar), **.ppt** (slayt sırası, konuşmacı notları, ana şablon metni hariç); parolalı ve Excel 95
  dosyaları açık mesajla. Fikstürler: word-extractor (MIT) ve Apache POI (Apache-2.0) test verisi, fuzz dosyaları dahil.
- **OCR** (tesseract.js WASM, İngilizce + Türkçe, çevrimdışı): görseller ve metin katmanı olmayan PDF sayfaları.

### Doğrulandı
- `tests/ocr.test.ts` ağsız bir ad alanında (`unshare -rn`) geçti. Linux için `electron-builder --dir` paketi üretildi; paketin
  kendi Electron'u ve `files-worker.js`'i ile ağsız ortamda görsel + taranmış PDF okundu. Bu deneme, Tesseract'ın her zaman
  "-lstm" olmayan çekirdeği yüklediğini ortaya çıkardı (paket dışlamaları buna göre).

### Değişti
- Yeni bağımlılıklar `cfb`, `word-extractor`, `tesseract.js`, `@tesseract.js-data/{eng,tur}` (tam sürüm, `npm audit` temiz);
  `THIRD_PARTY_NOTICES.md` yeniden üretildi. `tsconfig.node.json` → `allowImportingTsExtensions`. `.gitattributes`: .doc / .xls /
  .ppt / .gz / .wasm ikili.

## 2026-10-15 — Faz 5: ajanlar web sayfası okur, özel rapor, özel GitHub skill'leri, MCP kaynakları ve istemleri

### Eklendi
- **`browser` izni uygulanır:** `web_fetch` (tüm sağlayıcılar) — SSRF koruması (her adımda DNS, yalnızca genel adresler, IP
  sabitleme, yönlendirme denetimi), 3 MB / 20 sn, metin türleri. `tests/web.test.ts`, `tests/webFetch.test.ts` (yerel sunucu).
- **Özel rapor:** Raporlar → Özel; lider istenen konuda projenin verisinden yazar (`reports:generateCustom`); Demo aynı veriden özet.
- **Özel GitHub depolarından skill:** anahtar zincirinde token; yalnızca herkese açık indirme bulunamazsa, yalnızca api.github.com'a.
- **MCP kaynakları ve istemleri:** `apps_resources`, `apps_read_resource`, `apps_prompts`, `apps_get_prompt` (SDK ile bellek içi
  sunucuda yanıt şekilleri doğrulandı).

## 2026-10-15 — Faz 4: Gemini ve yerel modeller (OpenAI uyumlu uç nokta), Codex'e Agentbits araçları

### Eklendi
- OpenAI sağlayıcısında **Uç nokta**: OpenAI / Google Gemini / Ollama / LM Studio / başka bir OpenAI uyumlu adres
  (migration v13 `providers.base_url`; `shared/endpoints.ts` + `tests/endpoints.test.ts`). Yerel sunucuda anahtar gerekmez;
  anahtar yalnızca HTTPS'e ya da bu bilgisayara gider. Model listesi sunucunun `/models`'ından.
- **Codex** görevlerde her zaman Agentbits MCP köprüsünü alır: bağlantılar, dosyalar, skill'ler, uygulamalar, `team_status`.

### Doğrulandı
- Adaptör, sahte yerel bir OpenAI uyumlu sunucuya karşı uçtan uca denendi: anahtarsız istek (başlık yok), `/models`, akış,
  araç çağrısı turu, klasik `max_tokens`, uzak uçta anahtarsız istek reddi. Gemini temel adresi ve `models.list` / araç / görsel
  desteği Google'ın resmi cookbook'undan doğrulandı (ai.google.dev bu ağdan erişilemedi). Gerçek Gemini / Ollama / Codex ile denenmedi.

### Düzeltildi (CI'ın yakaladıkları)
- Git kimliği tanımlı olmayan makinede birleştirme "Committer identity unknown" ile düşüyordu → "Agentbits" kimliği.
- Windows'ta ekip farkındalığı dosya yollarını küçük harfle gösteriyordu; worktree testi CRLF'den bağımsız.

## 2026-10-15 — Paralel yazılımcılar: çoğalt, iş dağıtımı, bağımlılıklar, farkındalık, git worktree (ADR-025)

Sahibin isteği: çoğaltılan yazılımcılar işi paylaşsın, birbirinden haberdar olsun, paralel ama gerektiğinde sırayla bitirsin.

### Eklendi
- **Ajanı çoğalt** (`agents:duplicate`, Organizasyon → Ajanlar → Çoğalt).
- **İş dağıtımı:** liderin ekip listesinde açık iş sayısı + "aynı roldekilere dağıt" kuralı; boştaki **ikiz** meşgul ikizin
  sıradaki görevini devralır (Ayarlar → Genel, varsayılan açık); Demo lideri eşitlikte en az yüklüye verir.
- **Görev bağımlılıkları** (migration v11): liderin `"after"` alanı, zamanlayıcı bekler, "Previous steps" ile önceki raporlar,
  kartta "… bekleniyor"; Demo "sonra / then" içeren isteği zincirler.
- **Ekip farkındalığı:** "Team right now" bölümü, `team_status` aracı, aynı dosyaya ikinci yazana ⚠️.
- **Görev başına git worktree** (proje ayarı, migration v12): dal + kopya, commit, bitince `--no-ff` birleştirme, kirli klasörde
  "Şimdi birleştir", çakışma ajana döner; depo hook'ları çalışmaz.
- Testler: `team.test.ts`, `worktree.test.ts` (gerçek git), `leadComms` (`resolveAfter`); v10→v11 ve çoğaltma SQL'i bellekte SQLite ile.

### Güvenlik
- `tests/redact.test.ts`: anahtar biçimli örnekler parçalardan kurulur. GitHub secret scanning bir **uydurma** Google anahtarı
  örneğini işaretlemişti (uyarı #1, "testlerde kullanılıyor" olarak kapatıldı; gerçek anahtar yoktu).

## 2026-10-15 — IPC şeması, yerel yol yetkisi, büyük veri (Faz 3, 2. kısım: #13, #27)

### Eklendi
- **#13 IPC şeması:** `src/shared/ipcSchema.ts` — 127 metodun her argümanının türü; `checkArgs` her çağrıyı denetler
  (fazla argüman, yanlış tür, NaN → "geçersiz istek"). `satisfies Record<ApiMethod, …>`: şeması unutulan metot typecheck'i
  kırar; `tests/ipcSchema.test.ts` `Api` ile birebir eşleşmeyi ve olumsuz örnekleri denetler. Yeni metot ekleme adımlarına
  şema girdisi eklendi (CLAUDE.md kural 1, ARCHITECTURE §4.1).
- **#13 yerel yollar** (`src/main/pathGrants.ts`): yol, main'in dosya penceresinden ya da preload'un gerçek bir sürüklenen /
  seçilen `File`'dan ürettiği yoldan geldiyse kabul edilir (`grant-path`, 30 dk); başka bir yol için yerel onay penceresi.
  Kapsam: `files:add`, `skills:preview` (yol), değişen SSH `keyPath`. Ele geçirilmiş bir renderer artık `~/.ssh/id_rsa`'yı
  sessizce dosya deposuna alamaz.
- **#27 büyük veri:** `tasks:board(doneLimit)` (bitmemişlerin hepsi + proje başına en yeni 200 bitmiş, pencere fonksiyonu) +
  `doneTotals`; panoda "N eski görevi göster". `reports:list(perProject)` proje başına 300 + "Daha eski raporları göster".
  Dosya deposu kotası `filesQuotaMb` (varsayılan 5 GB; `filesRepo.storedBytes()` içerik adresli, proje klasörü dosyaları hariç;
  `addFromPaths`, `addFromBytes`, `file_save`). Sorgular bellekte SQLite ile denendi.

## 2026-10-15 — Güvenlik ve sınırlar (Faz 3, 1. kısım: #03, #08, #18, #21, #13'ün ayar kısmı)

### Eklendi
- **Ayarlar → Güvenlik ve sınırlar** (`features/settings/LimitsSection.tsx`): görev çalışması başına süre (varsayılan
  **120 dk**), token ve maliyet tavanı; denetim kaydı saklama süresi (varsayılan 180 gün); ajan CLI'larına aktarılacak ek
  ortam değişkeni adları; transkript maskelemesinin her zaman açık olduğu bilgisi.
- **#03 CLI ortamı izin listesiyle:** `agentEnv()` (`shared/settingsRules.ts`) — PATH, kullanıcı klasörleri, proxy, dil,
  sertifika değişkenleri, CLI'ın kendi önekleri + kullanıcının ek adları. Bulut anahtarları, token'lar, `SSH_AUTH_SOCK`
  (SSH anahtarlarına bağlantı izinsiz erişim), `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE` geçmez. `spawnLines` artık
  `process.env`'i kendisi almaz (`inherit` zorunlu alan).
- **#18 çalışma tavanları:** süre zamanlayıcısı + her kullanım deltasında token / maliyet denetimi → `limitStop()` (görev
  bekletilir, `#general` ve görev akışında neden). Aynı ajanın sohbet + görev eşzamanlılığı 📄 (sohbette dosya / kabuk aracı yok).
- **#08 iptal:** `ActiveRun.halt` → `AgentCtx.signal` → `shared/cancel.ts` (`cancellable`): durdurulan çalışmanın DB sorgusu
  ve SSH komutu hemen kesilir (PG/MySQL soket, SQL Server `cancel()`, SSH oturumu). `tests/cancel.test.ts`.
- **#21:** `logsRepo.add` transkript satırını ve meta'sını (tam prompt dahil) `redactSecrets` / `redactDeep` ile maskeler
  (`shared/redact.ts`, `tests/redact.test.ts`); `pruneAudit()` + `auditRetentionDays`.
- **#13 (kısmen):** `settings:update` her anahtarı ve türü denetler (`validateSettingsPatch`; bilinmeyen anahtar, yanlış tür,
  sınır dışı sayı → çevrilmiş hata). `tests/settings.test.ts`.

### Değişti
- `DEFAULT_SETTINGS` `shared/settingsRules.ts`'e taşındı; renderer store'u da onu kullanır (iki kopya ayrışıyordu).

## 2026-10-15 — Lider ↔ ekip iletişimi (Faz 2)

Sahibin kararı: **yalnızca lider** ajanlarla konuşur (görev verir, biten işleri ve notları görür, göreve not bırakır);
ajanlar birbirine doğrudan yazmaz.

### Eklendi
- Liderin sistem prompt'unda **"Recently finished work"**: projenin `in_review` / `done` son 8 görevi, atananı ve son
  raporunun özeti (Summary + Notes, ≤400 karakter). `tasksRepo.recentlyFinished`, `reportsRepo.latestForTask`.
- Lider yanıtında ```` ```message ```` bloğu (`[{"task": "TA-3", "text": "…"}]`): not görevin akışına liderin mesajı olarak
  yazılır; görev çalışıyor ya da onay bekliyorsa ayrıca sıraya girer ve mevcut adımdan sonra ajana
  "Note from your project lead" olarak iletilir. Bilinmeyen / başka projenin anahtarı reddedilir ("⚠️ … not iletilmedi").
  Bloklar yalnızca proje liderinin yanıtından okunur; çalışanlarınki yok sayılır.
- `src/shared/leadComms.ts` (`parseLeadMessages`, `reportExcerpt`) + `tests/leadComms.test.ts` (geçersiz öğeler, sınırlar,
  başka blok türleri, TR/EN rapor başlıkları).
- Migration **v10**: `agent_instructions.source` (`user` | `lead`, eski satırlar `user`), `idx_reports_task`. v9→v10 yükseltmesi,
  CHECK kısıtı ve yeni sorgular bellekte SQLite ile denendi (sorgu planı indeksi kullanıyor).
- Demo lideri: mesajda projenin bir görev anahtarı geçerse o göreve not iletir (özelliği anahtarsız denemek için).
- Ajan terminalindeki "N talimat sırada" ipucunda liderin notları "Liderden:" etiketiyle.

### Değişti
- Liderin "Direct user interventions" bağlamı yalnızca kullanıcının talimatlarını içerir (liderin kendi notları tekrar edilmez).
- `instructionTurn`: başlık kaynağa göre (kullanıcı / lider / karışık); Demo sağlayıcı her başlığı tanır.
- `stripBlocks` ```` ```message ```` bloklarını da sohbet balonundan çıkarır.

## 2026-10-15 — v0.1.1: açık işlerin temizliği (Faz 1)

### Değişti
- **Türkçe arayüz:** sekme adları (Sohbet, Ofis, Görevler, Raporlar, Kararlar, Tarayıcı) ve Kanban sütunları (Yapılacak,
  Devam eden, İncelemede, Bitti) Türkçe; Kılavuz, demo ve orkestratör metinlerindeki atıflar da (`locales/tr/layout.json`,
  `common.json`, `guide.json`, `tasks.json`, `demo.json`, `orchestrator.json`, `agents.json`). Sahibin kararı. `README.tr.md` uyarlandı;
  `docs/screenshots/tr/` görüntüleri henüz eski adları gösteriyor.
- **Demo sağlayıcı iş türüne göre simüle eder** (`src/shared/demoKind.ts`, `providers/mock.ts`): görev metni (eşitlikte ajanın
  rolü/yetenekleri) kod / araştırma / içerik / veri türünü seçer; adımlar, dosyalar, son adım (test yalnızca kodda), rapor
  maddeleri ("Teslim edilenler") ve inceleme notları türe uyar. Pazarlama görevi artık `src/*.tsx` düzenlemiyor.
  `tests/demo.test.ts` (`test:unit`'e eklendi). `demo.json`: `kinds.*`, `report.deliverables`; eski `report.done*`,
  `task.testsPassed`, `review.rejected` anahtarları `kinds.code.*`'a taşındı.
- **Paketleme sadeleşti** (`electron-builder.config.js`, `release.yml`): yalnızca kurulum dosyaları — Windows exe + macOS
  arm64/x64 DMG + `SHA256SUMS-*.txt`. `publish: null` (silinirse electron-builder `repository`'den GitHub'ı türetip
  `latest.yml` yazıyor — kaynakta doğrulandı), `nsis.differentialPackage: false`, `dmg.writeUpdateInfo: false`, Mac `zip` hedefi kaldırıldı.
- **GitHub Actions Node 24:** `actions/checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `download-artifact@v8` (sürümler ve
  kırıcı değişiklikler resmi sürüm notlarından kontrol edildi; kullanılan girdiler etkilenmiyor). "Node.js 20 deprecated" uyarısı biter.
- `tasksRepo.list`: biçimi bozuk cursor ve geçersiz `limit` SQL'e ulaşmaz (ajanın eklediği cursor sayfalaması gözden geçirildi ve tutuldu).
- Sürüm **0.1.1**.

### Kaldırıldı
- `permissions.ts` → `isPathAllowed()` (hiç kullanılmıyordu; yol sınırı CLI'larda zorlanır, `file_save` diske yazmaz).

### Düzeltildi (belgeler)
- `ARCHITECTURE.md` Codex sandbox satırı: `terminal && network` → `danger-full-access` diyordu; kod bunu hiçbir zaman seçmez.
- `FEATURES.md` Anthropic satırı "`require_approval` uygulanmaz" diyordu; 2026-10-13'ten beri tüm sağlayıcılarda uygulanır.
- `FEATURES.md` / `ARCHITECTURE.md` / `DEVELOPMENT.md` §8: `v*` etiket tetikleyicisi yok; paket iş akışı yalnızca elle.
- `DEVELOPMENT.md` test listesi güncel (review + demo testleri).

### Gözden geçirildi (ajanların kendiliğinden eklediği işler, sahibin kararıyla tutuldu)
- `tasks:list` cursor sayfalaması (yukarıdaki sıkılaştırmayla), `ProviderForm` API anahtarı doğrulaması (yalnızca yeni
  sağlayıcı formunda; doğru), TA-3 Kanban test senaryoları, TA-5 kontrast düzeltmeleri (beyaz / `indigo-600` 6.29:1 doğrulandı).

## 2026-10-14 — v0.1.0 yayımlandı, devir notu

### Değişti
- **v0.1.0** GitHub Releases'te yayımlandı (sahip); README'ler (EN + TR) `releases/latest`'e bağlandı (sahip).
- `release.yml`: etiket tetikleyicisi kaldırıldı. Taslak yayımlanınca oluşan `v0.1.0` etiketi iş akışını yeniden
  çalıştırmış, paketleri baştan derleyip zaten var olan Release yüzünden "Draft release" adımında düşmüştü. Sürümler artık
  yalnızca Actions → Build packages → `release_tag` ile hazırlanır.
- `CLAUDE.md`: "Güncel durum ve devir notu" bölümü (sahip, kararlar, yapılanlar, açık işler, öğrenilenler) — yeni oturumlar
  buradan devam eder. `docs/DEVELOPMENT.md` §9.3–9.4 güncel durumla; `docs/FEATURES.md` Releases satırı ✅.
- `.gitignore`: `node_modules` artık klasör olmasa da (ör. sembolik bağ) yok sayılır; yanlışlıkla commit edilen bir
  `node_modules` sembolik bağı kaldırıldı (`c1745f6` → `748f83d`; içerik yok, yalnızca ajan ortamının yolu).

## 2026-10-13 — GitHub'da herkese açık yayın hazırlığı

### Değişti
- **Lisans:** MIT (paketleme hazırlığında bir ajanın eklediği, sahibin kararı değildi) → sahibin seçimiyle **PolyForm
  Strict License 1.0.0** (resmi metin, `polyform-licenses` 1.0.0 etiketi). Kaynağı açık, açık kaynak değil: ticari olmayan
  kullanım serbest; değişiklik, türev ve yeniden dağıtım yok. Telif: Gökhan Dilman. `package.json` / kilit dosyası:
  `"license": "SEE LICENSE IN LICENSE"`, `author`, `homepage`, `repository`, `bugs` (`github.com/godilman/agentbits`).
- `electron-builder.config.js`: `copyright` Gökhan Dilman; `publish.owner` `godilman`; `extraResources` ile
  `LICENSE.txt` ve `THIRD_PARTY_NOTICES.md` pakete girer.
- `.gitignore`: veritabanı / WAL, yedek ve MCP klasörleri, `.env*`, anahtar/sertifika dosyaları, loglar, döküm ve geçici
  dosyalar, editör/işletim sistemi dosyaları.
- İş akışı adları İngilizce (`CI`, `Build packages`); taslak sürüm notu İngilizce.
- Windows CI'da `test:unit` düşüyordu: git CRLF'ye çeviriyor, `tests/i18n.test.ts` yorum satırlarını tanımıyordu. Test artık
  `\r?\n` ile bölüyor; `.gitattributes` her yerde LF tutar. `release.yml`'deki iki nokta içeren `run` satırı düzeltildi. `release.yml`: macOS paketi düşse de Windows
  paketiyle taslak Release oluşur. macOS derlemesi "<repo> not a file" ile düşüyordu: tanımsız secret'lar GitHub'da boş
  dize olarak geliyor, electron-builder boş `CSC_LINK`'i dosya yolu sanıyordu. İş akışı imza secret'larını yalnızca
  varsa dışa aktarır; `electron-builder.config.js` boş imza değişkenlerini tanımsız sayar.
- Türkçe arayüzde çevrilmemiş kalan sol panel metinleri: "Çalışan işler", "Canlı sohbet", "çalışıyor", "duraklatıldı"
  (`tr/layout.json`). `AGENTS.md`: `test:unit` her değişiklikte zorunlu.
- Belgelerdeki yerel depo yolu genel `git clone` + `cd agentbits` ile değişti; `npm install` → `npm ci`.

### Eklendi
- `docs/DEVELOPMENT.md` §9: GitHub deposu, yerel klasörü bağlama komutları, günlük git akışı, sürüm yayınlama ve
  sahibin elle yapacağı açık işler; CLAUDE.md kural 17 buraya yönlendirir.
- `README.md` (İngilizce, varsayılan) ve `README.tr.md` (Türkçe): ürün sayfası, kullanım senaryoları (her birinin hangi
  sağlayıcı/izni gerektirdiği yazılı), ekran görüntüleri, sağlayıcılar, kurulum, hızlı başlangıç, güvenlik, sınırlamalar,
  FEATURES'taki ⏳ maddelerinden yol haritası, lisans, Buy Me a Coffee. Henüz yayımlanmış kurulum dosyası olmadığı için
  indirme bağlantısı verilmez.
- `docs/screenshots/` (+ `tr/`): Demo modunda, boş bir profilde, örnek verilerle alınmış 8 ekran görüntüsü (256 renk PNG).
- `CONTRIBUTING.md` (lisans nedeniyle: katkı hazırlamak için değişiklik izni + katkı sözü), kök `SECURITY.md` (GitHub
  özel güvenlik bildirimi; iç sınırlar `docs/SECURITY.md`'de kalır), `THIRD_PARTY_NOTICES.md` ve üreticisi
  `scripts/third-party-notices.mjs` (`npm run notices`).

### Doğrulandı
- Sır taraması (detect-secrets + desenler): anahtar, token, özel anahtar, DB/log dosyası yok. Yerel klasörde git geçmişi
  yoktu; GitHub deposu tek temiz commit'le başladı.
- Temiz kurulum: boş veri klasöründe veritabanı kendiliğinden oluşur; ajan, sağlayıcı, bağlantı, görev yok; onboarding ve
  Demo çalışır.
- Bağımlılık lisansları: pakete girenlerin hepsi MIT / ISC / BSD / Apache-2.0 / 0BSD / Unlicense; GPL yok
  (`caniuse-lite` CC-BY-4.0 yalnızca derleme aracı, pakete girmez).

## 2026-10-13 — Güvenlik incelemesi, ikinci tur

### Düzeltildi
- **SSH `sed`:** yalnızca ilk betik denetleniyordu; `sed -n -e '1p' -e '1e true'` okuma sayılıyordu. Artık her `-e` /
  `--expression` betiği (ya da `-e` yoksa ilk işlenen) `<aralık>p` olmalı; diğer tüm seçenekler okuma dışı.
- **SQL tırnaklı adlar:** `"pg_read_file"(…)`, `` `load_file`(…) ``, `[xp_cmdshell](…)` denetimi aşıyordu (tırnaklı adlar
  tamamen siliniyordu). Tırnaklı ad artık metniyle denetlenir (sözcük olmayan karakterler `_` olur); PG `U&"…"` adları admin.
  Dizelerdeki ters eğik çizgi hem MySQL hem standart SQL kuralıyla okunur, katı sonuç alınır
  (`'\\' , pg_read_file(…) -- '` gizlenemez).
- **İnceleme kararı:** iç içe bir `{"approved": true}` dıştaki `false`'u geçersiz kılabiliyordu. Artık yalnızca en dıştaki
  nesneler; nesnede birden fazla `approved` ya da çelişen kararlar → karar yok (görev kullanıcıya kalır).
- **Salt-okunur veritabanı kullanıcısı zorunlu:** ajanın her okuma (SELECT) sorgusu yalnızca bağlantıdaki salt-okunur
  kullanıcıyla çalışır; tanımlı değilse sorgu reddedilir (`main:connections.denied.readOnlyLoginRequired`). Böylece
  denetleyicinin kaçırdığı bir ifade de veritabanında yalnızca SELECT yetkisine çarpar. Ajan istemi ve
  `connections_list` (`readsAvailable`) bunu baştan söyler; düzenleyicide alan "zorunlu" olarak işaretli. Yazma / admin
  sorguları ana kullanıcıyla (Production'da onayla) çalışmaya devam eder; şema okuma uygulamanın kendi sabit sorgularıdır.
- **Temizlik beklemesi:** `settled()` artık süre dolunca `false` döner; "Çalışma verisini sıfırla" ve proje durdurma
  işler bitmediyse `orchestrator:errors.stillRunning` hatasıyla durur (önceden 10 sn sonra başarılı sayılıyordu).
  Beklerken zamanlayıcı yeni iş başlatmaz (`quiescing`). Kapanışta (`closing`) hiçbir görev başlamaz; onay bekleyen
  çalışma veritabanı kapandıktan sonra yürümez.
- **Uygulamalar (MCP):** sunucunun stderr'i ve hata metinleri env / başlık değerleri, Bearer anahtarları ve OAuth
  anahtarlarından arındırılır (`redactApp`); ajana yalnızca arındırılmış kısa hata gider, stderr yalnızca denetim
  kaydına. Kapanışta (`closeAllApps`) ya da bir uygulama kapatılırken açılmakta olan bağlantı yeniden açılmaz
  (`epoch` + `shuttingDown`).
- **MCP SDK 1.31.0 (GHSA-6qxp-vccf-f47h):** kurulu SDK 1.31.0'dan eskiyse OAuth girişleri reddedilir
  (`main:apps.errors.sdkOutdated`). `issuer` taşımayan eski OAuth kayıtları her açılışta silinir; uygulama "Yeniden giriş
  yap" der (`dropUnboundOAuth`). Giriş ipucu: yalnızca güvenilen sunuculara giriş yap, açılan sayfayı kontrol et.
- Olumsuz örnekler `tests/connections.classify.test.ts` ve `tests/review.test.ts`'e eklendi.

### Yükseltme notu
- `package.json` / kilit dosyası SDK 1.31.0 ister; eski `node_modules` ile 1.30.1 kalır. **`npm ci`** ile temiz kurulum
  yapın, sonra paketleyin. Veritabanı bağlantılarında ajanların okuyabilmesi için salt-okunur kullanıcı tanımlayın.

## 2026-10-13 — Güvenlik sertleştirmesi (bağımsız inceleme, 27 bulgu)

Durum tablosu ve açık kalanlar: [SECURITY.md](SECURITY.md), karar: ADR-024.

### Değişti
- **SSH okuma:** `readUnsafe()` (`shared/connectionRules.ts`) — liste eşleşse bile program çalıştırabilen / dosya
  yazabilen komutlar okuma sayılmaz (yorumlayıcılar, sarmalayıcılar, `sed` betikleri, `sort -o/--compress-program`,
  `uniq` çıktı dosyası, `ss -K`, `ip` değişiklikleri, `journalctl` bakım, `find` eylemleri, `tail -f`, `date -s`,
  değiştiren `docker`/`systemctl` alt komutları). Varsayılan listeden `awk` çıktı, `ip r*` eklendi; `"cmd *"` argümansız
  `cmd`'yi de eşler. Yeni neden metni "okuma sayılmaz".
- **SQL:** `WITH … SELECT INTO`, `INTO OUTFILE/@var`, MySQL `/*! */`, dosya / dblink / oturum / ayar fonksiyonları admin;
  `nextval`, `NEXT VALUE FOR`, advisory lock, `LOCK IN SHARE MODE` write.
- **Onay:** "Her görevden önce onay" tüm sağlayıcılarda (Anthropic/OpenAI dahil). Onaydan sonra yetki yeniden
  denetlenir (`stillAllowed`); izin düşürme, bağlantı/uygulama düzenleme-silme, ajan silme bekleyen istekleri reddeder.
- **Codex:** `danger-full-access` kaldırıldı → `workspace-write` (+ ağ izniyle `sandbox_workspace_write.network_access`);
  `fs_read` kapalı Codex ajanı çalışmaz. **Claude Code:** `--restricted` (2.1.248+) / `--setting-sources user`.
  CLI sıfır olmayan kodla biterse çalışma başarısız; Unix'te süreç grubu durdurulur.
- **Yaşam döngüsü:** bekletme listesi ve genel duraklatma kalıcı (`settings.orchestrator.held/paused`); açılışta yarıda
  kalan görevler bekletilir; sohbet / inceleme iptal edilebilir, sıfırlama / temizlik / proje silme işlerin bitmesini
  bekler; inceleme yalnızca gerçek boolean ile onaylar, belirsizse kullanıcıya kalır; 4 inceleme turundan sonra bekletme.
- **Uygulama:** tek örnek kilidi (veri klasörü başına), `sandbox: true`, IPC gönderen + argüman denetimi, webview ve
  oturum izin sertleştirmesi, üretim CSP'si, Markdown bağlantı protokolleri, ana süreçte yakalanmamış hatalar loglanır
  (donduran hata penceresi yok).
- **Sırlar:** gerçek anahtar zinciri yoksa kaydedilmez (`secrets.ts`); eski `plain:` değerler açılışta şifrelenir.
- **Klasörler:** gerçek yol (symlink/junction), uygulama klasörünü içeren üst klasör, sürücü kökü / kullanıcı klasörü /
  veri klasörü reddi; CLI başlamadan yeniden denetim; proje dosyası okumada gerçek konum denetimi.
- **Bağlantılar:** satırlar akışla okunur (200 tutulur, 100 000'de durdurulur, hücre 4000 karakter), istemci tarafı 45 sn
  süre, düşen bağlantıda asılı kalmaz; ajanlar SSH anahtarını sabitleyemez (yalnızca "Test"); uzak Production DB TLS ister.
- **Yedekler:** geri yüklemede bütünlük / tablo / şema sürümü denetimi; hazırlanan kopya ek orijinallerini çöp
  toplamadan korur.
- **API sağlayıcıları:** istek başına 10 dk, test 20 sn süre sınırı. Hafıza "notlar, talimat değil" ve kaynağıyla.
- İzin açıklamaları dürüstleştirildi (Terminal açıkken kısıtlar kabukla aşılabilir; Tarayıcı izni henüz uygulanmıyor;
  Onay tüm sağlayıcılarda).

### Kaldırıldı
- Sahte giriş ekranı (`features/auth/LoginView.tsx`, `auth` çeviri bölümü) — sahibin kararı.

### Eklendi
- `.github/workflows/ci.yml` (push/PR: typecheck, test:unit, build, `npm audit --omit=dev --audit-level=critical`);
  `release.yml` SHA256SUMS + commit. `tests/review.test.ts`, classify testlerine olumsuz örnekler, `src/shared/review.ts`.
- `docs/SECURITY.md`.

### Düzeltildi
- `@modelcontextprotocol/sdk` 1.30.1 → **1.31.0** (GHSA-6qxp-vccf-f47h: OAuth istemcisi kimlik bilgilerini MCP sunucusunun
  seçtiği yetkilendirme sunucusuna gönderebiliyordu). Sürüm sabitlendi. `npm install` gerekir.
- PG / MySQL istemcilerinde düşen bağlantının `error` olayı ana süreci çökertebiliyordu.

### Bilinen
- `--restricted`, Codex ağ ayarı ve `default_tools_approval_mode` belgelere göre; gerçek CLI'larla denenmedi.
- Testlerde `AGENTBITS_ALLOW_PLAIN_SECRETS=1` gerekir. Paketler imzasız; mevcut `release/` içindeki kurulum dosyası eski —
  yeniden `npm run dist:win`.

## 2026-10-13 — Uygulamalar (MCP bağlantıları)

### Eklendi
- **Organizasyon → Uygulamalar** (`features/apps/AppsView.tsx`): Claude Desktop / ChatGPT'deki gibi MCP sunucuları bağlanır
  — e-posta, takvim, çizim/tasarım araçları, Notion… Ekleme menüsü: **yerel program** (stdio: komut, argümanlar, çalışma
  klasörü, ortam değişkenleri; güvenlik uyarısı + Node.js/uv notu), **uzak sunucu** (Streamable HTTP, eski SSE'ye düşer;
  ek başlıklar; isteğe bağlı **OAuth** girişi), **JSON yapıştır** (README'deki `mcpServers` parçası) ve **Claude Desktop'tan al**
  (`claude_desktop_config.json`). Ayrıntı sekmeleri: Araçlar (araç başına Otomatik / Önce bana sor / Kapalı; salt-okunur ve
  "veri değiştirir" rozetleri), Erişim (ajan başına), Ayarlar, Denetim kaydı. "Bağlan ve araçları listele", Giriş yap/Çıkış yap,
  Kullanımda anahtarı, satır içi silme onayı.
- Ajan düzenleyicide **Uygulamalar** bölümü (`AgentApps.tsx`): bu ajanın kullanabileceği uygulamalar (anahtarlar).
- Main: `src/main/apps/` — `client.ts` (resmî `@modelcontextprotocol/sdk` istemcisi; bağlantı ilk kullanımda açılır, 10 dk
  boşta kapanır; OAuth: dinamik istemci kaydı + PKCE, 127.0.0.1:33418 geri dönüş, `shell.openExternal`), `repo.ts`
  (env/başlık değerleri ve OAuth durumu `safeStorage` ile şifreli), `service.ts` (araç listesi, politika, onay, denetim,
  `## Apps` prompt bölümü, içe aktarma). `src/shared/apps.ts`: tipler, `defaultPolicy`, `agentToolName`
  (`app_<sunucu>__<araç>`), `parseMcpConfig`.
- IPC `apps:list|save|delete|test|signIn|signOut|setPolicy|setPermission|import`, olay `apps:changed`. Migration **v9**:
  `mcp_servers`, `mcp_tool_policies`, `mcp_permissions`. "Her şeyi sıfırla" bunları da siler.
- Ajanlar: izinli uygulamaların araçları Anthropic/OpenAI'de yerel araç, Claude Code'da MCP köprüsü, **Codex'te**
  `-c mcp_servers.agentbits.*` ile (yalnızca uygulaması olan ajana; `default_tools_approval_mode="approve"`,
  `startup_timeout_sec=30`) verilir; Demo görevde adı geçen uygulamanın bir aracını dener ve raporda "Kullanılan
  uygulamalar" yazar. "Önce bana sor" araçları Production onaylarıyla aynı sol alt panelde (başlık "Onay gerekiyor",
  argümanlar görünür) + toast. Sonuçlar `<<<APP RESULT … UNTRUSTED DATA>>>` zarfında; her çağrı `audit_log`'a `app:<araç>`.
- `tests/apps.test.ts` (`npm run test:unit`): yapılandırma ayrıştırma, araç adları, varsayılan politikalar. Kılavuz →
  "Nerede ne var"a Skill'ler ve Uygulamalar. Yeni çeviri bölümü `apps` (en + tr). ADR-022.

### Düzeltildi
- MCP köprüsü (`connections/bridge.ts`): iki ajan aynı anda ilk kez başladığında ikincisi henüz dinlemeyen sunucunun
  portunu (0) alıyordu → "fetch failed". Başlatma artık tek bir paylaşılan söz (promise).

### Bilinen
- Gerçek Codex ve Claude Code CLI ile denenmedi (sahte CLI'larla uçtan uca test edildi); OAuth yalnızca SDK'nın demo
  yetkilendirme sunucusuyla. Yalnızca MCP araçları desteklenir (kaynaklar/istemler/sampling yok). `npm install` gerekir
  (yeni bağımlılık `@modelcontextprotocol/sdk`).

## 2026-10-13 — Skill'ler

### Eklendi
- **Organizasyon → Skill'ler** (`features/skills/`): Agent Skills biçimindeki talimat paketleri (`SKILL.md` + başvuru
  dosyaları / betikler). "Skill ekle": GitHub adresi (`owner/repo`, `/tree/<ref>/<yol>`, `/blob/…/SKILL.md`; herkese açık
  depoların arşivi tek istekle indirilir), klasör, `.zip`, tek `.md` ya da uygulamada yeni yaz. Önce **önizleme**: bulunan
  skill'ler, dosya sayısı/boyutu, betik rozeti, şüpheli satır uyarıları, "zaten kurulu". Ayrıntı: SKILL.md önizleme, dosya
  listesi, atama kartı (ajan / birim — alt birimler dahil, kök = herkes), düzenle, kaynaktan güncelle, devre dışı bırak, sil.
- Ajan düzenleyicide **Skill'ler** bölümü (doğrudan ya da hangi birim üzerinden geldiği).
- Main: `src/main/skills/` (`repo.ts`, `source.ts`, `service.ts`), `src/shared/skills.ts`. Sınırlar: arşiv 50 MB, skill
  10 MB, dosya 2 MB, 300 dosya; hiçbir şey çalıştırılmaz. Migration **v8**: `skills`, `skill_files` (BLOB),
  `skill_assignments` + trigger'lar. IPC `skills:*`, olay `skills:changed`.
- Ajanlar: prompt'ta `## Skills` (ad + açıklama), içerik `skill_read` aracıyla (API, Claude Code köprüsü, Demo); Codex
  çalışma başına kopyaları okur; terminal izinli Claude Code betikli skill'in kopya klasörünü alır. Demo görevle örtüşen
  skill'i okur, raporda "Kullanılan skill'ler". `tests/skills.test.ts`. Yeni çeviri bölümü `skills`. ADR-023.

### Bilinen
- Özel GitHub depoları desteklenmez (token yok). Uygulamada düzenlenen skill kaynaktan güncellenince düzenleme kaybolur
  (uyarılır). Ajanın eski "yetenekler" (`agents.skills`) etiketleri ayrı bir özelliktir.

## 2026-10-13 — Model seçimi listeden

### Eklendi
- `src/shared/models.ts`: sağlayıcı türüne göre önerilen modeller (`MODEL_CATALOG`, kısa notlarla) ve `DEFAULT_MODEL`.
  Claude Code: `sonnet`, `opus`, `haiku`, `fable`, `opusplan`, CLI varsayılanı; Anthropic API: Claude Sonnet/Opus/Haiku 5.5,
  Fable 5.1; OpenAI API: GPT-5.6 Terra/Sol/Luna, GPT-5; Codex CLI: GPT-6.1 Sol, GPT-6 Astra, GPT-6 Luna, CLI varsayılanı.
- `features/settings/ModelSelect.tsx`: model alanı artık açılır liste — "Önerilen", (API'lerde) "Hesabındaki diğer modeller"
  ve "Özel model adı…" (listede olmayan yeni modeller için). Kayıtlı ama listede olmayan bir model kaybolmaz, özel alanda görünür.
- IPC `providers:models({ kind, providerId?, apiKey? })` → `src/main/providers/models.ts`: Anthropic `/v1/models` ve OpenAI
  `/v1/models` (yalnızca sohbet modelleri; görsel/ses/embedding vb. ve GPT-6 elenir), 10 sn zaman aşımı, hata metinle döner.
  Formda yazılan anahtarla da çalışır (700 ms gecikmeli); anahtar main'de kalır.
- Ayarlar → Sağlayıcılar: mevcut sağlayıcının modeli satırdaki listeden değiştirilebilir (önceden silip yeniden eklemek gerekiyordu).

### Değişti
- Sağlayıcı ekleme formu ve ajan düzenleyicideki serbest metin model alanları kaldırıldı. Ajanda ilk seçenek
  "Sağlayıcının modeli (…)"; ajanın sağlayıcısı başka türe geçince modeli sıfırlanır ('sonnet' OpenAI'de geçersiz olurdu).
- Yeni OpenAI sağlayıcısının varsayılan modeli `gpt-5` → `gpt-5.6-terra`. Kayıtlı sağlayıcılar değişmez.

### Bilinen
- Katalog 2026-10-13 itibarıyla hazırlandı; yeni modeller çıktıkça `src/shared/models.ts` güncellenmeli (o zamana kadar
  API'lerde canlı liste ve "Özel model adı…" kullanılabilir). GPT-6 modelleri OpenAI API sağlayıcısında listelenmez:
  Agentbits'in kullandığı Chat Completions bu modellerle araç çağırmayı desteklemiyor (Codex CLI'da kullanılabilir).

## 2026-10-13 — Eski veritabanlarında "Defne" → "Zeynep"

### Düzeltildi
- Eski sürümlerin seed ettiği başlangıç ekibi mevcut veritabanlarında kaldığı için kurulum ekranındaki canlı ofis
  önizlemesinde (ve tüm arayüzde) "Defne" görünüyordu. Yeni `src/main/core/legacy.ts` → `renameLegacyDefne()` açılışta
  bir kez çalışır: ajanı "Zeynep" yapar, adı sohbet, görev, çalışma, log, hafıza, karar, rapor ve talimat metinlerinde
  değiştirir (Türkçe ekler uyarlanır: "Defne'nin" → "Zeynep'in", "Defne'ye" → "Zeynep'e"). Dosyalara ve denetim kaydına
  dokunmaz; zaten "Zeynep" varsa atlar; `settings` bayrağıyla bir daha çalışmaz, sonradan "Defne" adıyla oluşturulan
  ajanları değiştirmez.

## 2026-10-13 — Geri bildirim düğmesi

### Eklendi
- Durum çubuğunun sağında, kahve düğmesinin solunda **Geri bildirim / Feedback** düğmesi (dar pencerede yalnızca ikon).
  Form yerine bir modal açar (`features/feedback/FeedbackModal.tsx`, portal ile `document.body`'ye):
  - **Öneri:** ne istediğini, neden işe yarayacağını, nasıl çalışmasını hayal ettiğini ayrıntılı yazmasını ister.
  - **Hata:** hangi aşamada, hangi ekranda/düğmede, ne beklerken ne olduğunu, hata mesajını ve ekran görüntüsünü ister.
  - **Teşekkür:** kullandığı için teşekkür eder, "Buy me a coffee" düğmesi ve 1–5 yıldız puan.
  - Her bölümde adres (tıklayınca kopyalanır) ve kullanıcının e-posta uygulamasını açan düğme; "Adresi kopyala".
- IPC `app:feedbackMail(kind, rating?)`: main, sabit `FEEDBACK_EMAIL` adresine `mailto:` açar; konu ve gövde şablonu seçili
  dilde, hata bildirimine uygulama sürümü, işletim sistemi ve dil eklenir. Adres renderer'dan alınmaz.
- `src/shared/support.ts`: `SUPPORT_URL`, `FEEDBACK_EMAIL`, `FeedbackKind` (main'deki `SUPPORT_URL` sabiti buraya taşındı).
- Çeviriler: `common:feedback.*`, `main:feedback.*` (en + tr); Kılavuz → Nerede ne var → "Durum çubuğu".

## 2026-10-13 — Çoklu dil: İngilizce + Türkçe

### Eklendi
- **i18n altyapısı** (i18next `^25` main + renderer, react-i18next `^15`): `src/shared/i18n.ts` (`LANGUAGES`, `resolveLanguage`,
  `intlLocale`, `createI18n`, `I18nKey`, `ts`), `src/shared/i18n-types.d.ts` (anahtarlar İngilizce dosyalardan tip
  denetimli), `src/main/i18n.ts`, `src/renderer/src/i18n.ts`.
- **Dil dosyaları** `src/shared/locales/{en,tr}/<bölüm>.json`, 21 bölüm (common, layout, onboarding, guide, auth, org,
  agents, connections, project, chat, office, terminal, tasks, reports, decisions, files, settings, main, orchestrator,
  templates, demo). Türkçe metinler önceki arayüzle birebir aynı; İngilizce yeni.
- **Dil seçimi:** Ayarlar → Genel → Dil (`data-testid="settings-language"`) ve Onboarding ilk adımı
  (`onboarding-language`); `settings.language` (varsayılan `'auto'` = işletim sistemi dili, desteklenmiyorsa İngilizce).
  Değişiklik anında uygulanır; main dokunulmamış varsayılan adları ("Organizasyon", "Varsayılan Proje", "Çekirdek Ekip",
  "Takım lideri") yeni dile çevirir (`relabelDefaults`).
- `tests/i18n.test.ts` (`npm run test:unit` içinde, tümü `npm run i18n:check`): diller arası aynı anahtarlar, dile özgü
  çoğul biçimleri, aynı `{{yer tutucular}}`, boş değer/dizi yok, tüm dosyalar kayıtlı, kaynakta Türkçe harfli sabit metin yok.
- `docs/I18N.md`: kurallar, kullanım, denetim, yeni dil ekleme (topluluk için İngilizce adımlar).
- `lib/format.ts` → `ago()` ("5 dk önce" / "5 min ago", "az önce").

### Değişti
- Tüm renderer ekranları, main süreç hataları/bildirimleri, orkestratörün sohbet/sistem mesajları ve durum notları,
  görev/günlük raporları, şablon içerikleri (6 şablon, 32 ajan) ve Demo sağlayıcı metinleri çeviri anahtarlarına taşındı.
  Tarih/sayı biçimi seçili dile göre (`'tr-TR'` sabiti kaldırıldı).
- Ajanlara giden metinler İngilizce: çalışan rapor başlıkları ("## Summary", "## What was done"…), bağlantı seviyesi ve dosya
  türü etiketleri, `DENIED:` mesajları, yalnızca dosya gönderildiğinde varsayılan talimat ("Review the attached files.").
- Bağlantı sınıflandırması etiketlerden ayrıldı: `src/shared/connectionRules.ts` (testler doğrudan yükler);
  `shared/connections.ts` onu yeniden dışa aktarır ve çevrilmiş etiketleri ekler. `classifyCommand` gerekçeyi kod olarak
  döndürür (`sshReasonText`).
- Dosya çıkarma worker'ı metinleri `workerData` ile alır (`extractFile(…, { t, locale })`); sayfa/slayt bölümleri
  `marker: true` taşır.
- "Her şeyi sıfırla" onay kelimesi dile göre: `SIFIRLA` / `RESET`.
- Ayarlar → Sağlayıcılar'daki Anthropic/OpenAI açıklaması düzeltildi (dosya sistemi/terminal yok; uygulamanın dosya ve
  bağlantı araçlarını kullanır).
- `react-i18next` devDependencies'te (renderer'a paketlenir); `i18next` dependencies'te (main çalışma zamanı).

### Kaldırıldı
- `build-resources/installer.nsh`: kurulum programının kendi kaydına ek olarak "Kaldır" bilgisi olmayan, uydurma adresli
  ikinci bir kayıt defteri girdisi yazıyordu.

### Bilinen
- Saklanan metinler (sohbet/sistem mesajları, durum notları, denetim kaydı, dosya notları, raporlar) yazıldıkları dilde kalır.
- Denetim yalnızca Türkçe harf içeren sabit metinleri yakalar; "Sil" gibi ASCII Türkçe kelimeler için gözle kontrol gerekir.
## 2026-10-13 — Belgeler: kapsam denetimi

Belgeler koda göre denetlendi: uygulamanın ne yaptığı ve **ne yapmadığı** eksiksiz ve doğru yazılsın diye. Kod değişmedi.

### Eklendi
- `README.md`: "Kurulum dosyası ve güncelleme (son kullanıcı)" — `npm run dist:win` → `release\Agentbits-Setup-<sürüm>.exe`,
  her sürümde `package.json` → `version` artırılır, otomatik güncelleme yok, sabit `appId` sayesinde yeni exe eskisini yerinde
  değiştirir, her kurulumda aynı kapsam ("benim için" / "herkes"), `%APPDATA%\Agentbits` korunur. "Yapmadıkları ve bilinen
  sınırlamalar" bölümü; ilk açılışın 3. adımı (boş organizasyon → Kılavuz / Çekirdek Ekip); Ayarlar → Veri yönetimi, Kılavuz,
  destek düğmesi, Reports → Token kullanımı.
- `docs/FEATURES.md` §12 **Kapsam dışı**: kendini güncellemez; CLI'ları getirmez/kurmaz; uygulama içi Claude abonelik girişi
  yok (Anthropic politikası); Gemini/yerel model yok; API sağlayıcılarıyla dosya/komut yok, $ maliyet ve bütçe yok; bulut,
  çok kullanıcı, gerçek kimlik doğrulama, telemetri yok; ajanlar tarayıcı kullanmaz; zamanlanmış görev, OS bildirimi, git
  entegrasyonu yok; doğrulanmış macOS / Linux paketi yok. Lejanta "— yok / kapsam dışı".
- `docs/FEATURES.md` §6: uygulama içi Claude girişi, CLI'ların paketlenmemesi, Gemini satırları. §11 Paketleme yeniden yazıldı:
  imza (varsayılan imzasız), yerinde güncelleme, veri korunması, otomatik güncelleme yok, macOS 🟡, Actions iş akışı 🟡, Linux yok.
- `docs/DEVELOPMENT.md` §8 "Sürüm çıkarma ve güncelleme"; `docs/DATABASE.md` §1 güncelleme/kaldırmada verinin korunması;
  `docs/PROJECT.md` sözlüğe **Kılavuz**, §3'e tek kullanıcı / kapsam dışı notu.

### Düzeltildi (eskimiş ya da yanlış bilgiler)
- Migration aralığı: `CLAUDE.md` (v1–v4) ve `docs/ARCHITECTURE.md` (v1–v3) → **v1–v7**.
- `build-resources/installer.nsh` kaldırıldığı halde `CLAUDE.md`, `ARCHITECTURE.md` ağacı ve FEATURES bilinen sorun #4'te
  anılıyordu; ağaca `icon.icns`, `entitlements.mac.plist`, `.github/workflows/release.yml` ve `features/guide/` eklendi.
- Anthropic/OpenAI "yalnızca metin — araç yok" (FEATURES §6, bilinen sorun #9) ve "yalnızca bağlantı araçları"
  (ARCHITECTURE §8): bugün bağlantı **ve** dosya araçlarını kullanırlar; dosya sistemi/terminal yok, maliyet hesaplanmaz.
  (Ayarlar → Sağlayıcılar'daki "araçsız, metin çıktı" açıklaması koddadır; bilinen sorun #9'a not düşüldü.)
- Şablon sayısı 6 (Çekirdek Ekip eklendi) — FEATURES §2, PROJECT §2, CLAUDE.md; "tüm şablon ajanlarında onay açık" →
  Atlas hariç.
- `docs/PROJECT.md`: "Seed ekibi … Defne" ve "varsayılan *Atlas*" (seed yok), Onboarding "varsayılan projenin klasörü" →
  "ilk projenin adı ve klasörü", Ayarlar'a Veri yönetimi, kısayollara `F1`, `Logo` yolu `components/common/Logo.tsx`,
  `icon.icns`; platform notu (macOS paketi denenmedi, Linux paketi yok).
- FEATURES bilinen sorun #13: `test:unit` dosya çıkarmayı da kapsar; CI yalnızca paket iş akışında.
- `CLAUDE.md`: preload köprüsüne `pathForFile`; ARCHITECTURE IPC listesine `app:openSupport`.
- `docs/RELEASE_TEMPLATE.md`: "Node 22+ gerekir" ve "SHA-256 ile imzalanmıştır" yanlıştı → Node gerekmez, CLI'lar ayrıca
  kurulur, SHA-256 yalnızca özettir; yükseltme adımları eklendi.
- `AGENTS.md`: doğrulamaya `npm run test:unit`.

### İlgili dosyalar
`README.md`, `CLAUDE.md`, `AGENTS.md`, `docs/FEATURES.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`,
`docs/DEVELOPMENT.md`, `docs/RELEASE_TEMPLATE.md`, `docs/CHANGELOG.md`

## 2026-10-13 — Boş ilk kurulum ve Kılavuz

### Eklendi
- **Kılavuz** (`features/guide/GuideDrawer.tsx`): sağda içeriği daraltan yan panel; TopBar'da "Kılavuz" düğmesi
  (`x/8` rozeti) ve `F1`. 8 adım durumdan otomatik işaretlenir: sağlayıcı, takım, ajanlar, lider, izinler (sayfa
  ziyareti), projeye takım atama, ilk iş (mesaj ya da görev), izleme. Her adımda "neden" + "nasıl" ve ilgili sayfaya
  götüren düğmeler; "Nerede ne var" (tüm proje bölümleri, Organizasyon sekmeleri, Ayarlar bölümleri) ve "Kısayollar".
- **"Çekirdek Ekip" şablonu** (`templates.ts` → `core`): eski başlangıç ekibi — Atlas (lider), Nehir, Zeki, **Zeynep**
  (QA; eski adı Defne), Kaan — kişilik, görünüm ve ajan başına izin farklarıyla. Şablon tanımına isteğe bağlı
  `persona`, `look`, `perms` alanları eklendi.
- Boş durumlar: ofiste "Ofis boş", Ekip'te "Henüz hiç ajanın yok", Chat'te "Henüz konuşacak bir lider yok"
  (Şablonlar + Kılavuz düğmeleri). Proje sekmesine çift tıklama proje ayarlarını açar.

### Değişti
- İlk kurulumda **hiç ajan, takım, görev, karar ya da mesaj yok**: boş organizasyon + tek boş proje. Onboarding'in
  2. adımı "İlk proje": ad + klasör; bitince proje açılır ve Kılavuz gelir.
- "Her şeyi sıfırla" da aynı boş hâle döner (Onboarding + Kılavuz).
- Chat önerileri genelleştirildi; yalnızca bir lider varken gösterilir.

### Kaldırıldı
- `src/main/db/seed.ts` (`seedIfEmpty`): örnek ekip, TA-1…TA-5 görevleri, ADR-1 ve karşılama mesajı.

### Bilinen
- Mevcut veritabanları değişmez (ör. Defne olduğu gibi kalır); temiz başlamak için Ayarlar → Veri yönetimi →
  "Her şeyi sıfırla" (önce otomatik yedek alınır) ya da ajanı elle yeniden adlandırın.
- Proje silmek proje klasörüne ve içindeki dosyalara asla dokunmaz (yeniden doğrulandı); yalnızca uygulamanın kendi
  verisi silinir.

## 2026-10-13 — Dağıtım: macOS paketi ve derleme iş akışı

### Eklendi
- `electron-builder.config.js` → `mac`: DMG + ZIP, arm64 ve x64 ayrı; `hardenedRuntime`, `build-resources/entitlements.mac.plist`,
  `build-resources/icon.icns`; sertifika yoksa ad-hoc imza (`identity: '-'`), sertifika + Apple kimlik bilgileri varsa noterlik.
- `package.json`: `dist:win`, `dist:mac` (`--publish never`); `dist` = `dist:win`.
- `.github/workflows/release.yml`: Windows (`windows-latest`) ve macOS (`macos-latest`, Intel paketi için `node-pty`
  x64 modülü ayrıca kurulur) paketleri; imza/noterlik isteğe bağlı GitHub secret'larıyla; `v*` etiketinde taslak Release.
- `docs/DEVELOPMENT.md` §8 "Dağıtım paketleri".

### Değişti
- Windows kurulum dosyasının adı `Agentbits-Setup-<sürüm>.exe` (boşluksuz).

### Bilinen
- macOS paketi henüz gerçek bir Mac'te / CI'da derlenmedi; yapılandırma yalnızca Linux paketiyle doğrulandı.

## 2026-10-13 — Varsayılan proje silinebilir; proje seçiciden ayarlara erişim

### Değişti
- `projects:delete`: varsayılan proje artık silinebilir. Başka proje varsa en son açılan (tercihen aktif) proje
  `projectsRepo.setDefault()` ile varsayılan olur ve `settings.workspaceRoot` onun klasörüne çekilir; tek kalan proje
  silinemez (açıklayıcı hata). Proje ayarları modalı bu durumda da "Sil…" gösterir ve rolün devredileceğini söyler.
- Proje seçicide (Ctrl+P) her satırın üzerine gelince ⚙ "Proje ayarları" düğmesi: klasörü değiştir/kaldır, arşivle, sil.
  Modal kapanınca seçiciye geri dönülür (`projectModal.fromLauncher`); silme onayı görünür alana kaydırılır.

### Neden
- Sahibin varsayılan projesi eski depo klasörüne bağlıydı ve listeden kaldırılamıyordu.

## 2026-10-13 — `mssql` 12'ye yükseltildi (npm audit)

### Değişti
- `mssql` `^11.0.2` → `^12.7.4` (`tedious` 18 → 20): `npm audit`'in uygulamayla birlikte gelen bağımlılıklarda bulduğu
  tek sorun (`tedious` → `sprintf-js` DoS uyarısı) giderildi; `npm audit --omit=dev` → 0. Sürücü kodu değişmedi
  (`drivers.ts`), bağlantı hatası yolu yeniden doğrulandı.

### Bilinen
- Kalan `npm audit` uyarılarının hepsi yalnızca geliştirme araçlarında: `electron-builder` zinciri (`@electron/get`,
  `global-agent`, `roarr`, `sprintf-js`) ve Tailwind 3 zinciri (`chokidar`, `micromatch`, `braces`, `fast-glob`,
  `postcss-*`). Paketlenmiş uygulamaya girmezler. `npm audit fix --force` **çalıştırmayın**: Tailwind'i 4'e (uyumsuz)
  ve electron-builder'ı eski bir sürüme çeker.

## 2026-10-13 — Durum çubuğuna "Buy me a coffee" destek düğmesi

### Eklendi
- Durum çubuğunun sağ ucunda amber "☕ Buy me a coffee" düğmesi (`StatusBar.tsx` → `SupportButton`); ipucu
  "Enjoying Agentbits? Buy me a coffee! ☕". Pencere 1400 px'ten darsa yalnızca ☕ görünür.
- IPC `app:openSupport`: geliştiricinin sabit destek adresini (`SUPPORT_URL` = `https://buymeacoffee.com/godilman`,
  `src/main/ipc.ts`) `shell.openExternal` ile sistem tarayıcısında açar. Adres ayar değildir ve renderer'dan
  alınmaz; ödeme sayfası uygulama içinde açılmaz. Açılır pencere, hatırlatma ya da abonelik yok.

### Değişti
- Durum çubuğu öğeleri artık iki satıra kaymaz (`whitespace-nowrap`, taşan kısım gizlenir); dar pencerede proje adı/klasör kısalır.

## 2026-10-13 — Faz 3 — Dosya ekleri

Büyük özellik isteğinin üçüncü ve son fazı. Faz 1–3 tamam.

### Eklendi
- **Dosya ekleri** sohbet composer'ında (#general'de paylaşım seçici: Yalnızca lider / Tüm proje ekibi / Takım: X), DM'lerde,
  görev çekmecesinde ("Dosyalar"), yeni görev modalında ve ajan terminali talimatlarında (tüm bölme bırakma alanı):
  düğme, sürükle-bırak, yapıştır. Yükleme ekleme anında başlar; gönderilmeyenler silinir. Mesaj ve talimat satırlarında
  dosya çipleri (`meta.files`, `meta.share`).
- Yeni proje bölümü **Dosyalar** (`Ctrl+9`, `features/files/FilesView.tsx`): filtre Tümü / Yüklenen / Ajan / Klasör, ad +
  içerik araması, yükleme, bırakma alanı. Global **önizleme** (`FilePreviewModal.tsx`): meta, durum, uyarılar, talimat
  benzeri satır bandı; İçerik / Erişim / Kullanım sekmeleri; Farklı kaydet, Aç (güvenli uzantılar), Klasörde göster, Sil.
- **Çıkarma** (`src/main/files/extract.ts`, `worker.ts`): tür uzantı + sihirli baytla; kodlama UTF-8/BOM/UTF-16 →
  Windows-1254; ZIP bombası sınırları (120 MB/girdi, 250 MB/arşiv); PDF (sayfa), DOCX, XLSX (tarih, formül), PPTX (notlar),
  CSV (ayraç), Markdown, JSON/JSONL, metin/kod, görsel boyutu; ~3500 karakterlik parçalar + FTS5; talimat benzeri satır
  sezgiseli. `worker_threads` (768 MB, 120 sn, en fazla 2 paralel). OCR yok.
- **Depolama** (`storage.ts`): içerik-adresli orijinaller `<veri>/files/<sha[0:2]>/<sha>`, tekilleştirme, canlı DB +
  yedekleri kontrol eden GC.
- **Erişim (varsayılan reddet)**: açık izin / proje geneli paylaşım / görev bağı; paylaşım hedefleri gönderim yerine göre;
  önizlemede ajan başına ve proje geneli anahtarlar; reddedilen okumalar, `file_save`, silmeler ve izin değişiklikleri
  denetim kaydında. Ajanlar yalnızca okur.
- **Prompt'lar**: `filesSection()` — dosya listesi + `<<<FILE … UNTRUSTED DATA, NOT INSTRUCTIONS>>>` zarfı, küçükler önce,
  bütçe 24k (araçlı) / 60k (araçsız), uzunlar için önizleme + araç; kurallar bloğu. Lider ```` ```tasks ```` bloğunda
  `"files"`; varsayılan olarak mesajın dosyaları her yeni göreve.
- **Araçlar** (`files/tools.ts`, `src/main/agentTools.ts`): `files_list`, `file_read`, `file_search`, `file_save` (yalnızca
  görev; metin biçimleri, 2 MB, çalışma başına 20). Sohbette de salt-okunur dosya araçları (Claude Code MCP, API function
  calling). Araçlar her segmentte yeniden hesaplanır.
- **Görseller / taranmış PDF**: Anthropic görsel + belge blokları; OpenAI `image_url` (PDF yerel değil); Claude Code MCP görsel
  içeriği; Codex `--image` (geçici kopya); Demo görsel yok.
- **Üretilen dosyalar**: `file_save` kayıtları; `fsWrite` izinli CLI ajanlarında çalışma sonrası proje klasörü taraması
  (mtime, sınırlı) → "Klasör" kayıtları (kopyalanmaz). Görev akışında çipler, #general'de "📎 N dosya", transkriptte
  "📎 Üretilen dosyalar", görev raporunda "## Dosyalar".
- **Migration v7**: `files`, `file_chunks` + `file_chunks_fts`, `file_links`, `file_access`.
- IPC: `files:list|byIds|get|pick|add|addData|delete|preview|search|saveAs|open|reveal|setAccess|setProjectShared|attachToTask|detachFromTask`;
  `messages:send(channel, content, projectId, opts?: { fileIds, share })`, `InstructionInput.fileIds`, `TaskInput.fileIds`.
  Olay `files:changed`. Tipler `FileKind`, `FileOrigin`, `FileStatus`, `FileTargetType`, `FileLinkRole`, `FileRecord`, `FileLink`,
  `FileDetail`, `FileShare`, `FileChunkView`, `FilePreview`, `FileSearchHit`, `FileListOpts`, `SendOptions`. Preload
  `pathForFile` (`webUtils.getPathForFile`). Store `filesVersion`, `filePreview`.
- Bağımlılıklar (saf JS, worker'a paketlenir): `unpdf` 1.8.1, `fflate` 0.8.3, `papaparse` 5.7.0 (+ `@types/papaparse`).
  electron-vite üçüncü main girdisi `files-worker`; `externalizeDepsPlugin` `exclude`; electron-builder `asarUnpack`
  `out/main/files-worker.js` ve `out/main/chunks/**` (Linux unpacked paketle doğrulandı).
- Testler: `tests/files.extract.test.ts`; `npm run test:unit` iki test dosyasını çalıştırır.

### Değişti
- Veri yönetimi: "Dosyalar" istatistiği ve proje başına sayı; proje temizliğinde "Dosyalar" parçası; fabrika sıfırlaması (iki
  mod) dosya tablolarını siler + FTS rebuild + GC; proje silme basamaklanır + GC; yedek silme/dönüşü GC çalıştırır.
  `DataPart` += `'files'`, `ProjectUsage.files/fileBytes`, `DataUsage.filesBytes/filesCount`.
- `main.tsx` başıboş dosya bırakmalarını yok sayar; ana pencere uygulama dışına gezinmeyi (`will-navigate`) engeller.
- Açılışta `startFiles()` (`<veri>/tmp` temizlenir, "processing" kalan dosyalar yeniden işlenir).

### Doğrulama
- `npm run test:unit`; Playwright (xvfb) uçtan uca: 11 örnek dosya (zip bombası reddedildi, bozuk PDF temiz hata, `.exe`
  desteklenmez/açılamaz, 1,2 MB metin → 334 parça, Windows-1254 CSV); Demo lider dosyaları görevine bağladı, Demo çalışan
  araçlarla okuyup özet kaydetti; sahte Claude Code: paylaşılmamış dosya reddedildi (denetlendi), sayfalama/arama/görsel/
  `file_save` çalıştı, `.exe` kaydı reddedildi, klasör çıktısı kaydedildi; sahte Codex `--image` ve kesilme notuyla satır içi
  metin aldı; sohbette Claude Code lideri MCP üzerinden salt-okunur araçları kullandı; dosyalı yönlendirme talimatı;
  yeniden başlatma kalıcılığı; temizlik ve yedek farkında GC; Faz 1 ve 2 senaryoları yeniden yeşil.

### Bilinen
- OCR yok; eski .doc/.xls/.ppt/.rtf okunmaz; DOCX üst/alt bilgi, dipnot ve gömülü görseller yok; önbellekli değeri olmayan
  XLSX formülleri formül olarak; PDF yalnızca metin katmanı, düzen/tablolar yaklaşık; talimat tespiti sezgisel; OpenAI'ye
  PDF yerel gitmez; Codex `--image` gerçek CLI ile test edilmedi, Codex sayfalayamaz; klasör taraması mtime tabanlı ve
  sınırlı; yedekler çıkarılmış metni içerir, orijinaller yedek oldukça `<veri>/files`'ta kalır; dosya başına 50 MB, gönderim
  başına 20 dosya.

### Belgeler
- `CLAUDE.md`, `README.md`, `docs/FEATURES.md` (§3c, bilinen sorunlar #37–43), `docs/ARCHITECTURE.md` (§9c),
  `docs/DATABASE.md`, `docs/PROJECT.md`, `docs/DEVELOPMENT.md`, `docs/DECISIONS.md` (ADR-020, ADR-021).

## 2026-10-13 — Faz 2: Bağlantılar (SSH / PostgreSQL / MySQL / SQL Server), izinler, Production onayı, denetim

Büyük özellik isteğinin ikinci fazı. **Faz 3** (dosya ekleri) henüz yapılmadı.

### Eklendi
- **Bağlantılar** (Organizasyon → "Bağlantılar"; organizasyon geneli): SSH, PostgreSQL, MySQL/MariaDB, SQL Server. Alanlar:
  benzersiz ad, ortam Development/Staging/Production, açıklama, "Kullanım amacı", notlar, host, port (türe göre
  varsayılan), kullanıcı, veritabanı, SSL/encrypt, sunucu sertifikasına güven, isteğe bağlı salt-okunur DB girişi, SSH
  kimlik doğrulama (anahtar dosyası / yapıştırılmış anahtar / parola / ssh-agent), SSH komut izin listeleri
  (read/write/execute, `*`, `DEFAULT_SSH_READ`). Tür sonradan değişmez. UI `features/connections/ConnectionsView.tsx`
  (Ayarlar / Ajan erişimi / Şema / Denetim, "Denetim kaydı (tümü)"). Test: DB sürümü + salt-okunur giriş doğrulaması;
  SSH parmak izi sabitleme (TOFU, SHA256) ve "Sıfırla". Şema gezgini (`information_schema`, 4000 sütun, önbellek).
- **Sırlar** `safeStorage` ile (`secret_enc` / `ro_secret_enc`, base64); UI'da yalnızca yazılabilir (`hasSecret`); renderer,
  prompt, terminal ve log'a gitmez; sürücü hataları `••••` ile maskelenir.
- **İzinler (varsayılan hepsini reddet):** `connection_permissions` (none/read/write/execute/admin); bağlantının "Ajan erişimi"
  paneli ve Ayarlar → İzin Matrisi → "Bağlantı izinleri". `classifySql` / `classifyCommand` (`src/shared/connections.ts`).
  DB düzeyi: `read` PG/MySQL salt-okunur işlemde ve geri alınır (MSSQL: sınıflandırma + geri alınan işlem), salt-okunur
  giriş varsa onunla; `write` işlem + commit; `admin` doğrudan; 30 sn / 200 satır / 48 KB; SSH 60 sn / 64 KB; çağrı
  başına kısa bağlantı.
- **Production onayı:** okuma dışı işlemler `ApprovalsDock`'ta (sol alt, geri sayım, "Onayla ve çalıştır" / "Reddet") + toast;
  10 dk sonra ret; durdurma/yönlendirme, fabrika sıfırlaması ve kapanışta bekleyenler reddedilir.
- **Denetim kaydı** (`audit_log`): tüm ajan erişimleri (reddedilenler dahil) ve kullanıcı işlemleri (bağlantı CRUD — değişen
  alanlar, sır yalnızca bayrak —, test, şema, izin eski → yeni, onaylar). `AuditList` (filtreler, sayfalama).
- **Ajan kullanımı:** `connectionsPrompt()` yalnızca izinli bağlantıları çalışan prompt'una ekler. Araçlar
  `connections_list`, `db_schema`, `db_query`, `ssh_exec` (`src/main/connections/tools.ts`) yalnızca main'de `runTool` →
  `service.ts` ile; transkriptte 🔌 / 🖥 / ⛔ / ↳. Claude Code: çalışma başına MCP yapılandırması (`<veri klasörü>/mcp/<runId>.json`)
  + `src/main/mcp/server.ts` (`out/main/mcp-connections.js`, Electron + `ELECTRON_RUN_AS_NODE=1`) + `127.0.0.1` köprüsü
  (`bridge.ts`, çalışma başına Bearer token), `--mcp-config … --strict-mcp-config`, `mcp__agentbits` ön-onaylı.
  Anthropic/OpenAI: yerel tool-use döngüsü (en fazla 16 tur, tur başına kullanım). Codex: araç yok. Demo: aynı yoldan
  gerçek çağrılar. Araç sonuçları "untrusted content" etiketli.
- **Migration v6:** `connections`, `connection_permissions`, `audit_log`.
- Bağımlılıklar (saf JS): `pg`, `mysql2`, `mssql`, `ssh2` (+ `@types`). Script `test:unit` →
  `tests/connections.classify.test.ts` (Node strip-types, framework yok).
- IPC: `connections:list|save|delete|test|schema|permissions|setPermission`, `approvals:list|resolve`, `audit:list`,
  `app:pickFile`. Olaylar `connections:changed`, `approvals:changed`, `audit:changed`. Store: `connections`, `connPerms`,
  `approvals`, `auditVersion`, kaynaklar `connections` / `approvals`, `OrgTab` += `connections`.
- Yeni dosyalar: `src/shared/connections.ts`; `src/main/connections/{repo,drivers,service,tools,bridge}.ts`;
  `src/main/mcp/server.ts`; `features/connections/{ConnectionsView,AuditList,ApprovalsDock}.tsx`;
  `tests/connections.classify.test.ts`.

### Değişti
- "Her şeyi sıfırla" bağlantıları, bağlantı izinlerini ve denetim kaydını da siler; "Sadece çalışma verisini sil" bunları korur.
  Kapanışta `rejectAllApprovals()` + `stopBridge()`.
- electron-vite ikinci main girdisi (`mcp-connections`); electron-builder `asarUnpack`'e `out/main/mcp-connections.js`.

### Bilinen
- Bash + ağ izni olan ajan makinedeki kimlik bilgileriyle (`~/.ssh`, `.pgpass`, ortam değişkenleri) doğrudan bağlanabilir;
  izin matrisi bunu engellemez. MCP köprü token'ı yerel süreçlere görünür (yalnızca o ajanın yetkisi, çalışma süresince).
  SQL sınıflandırması sezgisel; gerçek güvence salt-okunur DB girişi. MySQL ve SQL Server yalnızca bağlantı hatası yolunda
  test edildi (PostgreSQL PGlite'a, SSH yerel ssh2 sunucusuna karşı). `ssh2` native kripto eklentisi Build Tools yoksa
  uyarı basıp saf JS'e düşer.

### Belgeler
- `CLAUDE.md`, `README.md`, `docs/FEATURES.md` (§3b Bağlantılar, §3c Yol haritası, bilinen sorunlar #31–36),
  `docs/ARCHITECTURE.md` (§9b), `docs/DATABASE.md`, `docs/PROJECT.md`, `docs/DEVELOPMENT.md`, `docs/DECISIONS.md`
  (ADR-018, ADR-019).

## 2026-10-13 — Faz 1: ajan terminalleri, doğrudan talimatlar, token kullanımı, gerçek kabuklar

Sahibin büyük özellik isteğinin ilk fazı. **Faz 2** (Bağlantılar: SSH / PostgreSQL / MySQL / MSSQL, ajan başına izinler,
denetim kaydı) ve **Faz 3** (dosya ekleri) henüz yapılmadı — `docs/FEATURES.md` §3b.

### Eklendi
- **Ajan terminalleri** (Terminal → "Ajan terminalleri", varsayılan; diğeri "Kabuklar"): `features/terminal/AgentGrid.tsx`,
  `AgentPane.tsx`. Proje ekibinin her üyesi için bölme (lider önce), sütun Oto/1–4, filtre Tümü/Çalışanlar, bölme
  büyütme ve tarayıcı tam ekranı (Esc). Başlıkta ad, rol, lider tacı, durum, mevcut görev, sağlayıcı/model, token
  şeridi (Görev / Oturum / Toplam), duraklat/devam, onaylı durdur. Transkript seviyeye göre biçimli; "Gönderilen tam
  prompt" `meta.prompt` + `meta.system`'i açar. Canlı satırlar `lib/transcripts.ts` ile ajan başına (global store
  render yok), kare başına toplu, ekran dışında çizim durur, en fazla 4000 satır + "Daha eski kayıtlar" (`beforeId`),
  "yeni çıktı" rozeti.
- **Kalıcı transkript:** `agent_logs` yeni seviyeler `prompt`, `instruction`, `status` + `project_id`, `meta`. Orkestratör
  görev prompt'unu ("📨 Atlas → Nehir: TA-5 …"), liderin inceleme prompt'u ve kararını (çalışanın terminaline de),
  sohbet prompt'u/cevaplarını, planlanan görev listelerini ve Claude Code araç sonuçlarını (`↳`) yazar.
- **Doğrudan talimat:** `agents:instruct(InstructionInput)` — `redirect` / `queue` / `task`; ajan başına seri kilit;
  `expectedRunId` ile iyimser eşzamanlılık; en fazla 8000 karakter; `agent_instructions` kaydı, transkript, görev
  kanalında kullanıcı mesajı, projenin `general`'inde sistem notu, liderin prompt'unda "Direct user interventions"
  (son 6). Bekleyen talimatlar yeniden başlatma, durdurma ve onay reddinde iptal. Sağlayıcıya göre devam
  (`src/shared/steering.ts` → `steeringFor`): Claude Code `--resume <session_id>`, Anthropic/OpenAI kısmi çıktı +
  talimatla yeniden, Codex geçmişi metin olarak, Demo simülasyon; etiket arayüzde gösterilir. `runs:stop` görevi
  "Yapılacak"a döndürür.
- **Token kullanımı:** `token_usage` tablosu (çağrı/segment başına; mod task/chat/review; input/output/cache okuma/yazma;
  maliyet; tahmini mi; `session_id` = `APP_SESSION_ID`); v5 öncesi çalışmalar `legacy` olarak taşındı. Adaptörler
  `ctx.onUsage` ile bildirir (Claude Code mesaj başına `message.id` ile tekil, maliyet resume'de kümülatif farkla;
  Anthropic/OpenAI ayrıntılı; Codex yalnızca toplam; Demo tahmini). Sohbet ve inceleme de sayılır.
  `usage:summary(projectId?)`, `usage:daily(days, projectId?)`, olay `usage:changed` (500 ms kısıtlı); `getStats`
  token'ları `token_usage`'dan. UI: Reports → "Token kullanımı" (`UsagePanel`), ajan bölmeleri, Office, Ekip,
  StatusBar (`components/common/TokenUsage.tsx`).
- **Gerçek kabuklar:** `@lydell/node-pty` `1.2.0-beta.15` (hazır N-API binary'leri, derleme yok) ile PTY; yüklenemezse
  görünür "Pipe modu" yedeği. `TerminalSession.mode`, `terminal:resize`; PTY'de tuşlar ham iletilir; electron-builder
  `asarUnpack` node-pty'yi içerir.
- **Migration v5:** `agent_logs` yeniden kuruldu (CHECK değişikliği; id'ler korunur; `project_id` çalışma/görevden
  dolduruldu; yeni indeksler), `token_usage`, `agent_instructions`.
- Yeni dosyalar: `src/main/db/usage.ts` (`usageRepo`, `instructionsRepo`, `APP_SESSION_ID`), `src/main/core/usage.ts`,
  `src/shared/steering.ts`, `components/common/TokenUsage.tsx`, `lib/transcripts.ts`, `features/reports/UsagePanel.tsx`.
- IPC: `agents:instruct`, `instructions:list`, `usage:summary`, `usage:daily`, `terminal:resize`; `logs:list` `projectId` ve
  `beforeId` alır. Olaylar `usage:changed`, `instructions:changed`. Store: `usage`, `instructionsVersion`, kaynak `usage`.

### Değişti
- Çalışan prompt'u genel amaçlı: ekip yazılımın yanı sıra araştırma, veri analizi, doküman, içerik, planlama… yapabilir.
- Veri yönetimi: fabrika sıfırlaması yeni tabloları da siler; proje temizliği proje transkriptlerini ve `queued` olmayan
  talimatları siler; proje silme transkriptleri ve talimatları siler, `token_usage`'ı geçmiş olarak korur.
- CLAUDE.md kural 15 (native bağımlılık) güncellendi; ADR-005 yerini ADR-016'ya bıraktı.

### Bilinen
- Ajan CLI oturumları TTY değil; etkileşimli giriş yalnızca Kabuklar'da. Claude Code'da yönlendirme süreci sonlandırır
  (Windows'ta `taskkill`), kesilen tur oturumda yarım kalır, sonraki tur devam eder. Codex'te token ayrımı ve resume
  yok. Log saklama süresi transkriptleri de budar. Kabuklar yeniden başlatmada yaşamaz ve geçmişleri kaydedilmez.
  Demo sağlayıcı ve sahte stream-json Claude CLI ile test edildi; gerçek Claude Code CLI ile test edilmedi.

### Belgeler
- `CLAUDE.md`, `docs/FEATURES.md` (§3a, §3b yol haritası), `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/PROJECT.md`,
  `docs/DEVELOPMENT.md`, `docs/DECISIONS.md` (ADR-016, ADR-017; ADR-005 yerini aldı).

## 2026-10-13 — Açılış proje seçici, boş durum ekranı ve proje klasörü doğrulaması

### Eklendi
- **Açılış proje seçici** (`features/project/ProjectLauncher.tsx` → `ProjectLauncher`): giriş ve Onboarding'den sonra
  "Hangi projeleri açalım?" penceresi. Aktif projeler son açılma zamanına göre; >6 projede arama; "Arşivdekiler"
  katlanabilir; ön seçim son oturumun sekmeleri (yoksa en son açılan proje), klasörü bulunamayanlar hariç; rozetler
  "klasör bulunamadı" / "klasör seçilmedi" / "açık" / koşan iş sayısı; tık = seç, çift tık = hemen aç, Enter =
  seçilenleri aç; arşivdeki proje açılırken arşivden çıkarılır. "Yeni proje" ve "Klasör aç…" kartları (klasörü
  kullanan proje varsa o açılır, uygulama klasörü reddedilir, değilse klasör adı + yoluyla dolu `ProjectModal`).
  Alt kutu "Açılışta sorma, son açık projeleri aç" → yeni ayar `startupProjects: 'ask' | 'restore'` (varsayılan
  `'ask'`; Ayarlar → Genel → "Açılışta").
- **ProjectHome** (aynı dosya): hiç sekme açık değilken "Açık proje yok", Proje aç… / Yeni proje / Klasör aç…, son 5
  proje; Sidebar ve bölüm satırı gizlenir. Son sekme artık kapatılabilir.
- `Ctrl+P` proje seçiciyi açar (terminal odağında yok sayılır); proje değiştiriciye "Proje aç… (Ctrl+P)" ve "Klasör aç…".
- **Migration v4:** `projects.last_opened_at TEXT`; `Project.lastOpenedAt`; `projectsRepo.touch(ids)`.
- IPC: `projects:touch(ids)` (`projects:changed` yayınlar), `projects:folderStatus()` → `Record<id, FolderStatus>`,
  `projects:inspectFolder(path)` → `FolderInspection`. Yeni tipler `FolderStatus`, `FolderInspection`.
- `src/main/core/folders.ts`: `normalizePath`, `isAppFolder` (uygulama yolu, exe klasörü, dev'de cwd, ya da
  `name: "agentbits"` olan bir `package.json`'un içi/altı), `inspectFolder`, `assertUsableFolder`, `folderStatus`.
- Store: `launcher { open, preselect }`, `openLauncher` / `closeLauncher`, `openProjects(ids)`, `projectModal.draft` +
  `openProjectModal(id, draft)`, `initError` + "Veriler yüklenemedi / Tekrar dene" ekranı (ilk yükleme `loadAll()`'da).

### Değişti
- Uygulama varsayılan projeyi artık **otomatik açmaz**; Onboarding'in hemen ardından ise varsayılan proje doğrudan açılır.
- `projects:save` `rootPath` değiştiğinde doğrular (var olmalı, klasör olmalı, uygulama klasörü olmamalı, başka
  projede kullanılmamalı — Türkçe hatalar) ve proje id'si yoksa hata verir. CLAUDE.md kural 10 artık kodda zorlanıyor.
- `openProject` projenin var ve aktif olduğunu doğrular, sonra `projects:touch` çağırır. `normalizeTabs` yedek sekme
  açmaz; `refresh('projects')` sekmeleri yalnızca değiştiklerinde yeniden yazar; `refresh` hataları yakalanır.
- Onboarding seçilen klasörü `inspectFolder` ile doğrular ve hataları gösterir. `ProjectModal` seçilen klasörü doğrular
  (bulunamadı / uygulama klasörü / başka projede — satır içi hata), mevcut projenin kayıp klasörünü uyarır, klasör
  adını ad olarak önerir.
- `Logo` `components/common/Logo.tsx`'e taşındı; `TopBar` onu yeniden dışa aktarır.

### Belgeler
- `CLAUDE.md`, `docs/FEATURES.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/PROJECT.md`,
  `docs/DEVELOPMENT.md`, `docs/DECISIONS.md` (ADR-015).

## 2026-10-13 — Eski ürün adından kalan her şey kaldırıldı

### Kaldırıldı
- Tek seferlik eski veri geçişi (`src/main/legacy.ts`, `migrateLegacyData()`) ve renderer'daki eski `localStorage`
  anahtarı taşıması. Sahibin verisi zaten `%APPDATA%\Agentbits`'te.
- Eski adla üretilmiş derleme çıktıları (`out/`, `release/`) silindi; `npm run build` / `npm run dist` yeniden üretir.
- Belgelerdeki eski ad geçen tarihçe ayrıntıları sadeleştirildi (ADR-014).

## 2026-10-13 — Ad değişikliği: Agentbits, yeni logo

> Not: Bu kayıttan önceki kayıtlar ad değişikliği sırasında mekanik olarak yeni adla güncellendi.

### Değişti
- Ürün adı **Agentbits** (alan adı `agentbits.app`): paket `agentbits`, `productName` `Agentbits`, `appId` ve
  Windows AppUserModelId `app.agentbits.desktop`, DB dosyası `agentbits.db`, ortam değişkeni `AGENTBITS_DATA_DIR`,
  preload köprüsü `window.agentbits`, `localStorage` anahtarları `agentbits:*`, webview bölümü
  `persist:agentbits-browser`, yedekler `agentbits-<etiket>-<zaman>.db`, kurulum kayıt anahtarı `Uninstall\Agentbits`
  (`URLInfoAbout` `https://agentbits.app`), GitHub yayın `agentbits/agentbits`.
- Yeni logo: piksel sanatı ajan başı (beyaz kafa, koyu indigo vizör, iki amber göz, amber anten ucu, sağ üstte üç
  lavanta "bit"), `#6366F1 → #8B5CF6` dikey gradyanlı yuvarlatılmış kare; 16×16 ızgarada 12×12 glif.
  `build-resources/icon.svg` (kaynak), `icon.png` (512), `icon.ico` (16–256); uygulama içi `Logo`
  (`components/common/Logo.tsx`, `LOGO_ROWS`). Paketlenmemiş çalışmada pencere ikonu `build-resources/icon.png`.

### Belgeler
- `CLAUDE.md`, `README.md`, `docs/PROJECT.md` (Marka bölümü), `docs/ARCHITECTURE.md`, `docs/DATABASE.md`,
  `docs/DEVELOPMENT.md`, `docs/FEATURES.md`, `docs/DECISIONS.md` (ADR-014).

## 2026-10-13 — Veri yönetimi: temizlik, log saklama, yedekler ve sıfırlama

### Eklendi
- `src/main/core/maintenance.ts`:
  - `dataUsage()` — DB / WAL / yedek boyutları, veri klasörü, organizasyon hafızası, proje başına sayılar.
  - `clearProject(projectId, parts, { keepDecisionMemories })` — `DataPart` = `memories | messages | logs |
    reports | decisions | tasks`; görev veya log silinecekse projede koşan işler önce durdurulur.
  - `clearOrgMemory({ keepDecisions })`.
  - `pruneLogs(days)` + `startMaintenance()` / `stopMaintenance()` — `settings.logRetentionDays` açılışta ve
    6 saatte bir uygulanır (0 = süresiz).
  - Yedekler: `createBackup()` (`VACUUM INTO` → `<veri klasörü>/backups/agentbits-<etiket>-<zaman>.db`, son 10
    tutulur), `listBackups`, `deleteBackup` (ad doğrulanır, yol geçişi yok).
  - `restoreBackup(name)` — SQLite başlığını kontrol eder, kopyayı hazırlar, mevcut DB'yi `geri-yukleme-oncesi`
    olarak yedekler, orkestratörü/terminalleri kapatır, DB'yi kapatır, dosyayı değiştirir, `-wal`/`-shm`'yi
    siler, `app.relaunch()` + `app.exit(0)`. Eski yedekler bir sonraki açılışta migration'larla yükseltilir.
  - `factoryReset('work' | 'all')` — önce otomatik yedek (`temizlik-oncesi` / `sifirlama-oncesi`), sonra
    `orchestrator.resetRuntime()`; `work` görev/çalışma/log/mesaj/hafıza/karar/rapor siler ve ajan durumlarını
    sıfırlar; `all` ayrıca ajanları, izinleri, sağlayıcıları (API anahtarları), birimleri, projeleri ve ayarları
    siler, terminalleri kapatır, `seedIfEmpty()` + `ensureOrgDefaults()` çalıştırır (Onboarding yeniden gelir).
    İkisi de FTS'yi yeniden kurar, `VACUUM` yapar, tüm değişiklik olaylarını yayınlar ve pencereleri yeniden yükler.
- `orchestrator.resetRuntime()` — bekleyen onayları reddeder, aktif çalışmaları iptal eder, zamanlayıcıları,
  `blocked` ve `failCounts`'u temizler.
- IPC: `data:usage`, `data:clearProject`, `data:clearOrgMemory`, `data:pruneLogs`, `data:backup`,
  `data:listBackups`, `data:deleteBackup`, `data:restoreBackup`, `data:openFolder`, `data:factoryReset`.
- `AppEvent` `messages:changed` → store `feed` ve `logs`'u yeniden çeker, kanal önbelleğini temizler, açık kanalı
  yeniden yükler (yeni `Resource` `messages`).
- Tipler: `DataPart`, `ProjectUsage`, `DataUsage`, `BackupInfo`, `ResetMode`; `AppSettings.logRetentionDays`
  (ayar anahtarı, varsayılan 30).
- Renderer: `features/settings/DataSection.tsx` (kullanım özeti, proje başına "Temizle…" paneli, organizasyon
  hafızası, log saklama, yedekler + geri yükle/sil, "SIFIRLA" yazarak onaylanan tehlikeli bölge — Türkçe büyük/küçük
  harf duyarsız); `SettingsSection` `'data'`; store `dataFocusProjectId` ve `openSettings(section, focusProjectId?)`;
  `ProjectModal` (düzenleme) "Hafızayı ve geçmişi temizle → Verileri yönet" kısayolu.

### Değişti
- `Heading` / `Row` `features/settings/parts.tsx`'e taşındı.
- `src/main/index.ts`: `orchestrator.init()` sonrasında `startMaintenance()`, `before-quit`'te `stopMaintenance()`.
- Şema değişikliği yok (hâlâ v3).

### Belgeler
- `CLAUDE.md`, `docs/FEATURES.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/DEVELOPMENT.md`,
  `docs/DECISIONS.md` (ADR-013) güncellendi.

## 2026-10-12 — Organizasyon, yeniden kullanılabilir takımlar ve proje sekmeleri

Sahibin isteği: organizasyon içinde takımlar (hazır şablondan ya da sıfırdan; her takım birçok projede yeniden
kullanılabilir; organizasyon ve takımlar görülüp düzenlenebilir — ör. 4 ajanlı araştırma & analiz takımı, ürün
geliştirme, pazarlama & içerik, birkaç takımlı "e-ticaret şirketi") ve proje klasörü seçip her projeyi kendi
sekmesinde göstermek. Sahibin kararları: ajanlar projeler arasında **paylaşılır** (aynı anda tek görev; hafıza/
geçmiş proje bazlı); **sınırsız** iç içe birim; bir ajan **birden çok** birimde; **her şey projeye özel**
(görevler, sohbet, kararlar, raporlar, proje hafızası, klasör; Office yalnızca projenin ekibini gösterir).
Kararlar ADR-011 ve ADR-012 olarak kaydedildi.

### Eklendi
- **Migration v3** (`schema.ts`): `units` (organization/company/department/team, `parent_id` CASCADE, lider,
  renk, sıra), `unit_members` (çoka-çok, birim içi unvan), `projects` (klasör, renk, lider, `active/archived`,
  `is_default`), `project_units`; `tasks` (FK CASCADE), `runs`, `messages`, `decisions`, `reports`, `memories`
  tablolarına `project_id` + indeksler.
- `src/main/core/org.ts`: `ensureOrgDefaults()` (her açılışta seed'den sonra, idempotent: "Organizasyon" kökü,
  ilk seferde tüm ajanlarla "Çekirdek Ekip" ve eski `settings.workspaceRoot`'tan "Varsayılan Proje"; eski
  satırları bağlar; göreve bağlı hafızalar görevin projesine, diğerleri organizasyon geneli), `projectMembers`,
  `projectLead`, `memberProjectIds`, `activeProjectIds`, `getProject`.
- `src/main/core/templates.ts`: hazır şablonlar — Yazılım (5), Araştırma & Analiz (4), Ürün Geliştirme (4),
  Pazarlama & İçerik (4), E-ticaret Şirketi (Genel Müdür + Ürün & Katalog, Pazarlama, Müşteri Hizmetleri,
  Operasyon & Lojistik, Teknoloji; 10 ajan). Kurulum birimleri ve benzersiz adlı yeni ajanları (iş tanımı,
  yetenekler, `readonly/developer/full` ön ayarı — hepsinde onay açık) oluşturur, birim liderlerini atar.
- `src/shared/org.ts`: `descendantIds`, `unitMemberIds`, `projectMemberIds`, `unitPath`, `wouldCycle`.
- IPC: `units:list|save|delete|addMember|removeMember`, `templates:list|instantiate`, `projects:list|save|delete`;
  olaylar `units:changed`, `projects:changed`.
- Renderer: `features/org/` (OrgView: Şema / Takımlar / Ajanlar / Şablonlar; OrgChart, TeamsView + UnitEditor,
  AddMembersModal, TemplatesView, meta.ts), `features/project/` (ProjectModal, ProjectTeamView = **Ekip**
  bölümü), `features/agents/AgentUnits.tsx`, `NewAgentModal` isteğe bağlı `unitId`, `parts.tsx` → `useSavedFlash`,
  `lib/org.ts` (`resolveProjectLead`, `autoProjectLead`, `useProjectScope`, `isCliProvider`, `PROJECT_COLORS`, `shortPath`).
- İki satırlı TopBar: satır 1 logo, "Organizasyon", proje sekmeleri (renk, ad, koşan iş sayısı, ×), "+", proje
  değiştirici (arşivlenenler yeniden açılır), duraklat, ayarlar; satır 2 proje bölümleri + klasör çipi (amber
  "Klasör seçilmedi") + proje ayarları. Kısayollar: `Ctrl+1…8` bölümler, `Ctrl+Tab` / `Ctrl+Shift+Tab`
  projeler, `Ctrl+O` Organizasyon. `titleBarOverlay.height` 40.
- Store: `view`, `orgTab`, `activeProjectId`, `openProjectIds` (`localStorage`), `openProject/closeProject/
  cycleProject/showOrg/selectUnit/openProjectModal/closeProjectModal`, `units`, `projects`, `templates`,
  `channelKey(projectId, channel)`; `stats` aktif projenin.

### Değişti
- IPC imzaları: `messages:list(channel?, limit?, projectId?)`, `messages:send(channel, content, projectId)`,
  `reports:generateDaily(projectId)`, `stats:get(projectId?)`, `memory:add(…, projectId?)`,
  `memory:list({…, projectId})`; `TaskInput.projectId`, `TaskListOpts.projectId`; `runsRepo.create(…, projectId)`,
  `messagesRepo.create(channel, senderType, senderId, content, projectId, meta?)`. `agents:delete` artık
  `units:changed` + `projects:changed` da yayınlar.
- Kurallar: kök birim silinemez/taşınamaz; döngüler reddedilir; varsayılan proje silinemez (arşivlenir); proje
  silme görev/çalışma/log/sohbet/karar/rapor/proje hafızasını siler; birim lideri atamak üyeliği ekler;
  varsayılan projenin `rootPath`'i `settings.workspaceRoot`'u senkronlar.
- Orkestratör proje kapsamlı: tick atanmış görevleri tüm aktif projelerden, atanmamışları yalnızca ajanın üyesi
  olup lideri olmadığı projelerden alır (organizasyon lideri hiç almaz); cwd = `project.rootPath`; klasörsüz
  projede CLI görevi reddedilir ("… için klasör seçilmedi"); sistem prompt'larına proje bağlamı; hafıza proje
  + organizasyon geneli; projenin `general`'i projenin liderine gider; liderin ```` ```tasks ```` görevleri
  projede oluşturulur ve atananlar proje üyeleri olmalı; incelemeyi proje lideri yapar; günlük rapor proje
  bazlı; kimlik hatası mesajı etkilenen projeye düşer. `RunContext.team` (proje üyeleri) ile Demo sağlayıcı
  atamayı proje içinde yapar.
- Tüm proje görünümleri aktif projeye göre süzer (Chat, Tasks/TaskDrawer/NewTaskModal — atanabilecekler üyeler
  eksi lider —, Reports, Decisions, Terminal çalışma listesi; kabuklar ortak). Sidebar: Running work tüm
  projelerden proje çipiyle; ekip şeridi ve Live chat aktif projenin; Organizasyon sayfasında yalnızca Running
  work. Office: proje üyeleri + çözülmüş lider lider masasında; başka projede meşgul üye soluk "· başka
  projede"; proje değişince ajanlar masalar arasında yürür. StatusBar proje + klasörü gösterir.
- Ayarlar → Genel: klasör artık proje başına ("Proje ayarlarını aç"); Hafıza: kapsam seçici (Organizasyon geneli /
  Bu proje). Onboarding 2. adım klasörü varsayılan projeye kaydeder.

### Kaldırıldı
- Ayrı üst düzey **Agents** sekmesi: ajanlar Organizasyon → Ajanlar'da; `openAgentProfile` oraya gider. Bölüm
  sırası artık Chat, Office, **Ekip**, Terminal, Tasks, Reports, Decisions, Browser.

### Doğrulama
- `npm run typecheck` + `npm run build` temiz; v2→v3 migration hem mevcut hem boş DB'de. Playwright + Demo:
  e-ticaret şablonu → "E-ticaret Mağazası" projesi → Genel Müdür Kaya bir isteği 3 göreve bölüp Nazlı (Katalog),
  Ozan (Pazarlama) ve Volkan'a (Operasyon) atadı; projeler arası görev/sohbet ayrımı kontrol edildi.

### Bilinen
- Şablon ajanları "Onay iste" açık başlar (onay kartları beklenmeli); "yazıyor…" göstergesi ajanın küresel
  durumudur; terminal kabukları projeler arasında ortaktır; bir projede 10'dan fazla çalışan masa paylaşır.

### Belgeler
- `CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`,
  `docs/FEATURES.md`, `docs/DEVELOPMENT.md`, `docs/DECISIONS.md` (ADR-011, ADR-012) güncellendi.
  `docs/RELEASE_TEMPLATE.md`'deki veri klasörü yolu `%APPDATA%\Agentbits` olarak düzeltildi.

## 2026-10-12 — TA-5: WCAG AA karanlık tema kontrast denetimi

### Değişti
- `src/renderer/src/index.css` → `btn-primary` artık `bg-indigo-600 hover:bg-indigo-700` (beyaz metin kontrast oranı 6.29:1 / 7.90:1 ✅; önceki `bg-accent` = #6366f1 üzerinde 4.46:1 ❌).
- `src/renderer/src/index.css` → `.icon-btn`, `.input placeholder`, `.label`, `.panel-title`, `.kbd` sınıfları `text-zinc-400`'e güncellendi.
- `src/renderer/src/lib/format.ts` → `PRIORITY_META[0]` (No Priority) rengi `zinc-500` → `zinc-400`; `STATUS_META.offline` dot/text `zinc-700/zinc-600` → `zinc-600/zinc-400`.
- 24 bileşen dosyasında yüzden fazla `text-zinc-500` / `text-zinc-600` kullanımı `text-zinc-400`'e çevrildi: `TopBar.tsx`, `StatusBar.tsx`, `Sidebar.tsx`, `App.tsx`, `Onboarding.tsx`, `PixelAvatar.tsx`, `ui.tsx`, `ChatView.tsx`, `TaskDrawer.tsx`, `TasksView.tsx`, `AgentsView.tsx`, `parts.tsx`, `OfficeView.tsx`, `AgentEditor.tsx`, `ReportsView.tsx`, `DecisionsView.tsx`, `TerminalView.tsx`, `SettingsPanel.tsx`, `ProviderForm.tsx`, `NewAgentModal.tsx`, `NewTaskModal.tsx`, `LoginView.tsx`, `BrowserView.tsx`.
- Kasıtlı istisna: debug log seviyesi (`text-zinc-500`) ve dekoratif ayraç "—" (`text-zinc-500`) WCAG 1.4.3 muafiyeti kapsamında bırakıldı.

### İlgili dosyalar
`src/renderer/src/index.css`, `src/renderer/src/lib/format.ts`, ve yukarıda listelenen 24 bileşen dosyası.

## 2026-10-12 — TA-4: Windows NSIS paketleme yapılandırması

### Eklendi
- `electron-builder.config.js` — JSON schema'sından kaçınan JS yapılandırması; imzalama
  `WIN_CERT_SUBJECT` env varı varsa koşullu olarak etkinleşir (`signtoolOptions`).
- `build-resources/icon.ico` — çok boyutlu (16–256 px) placeholder ikon.
- `build-resources/installer.nsh` — NSIS özel eklenti scripti (kayıt defteri anahtarları).
- `LICENSE` — MIT lisans metni.
- `docs/RELEASE_TEMPLATE.md` — sürüm notu şablonu.

### Değişti
- `package.json` → `build` bloğu kaldırıldı (artık `electron-builder.config.js`'de); `dist`
  scripti `--config electron-builder.config.js` bayrağı eklendi.
- `docs/FEATURES.md` → Paketleme satırı ✅'e güncellendi, Bilinen sorun #4 düzeltildi olarak işaretlendi.

### İlgili dosyalar
`electron-builder.config.js`, `package.json`, `build-resources/icon.ico`,
`build-resources/installer.nsh`, `LICENSE`, `docs/RELEASE_TEMPLATE.md`

## 2026-10-12 — Geliştirme sunucusu bağlantı zaman aşımı düzeltildi

### Düzeltildi
- Windows'ta `npm run dev` sonrası pencere siyah kalıyordu: `Failed to load URL: http://localhost:5173/
  with error: ERR_CONNECTION_TIMED_OUT`. Vite sunucusu artık açıkça `127.0.0.1:5173`'e bağlanıyor
  (`electron.vite.config.ts` → `renderer.server`), main süreç de URL'deki `localhost`'u `127.0.0.1` yapıyor.
- `src/main/index.ts` → `loadDevServer()`: geliştirme sunucusuna bağlanamazsa 15 kez (2 sn arayla) yeniden
  dener; yine olmazsa siyah ekran yerine Türkçe sorun giderme sayfası gösterir.

## 2026-10-12 — Agents sekmesi: ajan profilleri, iş tanımı ve yetenekler

Sahibin "kendi ajanımı (ör. Ali) rol / iş tanımıyla oluşturup izinlerini ajan ekranından yöneteyim" hedefi karşılandı.

### Eklendi
- Yeni üst sekme **Agents** (lucide `Users`), Office'ten hemen sonra; sekmeler 8 oldu, kısayollar
  `Ctrl+1…8` (Chat, Office, Agents, Terminal, Tasks, Reports, Decisions, Browser).
- `src/renderer/src/features/agents/`: `AgentsView.tsx` (aranabilir liste, "Yeni ajan", durum noktaları, lider
  yıldızı, "Masa n/10"), `AgentEditor.tsx` (Durum, Kimlik, Görev ve iş tanımı, Model, İzinler, satır içi onaylı
  silme; "Kaydedildi" göstergesi; Mesaj / Görev ata), `NewAgentModal.tsx` (ad zorunlu, rol, iş tanımı,
  yetenekler, yetki şablonu Salt okuma / Geliştirici / Tam yetki, rastgele görünüm, 10 masa dolu uyarısı),
  `constants.ts` (ortak `PERMISSIONS` listesi — Ayarlar → İzin Matrisi de kullanıyor —, şablonlar, paletler),
  `parts.tsx` (Section, Field, Swatches, TagInput).
- **Migration v2** (`schema.ts`): `agents.job_description TEXT NOT NULL DEFAULT ''`,
  `agents.skills TEXT NOT NULL DEFAULT '[]'` (JSON dizi). Tipler: `Agent.jobDescription`, `Agent.skills`
  (ikisi de `AgentInput`'ta), yeni `PermissionsPatch` takma adı.
- Seed ajanlarına Türkçe iş tanımı ve yetenekler (yalnızca yeni DB'ler).
- Store: `newTaskAssigneeId`, `setNewTaskOpen(v, assigneeId?)`, `openAgentProfile(id?)`; `lib/api.ts` → `apiError()`.
- Office ajan panelinde "Profili düzenle" bağlantısı.

### Değişti
- `agents:save(input, id?, permissions?: PermissionsPatch)` — başlangıç izinleri aynı transaction'da yazılır;
  ad çakışması büyük/küçük harf duyarsız kontrol edilir (+ UNIQUE yedeği) → `Bu isimde bir ajan zaten var: <ad>`;
  güncellemede boş ad reddedilir; yetenekler kırpılıp tekilleştirilir. `permissions:update` artık `PermissionsPatch` alır.
- `agents:delete` lider ajanı main tarafında reddeder.
- Prompt'lar: çalışan sistem prompt'una `## Job description` ve `## Skills`; lider ekip listesinde rol,
  yetenekler ve ~160 karakterlik iş tanımı görür ve atamayı buna göre yapar; liderin kendi iş tanımı da eklenir.
- Demo sağlayıcı `assigneeFor`: önce yetenek / iş tanımı kelimeleri, sonra rol anahtar kelimeleri, sonra sırayla.
- `NewTaskModal` `TasksView`'dan `App.tsx`'e taşındı (Agents sekmesinden "Görev ata" çalışsın diye).
- Ayarlar → Ajanlar bölümü artık yalnızca bir not + "Agents sekmesinde aç" düğmesi; İzin Matrisi değişmedi.
  Agents'ta ajan seçmek Office panelinde de seçer (ortak `selectedAgentId`).

### Doğrulama
- `npm run typecheck` + `npm run build` temiz. Playwright/Xvfb + Demo sağlayıcı: "Ali" (Mobile Engineer)
  oluşturuldu, izinler matrise yansıdı, Ali 5. masaya oturdu, aynı ad hatası gösterildi, Atlas bir push
  bildirimi görevini Ali'ye yönlendirdi; eski bir v1 DB v2'ye doğru yükseltildi.

### Belgeler
- `CLAUDE.md`, `README.md`, `docs/PROJECT.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, `docs/FEATURES.md`,
  `docs/DEVELOPMENT.md` güncellendi.

## 2026-10-12 — Proje belgeleri

### Eklendi
- `CLAUDE.md` (ajanlar için giriş noktası, kurallar, belge güncelleme kuralı), `AGENTS.md`.
- `docs/PROJECT.md`, `docs/DATABASE.md`, `docs/FEATURES.md`, `docs/DEVELOPMENT.md`, `docs/CHANGELOG.md`,
  `docs/DECISIONS.md`.

### Değişti
- `docs/ARCHITECTURE.md` genişletildi (IPC metodu ekleme adımları, orkestratör yaşam döngüsü, sağlayıcılar,
  izin → CLI bayrakları, terminal, ofis motoru, renderer durumu); şema ayrıntısı `DATABASE.md`'ye taşındı.
- `README.md`'ye "Belgeler" bölümü eklendi.

## 2026-10-12 — Agentbits ajanlarının otonom değişiklikleri (gözden geçirilmeli)

Sahibin makinesinde test sırasında çalışma alanı **Agentbits deposunun kendisine** ayarlıydı; Agentbits'in
kendi ajanları seed görevlerini (TA-1, TA-2, TA-4) gerçek kod üzerinde uyguladı. Değişiklikler şu an kodda;
sahibin karar vermesi bekleniyor (bkz. `docs/FEATURES.md` → Bilinen sorunlar).

### Eklendi
- `src/renderer/src/features/auth/LoginView.tsx` ve `App.tsx`'te giriş kapısı: e-posta/parola ekranı,
  yalnızca istemci tarafı doğrulama, `sessionStorage['agentbits:loggedIn']`. **Gerçek kimlik doğrulama değildir**
  (arka uç yok; geçerli görünen her bilgiyi kabul eder).
- `src/renderer/src/features/settings/ProviderForm.tsx`: API anahtarı doğrulaması (boş / boşluk).
- `package.json` → `build`: Windows kod imzalama, NSIS seçenekleri, GitHub yayın yapılandırması.
  `build-resources/icon.ico`, `build-resources/installer.nsh` ve `LICENSE` dosyaları mevcut olmadığından
  `npm run dist` bunlar eklenene ya da yapılandırma sadeleştirilene kadar başarısız olur.

### Değişti
- `tasks:list` cursor tabanlı sayfalamaya geçti: `TaskListOpts`, `TaskPage` (`src/shared/types.ts`),
  `tasksRepo.list(opts)` + main içi kullanım için `tasksRepo.listAll()` (`src/main/db/repos.ts`).
  Ardından renderer store tüm sayfaları gezecek şekilde uyarlandı (`fetchAllTasks` — `useAppStore.ts`).

## 2026-10-12 — Çift mesaj düzeltmesi

### Düzeltildi
- Geliştirme modunda her sohbet mesajı iki kez görünüyordu: React StrictMode `init()`'i iki kez çalıştırıp
  olay dinleyicisine iki kez abone oluyordu. Çözüm: `init()` idempotent (`initStarted` bayrağı) ve
  `message:new` mesaj `id`'siyle, `log:new` log `id`'siyle tekilleştiriliyor (`useAppStore.ts`).

## 2026-10-12 — Süresi dolmuş oturum / geçersiz anahtar tespiti

### Eklendi
- Sağlayıcı hatalarında kimlik sorunu tespiti (`AUTH_RE`, `explainError()` — `orchestrator.ts`): Türkçe,
  eyleme dönük mesaj (`claude auth login` / `codex login` / anahtarı yenile), **tüm ekip otomatik duraklatılır**,
  `#general`'e bilgi mesajı ve hata toast'u.
- Üst bardaki "Devam et" (`resumeAll`) `error` durumundaki ajanları `idle`'a döndürür.
- Claude Code sağlayıcısında "Test et" artık `claude auth status` ile oturumu da kontrol ediyor (`claudeCli.ts`).

## 2026-10-12 — Electron binary eksikliği

### Düzeltildi
- Sahibin makinesinde Electron binary indirilmemişti ("Electron uninstall" / kurulum hatası). Çözüm:
  `node node_modules\electron\install.js` (gerekirse `ELECTRON_MIRROR`). `docs/DEVELOPMENT.md`'ye işlendi.

## 2026-10-12 — Olay: ajanlar Agentbits kaynağını düzenledi → dosya erişimi kapsamlandı

### Düzeltildi
- Gerçek Claude Code ile test sırasında çalışma alanı boş olduğu için varsayılan olarak home dizinine düşen
  ajanlar Agentbits'in kendi kaynak kodunu düzenledi. Neden: `Edit`/`Write` `--allowedTools` içindeydi ve bu
  yol kısıtlarını atlıyordu.
- Çözüm (`claudeCli.ts`, `orchestrator.ts`): dosya araçları yalnızca `--tools` ile açılıyor, ön-onaylı değil;
  `--permission-mode acceptEdits` sadece cwd + `--add-dir` içinde otomatik onaylıyor, headless çalışmada dışarısı
  reddediliyor (doğrulandı). Yalnızca `Bash` / `WebFetch` / `WebSearch` `--allowedTools`'ta. CLI sağlayıcıları
  çalışma alanı klasörü seçilmeden görev çalıştırmıyor; Onboarding CLI sağlayıcısında klasörü zorunlu tutuyor.
  Reddedilen araç çağrıları (`permission_denials`) ajan loguna uyarı olarak düşüyor.

## 2026-10-12 — ErrorBoundary

### Eklendi
- `src/renderer/src/components/common/ErrorBoundary.tsx`; `App.tsx`'te ana görünümlerin etrafında
  (`resetKey={tab}` — sekme değişince sıfırlanır). Tek bir görünümün çökmesi tüm pencereyi karartmıyor.

## 2026-10-12 — Tasks sekmesinde siyah ekran düzeltmesi

### Düzeltildi
- `useAppStore((s) => s.agents.filter(...))` gibi seçicide yeni dizi döndüren Zustand seçicisi her render'da
  yeni referans üretip sonsuz render döngüsüne / siyah ekrana yol açıyordu. Çözüm: ham dilimi seç, türetmeyi
  `useMemo` ile yap (ör. `NewTaskModal.tsx`).
- **Kural:** seçici içinde asla yeni dizi/nesne türetmeyin (CLAUDE.md'ye eklendi).

## 2026-10-12 — MVP

### Eklendi
- Electron + React 19 + TypeScript + Tailwind 3.4 + Zustand iskeleti (electron-vite).
- Yedi sekme: Chat, Office, Terminal, Tasks, Reports, Decisions, Browser; sol panel (Running work, Ekip,
  Live chat); durum çubuğu; Ayarlar paneli (Ajanlar, İzin Matrisi, Sağlayıcılar, Hafıza, Genel).
- Orkestratör: otopilot, onaylar, yürütme, lider incelemesi, sohbetten ```` ```tasks ```` / ```` ```decision ````
  ayrıştırma, mola/hata zamanlayıcıları, duraklat/devam/durdur, günlük rapor.
- Sağlayıcılar: Anthropic API, OpenAI API, Claude Code CLI, Codex CLI, Demo (mock).
- SQLite (WAL) şeması v1, FTS5 tabanlı hafıza motoru, ADR kararları, raporlar, `safeStorage` ile anahtar saklama.
- Dinamik izin matrisi ve CLI bayraklarına eşleme.
- Onboarding (sağlayıcı + çalışma alanı), seed ekibi (Atlas, Nehir, Zeki, Defne, Kaan) ve örnek görevler.
- Canvas ofis motoru: 34×22 tile harita, BFS yol bulma, kodla tanımlı sprite'lar, y-sıralama, yüksek
  çözünürlüklü isim etiketleri, durum baloncukları.
- xterm.js tabanlı terminal (pipe) ve ajan çalışma logları.
