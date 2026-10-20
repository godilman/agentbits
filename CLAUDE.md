# CLAUDE.md — Agentbits

> Bu dosya, bu depoyu açan her kodlama ajanının (Claude Code, Codex vb.) **ilk okuması gereken** giriş
> noktasıdır. Ayrıntılar `docs/` altındadır; aşağıdaki "Belgeler" bölümünden ulaşın.
> Belgeler Türkçedir; kod tanımlayıcıları, yollar ve komutlar koddaki gibi İngilizce bırakılmıştır.

## Proje nedir, neden var?

**Agentbits**, birden fazla yapay zeka ajanının pikselli bir 2D sanal ofiste birlikte çalıştığı bir
**masaüstü ajan orkestrasyon uygulamasıdır** (Electron + React + TypeScript). Kullanıcı bir
**organizasyon** kurar: şirket / departman / takım birimleri (sınırsız iç içe), hazır **şablonlardan**
(çekirdek ekip, yazılım, araştırma, ürün, pazarlama, e-ticaret şirketi) ya da sıfırdan; her takım birden çok projede
yeniden kullanılır. Her **proje** bir klasör + atanmış takımlardır ve kendi sekmesinde açılır. Kullanıcı
projenin liderine sohbetten iş tarif eder; lider işi görevlere böler, proje üyelerine atar; ajanlar
görevleri seçilen sağlayıcıyla (Claude Code CLI, Codex CLI, Anthropic/OpenAI API ya da anahtarsız Demo)
çalıştırır; lider sonucu inceler. Ajanlar projeler arasında **paylaşılır** (aynı anda tek görev); görevler,
sohbet, kararlar, raporlar ve proje hafızası **projeye özeldir**. Her şey yerel SQLite'a yazılır; kalıcı
hafıza sayesinde ajanlar geçmişi unutmaz. Erişim **dinamik izin matrisiyle** kısıtlanır; ajanlar
yalnızca izin verilen **Bağlantılar** (SSH / PostgreSQL / MySQL / SQL Server) üzerinden sunucu ve veritabanı kullanır
(Production'da onay, her erişim denetim kaydında). Kullanıcı sohbete, görevlere ve talimatlara **dosya** ekleyebilir
(PDF, Office, CSV, metin, görsel…); ajanlar yalnızca izin verilen dosyaları güvenilmeyen veri olarak okur. Amaç: Linear/Discord
hissinde, koyu temalı, ajanların ne yaptığını canlı gösteren güvenli bir "yapay zeka şirketi ofisi".
Ürün vizyonu → [docs/PROJECT.md](docs/PROJECT.md).

Durum: **v0.9.0** (2026-10-20) — organizasyon, projeler ve tüm proje bölümleri çalışıyor; özellik durumu →
[docs/FEATURES.md](docs/FEATURES.md). Depo herkese açık; yayımlanan sürümler v0.1.0 (2026-10-14), v0.2.0 (2026-10-15),
v0.3.0 (2026-10-15), v0.4.0 (2026-10-15), v0.5.0 (2026-10-16), v0.5.1 (2026-10-16), v0.5.2 (2026-10-16), v0.5.3 (2026-10-16), v0.5.4 (2026-10-16), v0.5.5 (2026-10-16), v0.5.6 (2026-10-16), v0.5.7 (2026-10-16), v0.6.0 (2026-10-19), v0.7.0 (2026-10-19), v0.7.1 (2026-10-19), v0.8.0 (2026-10-20), v0.9.0 (2026-10-20). v0.1.1 taslağı yayımlanmadı; sahibin isteğiyle 2026-10-15'te silindi.

## Güncel durum ve devir notu (son güncelleme: 2026-10-20)

> Önceki oturumların bağlamı burada özetlenir; yeni bir oturuma başlayan ajan bunu okuyarak devam edebilmelidir.
> Ayrıntılar: [docs/CHANGELOG.md](docs/CHANGELOG.md) (en üstteki kayıtlar), [docs/SECURITY.md](docs/SECURITY.md),
> [docs/DEVELOPMENT.md §9](docs/DEVELOPMENT.md#9-github-deposu-günlük-iş-akışı-ve-sürüm-yayınlama). Oturum sonunda bu
> bölümü güncelleyin (tarih, yapılanlar, açık işler).

**Sahip ve çalışma biçimi**
- Sahip: **Gökhan Dilman** (GitHub `godilman`). Türkçe yazışır; cevaplar Türkçe olmalı. Yazılımcı gibi varsaymayın: neyi
  neden yaptığını tek cümleyle söyleyin, yapması gereken adımları **kopyalanabilir PowerShell komutlarıyla** verin.
  Sahip ayrıntıları unutabileceğini söyledi: her kararı ve açık işi belgelere yazın (bu bölüm + DEVELOPMENT §9.4).
- Geliştirme Windows'ta; sahibin yerel klasörü GitHub'ın **git klonudur** (`origin` = `github.com/godilman/agentbits`,
  `user.email` = `godilman@users.noreply.github.com`). Oturuma `git pull` ile başlayın, commit'ten önce `git status`.
- Geri alınamaz ya da herkese açık sonuç doğuran işlerde (lisans, yayın, Release, geçmişi yeniden yazma, veri silme)
  önce sahibe sorun.

**Sahibin aldığı kararlar** (değiştirmeden önce sorun)
- Sahte giriş ekranı **kaldırıldı** (uygulama tek kullanıcılı). Otopilot varsayılan **açık**.
- Codex ajanı **klasörle sınırlı** (`workspace-write`, ağ yalnızca izinle); `danger-full-access` asla.
- Lisans **PolyForm Strict 1.0.0** — sahibin isteği: "herkes kullanabilsin ama değiştiremesin" (ticari olmayan kullanım
  serbest; değişiklik, türev, yeniden dağıtım yok; ticari kullanım izin ister). Önceki MIT, paketleme hazırlığında bir
  ajan tarafından eklenmişti. README projeyi "source-available" diye tanıtır, "open source" demez. Telif: Gökhan Dilman.
- Depo herkese açık. Destek: Buy Me a Coffee (`godilman`, tamamen gönüllü); uygulamadaki geri bildirim e-postası
  `src/shared/support.ts`.

**Son oturumda yapılanlar (2026-10-15, Faz 1 → v0.1.1)** — ayrıntı CHANGELOG: Türkçe sekme/Kanban adları (sahibin kararı),
Demo sağlayıcı iş türüne göre simülasyon (`shared/demoKind.ts`), paket sadeleştirme (yalnızca exe + dmg + SHA256SUMS,
`publish: null`), Actions Node 24 sürümleri, belge çelişkileri, `isPathAllowed` kaldırıldı, ajanların eklediği işler gözden geçirildi.

**Önceki oturum (2026-10-13 / 14)**
1. **Güvenlik incelemesi, 1. tur** (bağımsız rapor, 27 bulgu) → durum tablosu `docs/SECURITY.md`, ADR-024.
2. **Güvenlik incelemesi, 2. tur:** `sed`'de her betik denetlenir; tırnaklı SQL fonksiyon adları yakalanır; iç içe JSON'daki
   `approved` kararı geçersiz; ajan okumaları **salt-okunur DB kullanıcısı zorunlu**; temizlik beklemesi (`settled`) süre
   dolunca hata verir; MCP stderr/hata metinleri sırlardan arındırılır, kapanışta bağlantı yeniden açılmaz; MCP SDK
   **1.31.0** (eskiyse OAuth reddedilir), `issuer`'sız eski OAuth girişleri açılışta silinir; kapanışta görev başlamaz.
3. **Herkese açık yayın:** README (EN varsayılan + TR), `docs/screenshots/` (Demo, boş profil), LICENSE, CONTRIBUTING,
   kök SECURITY, THIRD_PARTY_NOTICES (`npm run notices`), `.gitignore` / `.gitattributes` (LF), CI ve Build packages iş
   akışları (boş imza secret'ı macOS'u bozuyordu → düzeltildi), **v0.1.0 Release** (Windows exe + macOS DMG/ZIP, imzasız).

**Açık işler / sıradaki adımlar**
- Sahip: GitHub e-posta gizliliği ayarı; isteğe bağlı ayrı destek e-postası; eski yerel `release\` exe'si kullanılmamalı
  (DEVELOPMENT §9.4).
- macOS paketi gerçek bir Mac'te denenmedi; kod imzalama yok (Windows SmartScreen / macOS Gatekeeper uyarır).
- **2026-10-15 sahibin onayladığı yol haritası** (fazlar sırayla, her faz sonunda doğrulama + belgeler + commit/push):
  Faz 1 ✅ temizlik → v0.1.1 · Faz 2 ✅ lider ↔ ajan iletişimi · **P ✅ paralel yazılımcılar** (çoğalt, iş dağıtımı, bağımlılık, farkındalık, worktree — ADR-025) (sahibin kararı: **yalnızca lider** ajanlarla konuşur — görev verir,
  biten işleri ve notları görür, göreve not bırakır; ajanlar birbirleriyle doğrudan konuşmaz) · Faz 3 SECURITY.md'deki 🟡/⏳
  maddeler ✅ (#02 OS yalıtımı ve #24 imza kodla kapanmaz, belgede) · Faz 4 ✅ OpenAI uyumlu uç nokta (Gemini, Ollama, LM Studio) + Codex'e Agentbits araçları · Faz 5 ✅ ajanların web
  sayfası okuması (`web_fetch`), özel rapor, özel GitHub skill, MCP kaynakları/istemleri · Faz 6 ✅ RTF/.doc/.xls/.ppt + OCR · Faz 7 ✅ anlamsal hafıza (isteğe bağlı, ADR-027) +
  aynı klasörde çakışma yönetimi (worktree ile ✅) · **yarış modu ✅** (Ayarlar → Genel, varsayılan kapalı; ARCHITECTURE §6.7a). + **paylaşım ✅** (birim / takım / ajan `.agentbits` dışa-içe aktarma, GitHub bağlantısıyla kurulum; galeri ⏳ ayrıca konuşulacak). Sahip: hepsi bitince
  tek seferde yayın (v0.2.0 ✅ 2026-10-15).
- **2026-10-15 v0.3.0** ✅: dış inceleme bulguları (commit hatasında iş kaybı, worktree yalıtımının sessizce kapanması,
  birleşmemiş bağımlılık, bekletilenlerin kuyruğu tıkaması, eski karar hafızası, akış hataları) + "Bana ihtiyaç var",
  kartta takılma nedeni, kabul kriterleri (v16), "Ne değişti?".
- **2026-10-15 v0.4.0** ✅: **graph hafıza** (ADR-028, v17; sahibin kararları: tam graf, öğrenme önce sorar, tek profil,
  tercihler organizasyon geneli, Organizasyon → Hafıza + üst bar kısayolu), yarışta bağımlılık / kabul kriteri açıkları,
  token / tur sınırında kesilen yanıt, uygulama menüsü arka planı. ⏳ Sahiple konuşulacak: paylaşım galerisi; ileride
  çoklu profil (sahip: "şimdi değil").
- **2026-10-16 v0.5.0**: **SSH üzerinden veritabanı + TLS'siz Production için açık onay** (ADR-029, v18). Tetik: sahibin
  TLS desteklemeyen MySQL 5.6 sunucusuna hiçbir yoldan bağlanamaması. İstisna her adreste (şirket ağları 192.1.x.x gibi genel
  blok kullanıyor — RFC1918 kuralı bunu dışarıda bırakırdı), adres genel görünüyorsa kırmızı uyarı + denetim satırı.
  Tünelde TLS sertifikası gerçek sunucu adına karşı (pg / mssql). SQL Server uçtan uca denenmedi.
- **2026-10-16 v0.5.1**: dış inceleme — tünel başka makineye onaysız gidiyordu (son kısım açık), şifresiz onay hedefe bağlı
  değildi (v19 `plaintext_target`), MySQL sertifika adını denetlemiyordu (`verifyIdentity`; sahip onayladı, uymayan sertifika
  artık "Sertifikaya güven" ister). Uçtan uca testler depoda: **`npm run test:e2e`** (CI'da); renderer mantığı (taslaklar) **`npm run test:renderer`** (CI'da, WSL'den güvenli).
- **2026-10-16 v0.5.2**: sohbette bağlantılar (yalnız okuma; yazma / DDL / SSH görevde) ve erişimsiz bağlantıların yalnız
  adıyla anılması (sahibin kararları).
- **2026-10-16 v0.5.3**: boyutlandırılabilir paneller (`useResize`, boyut `localStorage`'da) ve görev çekmecesinde akışın
  ezilmesi düzeltildi.
- **2026-10-16 v0.5.4**: dış incelemenin 7 bulgusu (hazırlıkta durdurma, temizlikte eski kopya/dal, yarış bağımlılığı, hazırlık
  hatası, başlatma kuralları + "yine de başlat", Bitti'ye sürükleme, hafıza vektörü) + Codex sohbet istemi. `tests/e2e/orchestrator.e2e.ts`.
- **2026-10-16 v0.5.5**: `db_export` (veri modelden geçmez; xlsx / csv / json, CLI'da `.agentbits-exports/` kopyası), `db_query` 1000 satır / 160 KB.
- **2026-10-16 v0.5.6**: Prompt oluşturucu (üst çubuk; tek seferlik, araçsız, kaydetmez). Gerçek modelle davranış henüz denenmedi.
- **2026-10-16 v0.5.7**: `db_export` txt / tsv / md / html; desteklenmeyen biçim hata (önce sessizce xlsx → ajan elle yazıyordu).
- **2026-10-19 v0.6.0**: **proje hafızası klasörü** `.agentbits/memory/` (ADR-030, v20). Sahibin
  kararları: klasör proje içinde; proje başına aç / kapa, varsayılan açık; yazma ayardan (ask varsayılan / auto / off);
  sahibin incelemesiyle: klasör başına sıralı yazma + eşzamanlılık testi, MEMORY.md olmadan da dosyalar listelenir, öneri
  proje / dosya / işlem / içerik taşır ve onayda yeniden denetlenir, **yalnız ekleme** (replace yok), `project_memory_search`,
  hafıza talimat değildir / izin genişletmez. Aynı gün dış incelemenin 5 bulgusu düzeltildi (büyük rehberin kırpılıp geri
  yazılması, `about` maskesi, Codex sohbet köprüsü, incelemede adı geçen dosyalar, 256 KB sonrası sayfalama). Kural: kırpılmış
  okuma (`readHead`) asla diske geri yazılmaz; not + rehber + öneri silme tek kuyruk adımında, hata = not ve rehber geri alınır. ⏳ Gerçek Claude Code / Codex ile denenmedi.
- **2026-10-19 v0.7.0**: **canlı sohbet yanıtı** (`reply:stream`, ADR-031; sahibin 5 notuyla: replyId, açık durumlar, parça sınırında gizli blok filtresi = `stripBlocks` kuralı, Claude CLI bayrağı önceden, yanıt başına 60 ms) + Windows kurulumunun lisans sayfasında Türkçe karakter (BOM'lu kopya). ⏳ UI ve Claude Code token akışı gerçek uygulamada denenmedi.
- **2026-10-19 v0.7.1**: dış inceleme — gizli blok kapanışı JSON string'ini sayar (`blockEnd`, tüm ayrıştırıcılar ortak; önce kod örnekli görev JSON'u sızdırıyor ve görevler kayboluyordu), iptal balonu anında kapanır, 40 krk pencere kalktı.
- **2026-10-19 Paket 1A (hata ve inceleme güvenliği, sürüm artırılmadı, commit yok)**: ilk hatada bekletme (kimlik dahil), görev akışında tek açıklama + `runErrors` türleri, `## Previous attempt` istemi, inceleme sorunları "karar sende"ye nedeniyle düşer (yarış dahil), `tasks:retryReview`; sahibin incelemesinden sonra inceleme çalışma kimliği + görev girdilerine bağlandı (eski onay yeni çalışmayı bitiremez) ve önceki girişim uyarısı onayda reddedilen kayıtları atlıyor; yarışta öbür taraf değişince güncel karşılaştırma gerçekten kuyruğa giriyor, aynı ikili iki kez karşılaştırılmıyor. Sahip onayladı.
- **2026-10-19 Paket 1B (kapatma, durdurma, tamamlama; sürüm artırılmadı, commit yok)**: projeyi / uygulamayı açmak iş başlatmaz (`workStarted` yalnız bellekte, `projects:startWork`, `StartWorkBanner`; bekletilenler serbest kalmaz); kapatma uyarısı sayılarla (`core/quitGuard.ts`, `index.ts` close + before-quit; Windows/macOS elle denenmedi); durdurma notu "hiçbir şey geri alınmadı, değişiklikler şurada"; elle Bitti önce sorar, `completed_by` (v21) `user`, **birleştirmez** (worktree: "Birleştirme bekliyor", bağımlılar bekler, "Değişiklikleri incele ve birleştir"); `taskChanges` commit'lenmemiş yeni dosyaları da gösterir; "Tümünü duraklat" metni dürüst. Test `tests/e2e/sessionStop.e2e.ts`. ⚠️ e2e'de otopilot adımı yazarken `orchestrator.startProjectWork(pid)` şart, yoksa test boşuna geçer. Sahibin 1B incelemesi (3 bulgu) düzeltildi: açılış incelemeleri de başlatmayı bekler (`deferredReviews`), durması doğrulanamayan görev taşınmaz, "incele ve birleştir" önizleme + ayrı karar + ağaç kimliğine (`basis`) bağlı. Paket 4'e devredilen bilinen sınır: yarış istemine B'nin açıklaması girmiyor (`docs/UX_REVIEW_2026-10-19.md` §8). Sahip onayladı.
- **2026-10-19 Paket 2 (dürüst Demo + ilk işe yol; sürüm artırılmadı, commit yok)**: Demo hiçbir araç çağırmaz (sahibin kararı; yeni ayar yok), rapor / log / lider notu / kart / ayrıntı çalışma ve incelemeyi ayrı etiketler (`state.simulatedWork` / `simulatedReview`), kısa iş emri görevdir (`demoIsWork`), bölme `demoParts` (dosya adı / sürüm / URL bölünmez); şablon proje içinden açılınca işaretli "Bu projeye ekle" (`templates:instantiate` `projectId`, store `templateFor`), sohbet boş durumu `team / empty / off`, sağlayıcı formunda "Demo ile dene". Test `tests/e2e/firstRun.e2e.ts` (7 adım, 4 çalışan/lider kombinasyonu dahil). Site Demo metni düzeltildi, yayınlanmadı. Sahip onayladı.
- **2026-10-19 Paket 3 (günlük kullanım; sürüm artırılmadı, commit yok)**: kalıcı taslak (migration v22 `message_drafts`, `lib/drafts.ts`, `useAttachments(pid, channel)` taslak modu — ekler kanala ait, çıkınca silinmez, silinen ek "artık yok"), `useStickToBottom` + "Yeni mesajlar" (sohbet, görev akışı, sol panel), görev düzenleme / not / hızlı mesaj hataları görünür, onay bekleyen iş üç ekranda "henüz başlamadı". Test `tests/e2e/drafts.e2e.ts` + UI düzeneği. Sahibin incelemesindeki 3 yarış düzeltildi (gönderim `draftSnapshot`/`clearSent` ile başladığı anahtar + sürüme bağlı; `att.clear()` kaldırıldı; açılış listesi birleştirilir) + test sırasında bulunan "ilk açılışta ek silme"; tekrar kontrolde 2 kayıp daha (ABA sürüm, yükleme öncesi kör ek listesi) kapandı, testler depoda (`npm run test:renderer`, `tests/renderer/`). Sahip onayladı.
- **2026-10-19 Paket 4 (sonuç ve doğrulama; sürüm artırılmadı, commit yok)**: `core/evidence.ts` (araç kaydından komut ✓/✗/?, yazılan dosya, retler; yalnız Claude Code kayıt verir, diğerleri "bilinmiyor"), lider istemine kanıt bölümü + sınırlı diff, `tasks:result` + görev ayrıntısında "Sonuç" kutusu, yarış istemine B'nin düzenlenmiş girdileri (§8 kapandı). Test `tests/e2e/result.e2e.ts`. Sahibin incelemesi (3 bulgu) kapandı: yazma sonucuyla eşleşir, kanıt tüm kayıttan + tam sayım + korunan hatalar, yarışta B'nin incelemesi asıl görevdeki tek kayıttan; tekrar kontrolde dosya başına yazıldı/son deneme ayrımı ve listeden bağımsız sayımlar. Sahip onayladı (ifade: "Dosya araçlarıyla başarılı yazma kaydı yok").
- **2026-10-19 Paket 5A (erişilebilirlik + dar pencere; sürüm artırılmadı, commit yok)**: `components/common/Layer.ts` (katman yığını, Escape en üstte, odak dönüşü, odak tuzağı) → Modal / Ayarlar / açılır menüler; `:focus-visible`; `Sidebar` `useFolded` + `Rail` (içerik < 988 px → ikon şeridi, panel içeriğin üstünde); pano sütunları ≥ 230 px (üst üste binme düzeldi); `dedupeFeed`, `shownStatus`; zinc-600/700 → 500. Test `tests/renderer/feed.test.ts` + UI düzeneği. 2026-10-20 ek: Kılavuz pano yanında sığmıyorsa üstte diyalog (`lib/layout.ts` `fitLayout`, `tests/renderer/layout.test.ts`); 960 CSS px altında üst çubuk yalnız ikon; `zinc-500` = `#8b8b93` (tailwind.config), alan odak / hata kenarları ≥ 3:1; ölçülü kontrast denetimi 21 ekran TR/EN 0 hata. Tip ölçeği 10/11/12/13/15/18/22 işlevine göre (kural ARCHITECTURE "Tip ölçeği", test `typeScale.test.ts`); örtüşme denetimi TR/EN 4 boyut temiz. ⏳ %200 proje sekmesi Windows'ta; Electron / ekran okuyucu elle denenmedi — 5A tamamen doğrulanmış değil. İnceleme düzeltmeleri (2026-10-20): canlı akış yalnız `meta.event` ile birleştirir (`sameEvent`), katman yığını z-index sırası (`openLayer`), adsız ikon düğmeleri; testler `feed`/`layer`. **5B (2026-10-20) sistem bildirimleri:** tek giriş `main/notify.ts` `notifyUser` (yeni olay kaynağı → oradan; `hold()` üçüncü parametresi zorunlu: kullanıcı kaynaklıysa `null`), zamanlama `shared/notify.ts`, tıklama `lib/notifyNav.ts`; testler `notify.test.ts`, `e2e/notify.e2e.ts`, `renderer/notifyNav.test.ts`. ⏳ gerçek Windows denemesi (liste: CHANGELOG 5B "Bilinen / açık"). Kararlar `docs/UX_REVIEW_2026-10-19.md` §8'de. **Paket 1A–5B v0.8.0 olarak yayımlandı (2026-10-20, etiket e930146; site 4c39bb3).** Ekran görüntüleri v0.8.0 ile yeniden çekildi (2026-10-20, Demo).
- **2026-10-20 Yeni sürüm kontrolü + yükseltme öncesi yedek (ADR-032; v0.9.0 olarak yayımlandı)**: yalnız kontrol ve haber, kurulum resmî Releases sayfasından (sahibin kararı: imzalı paket + imzalı → imzalı gerçek test olmadan uygulama içi indirme / kurulum yok; `electron-updater` YOK, sertifika eklemek hiçbir şeyi açmaz). `shared/update.ts` (saf: `createChecker`, `readRelease`, `releasePage`), `main/update.ts` (`net.fetch` sabit adres, `redirect: 'error'`, 30 sn + 6 saat, yalnız paketlenmişte otomatik), ayar `autoUpdateCheck`, IPC `update:*`, Ayarlar → Genel `UpdateRows`, üst bar `SettingsButton` noktası. `db/index.ts` `openDb`: bekleyen migration → önce `VACUUM INTO` `backups/agentbits-pre-migration-…` (en yeni 3; `createBackup` rotasyonu saymaz), yedek yoksa migration yok, daha yeni şema açılmaz, `DbStartError` → `index.ts` `showDbStartError` + `app.exit(1)` (boş profil yok). Migration artık bekleyen tüm adımlar için TEK transaction; saklama yalnız başarılı yükseltmeden sonra. Testler `tests/update.test.ts`, `e2e/update.e2e.ts` (5), `e2e/dbUpgrade.e2e.ts` (8). ⏳ gerçek Windows / Mac'te görünüm ve hata penceresi
- **2026-10-19 ürün deneyimi incelemesi** → `docs/UX_REVIEW_2026-10-19.md` (kod değişmedi). ⏳ Sahip ilk çalışma paketini (şablon → proje ataması, sohbet boş durumu, CLI yoksa Demo, koşullu kaydırma, inceleme hatası görünür) onaylayınca geliştirme başlar.
- `docs/SECURITY.md`'deki 🟡 / ⏳ maddeler (ör. büyük veride UI sayfalama) ve `docs/FEATURES.md` "Bilinen sorunlar".

**Önceki oturumlardan öğrenilenler**
- Yeni sürüm: `package.json` sürümünü artır → Actions → Build packages → `release_tag` → taslağı dene → Publish
  (DEVELOPMENT §9.3). Elle etiket göndermeyin.
- Yerelde paketlemeden önce **`npm ci`** (eski `node_modules` eski MCP SDK'yı pakete koymuştu).
- Windows'ta CRLF'ye dönen dosyalar testleri bozuyordu → `.gitattributes` her yerde LF; testler `\r?\n` ile böler.
- README görüntüleri: Demo sağlayıcı, ayrı boş `AGENTBITS_DATA_DIR`, 1600×960, e-ticaret şablonu, 256 renk PNG; gerçek veri,
  anahtar, kişisel yol görünmemeli.
- Bulut ajan oturumları GitHub'da repo ayarı değiştiremez, etiket gönderemez, Release düzenleyemez; iş akışı başlatabilir.

## Teknoloji yığını

| Katman | Seçim (sürüm `package.json`'dan) |
|---|---|
| Masaüstü kabuğu | Electron `^44.7` (main + preload + renderer) |
| Build | electron-vite `^5` (Vite `^7.3`), paketleme: electron-builder `^26` (`electron-builder.config.js`, NSIS) |
| Çoklu dil | `i18next` `^25` (main + renderer), `react-i18next` `^15` — İngilizce + Türkçe ([docs/I18N.md](docs/I18N.md)) |
| UI | React `^19.2`, TypeScript `~5.9` (strict), Tailwind CSS `^3.4` (v4 **değil**), lucide-react `^0.577` |
| Durum yönetimi | Zustand `^5` (tek store: `src/renderer/src/store/useAppStore.ts`) |
| Veritabanı | SQLite — `better-sqlite3` `^13` (WAL, FTS5), N-API hazır binary → rebuild gerekmez |
| Dosya çıkarma | `unpdf` `1.8.1` (PDF.js), `fflate` `0.8.3` (ZIP/Office), `papaparse` `5.7.0` (CSV), `cfb` `1.2.2` + `word-extractor` `1.0.4` (Office 97–2003) — saf JS, `files-worker`'a paketlenir (externalize edilmez); OCR `tesseract.js` `7.0.0` (WASM, tam sabit; dil verisi `@tesseract.js-data/{eng,tur}`, çevrimdışı; `asarUnpack`'te — ADR-026) |
| Uygulamalar (MCP) | `@modelcontextprotocol/sdk` `1.31.0` (sabit; 1.30.x'te OAuth güvenlik açığı vardı; bağımlılık değişince `npm ci` — kurulu SDK eskiyse OAuth reddedilir) — yalnızca main'de istemci (stdio, Streamable HTTP/SSE, OAuth); saf JS |
| Terminal | `@xterm/xterm` `^5.5` + `@lydell/node-pty` `1.2.0-beta.15` (gerçek PTY, hazır N-API binary; yüklenemezse pipe yedeği) |
| Ofis | Saf HTML5 Canvas, kodla çizilen sprite'lar (harici görsel yok) |
| Sırlar | Electron `safeStorage` (Windows'ta DPAPI) |
| Node | **22+** zorunlu |

Teknoloji seçimlerinin gerekçeleri → [docs/DECISIONS.md](docs/DECISIONS.md).

## Hızlı başlangıç (Windows PowerShell, Node 22+)

```powershell
cd agentbits               # deponun bulunduğu klasör (git clone https://github.com/godilman/agentbits.git)
npm ci                     # Electron indirilir; better-sqlite3 hazır gelir (Build Tools gerekmez)
npm run dev                # geliştirme modu (HMR; Vite 127.0.0.1:5173)
npm run typecheck          # main + renderer tip kontrolü (her değişiklikten sonra zorunlu)
npm run test:unit          # birim testleri: SQL/SSH sınıflandırma, dosya çıkarma, skill/MCP ayrıştırma, çeviriler (Node strip-types)
npm run build              # out/ klasörüne üretim derlemesi (her değişiklikten sonra zorunlu)
npm start                  # derlenmiş uygulamayı çalıştırır
npm run dist:win           # Windows NSIS kurulum paketi → release/ (npm run dist aynı)
npm run dist:mac           # macOS DMG (arm64 + x64) — yalnızca macOS'ta; Mac yoksa GitHub Actions (.github/workflows/release.yml)
```

Güvenli deneme için ayrı veri klasörü + Demo sağlayıcı kullanın:

```powershell
$env:AGENTBITS_DATA_DIR = "$env:TEMP\agentbits-test"; npm run dev
```

Kurulum sorunları (Electron binary eksik, siyah pencere, execution policy, Claude oturumu) →
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Depo haritası

| Yol | Sorumluluk |
|---|---|
| `src/shared/types.ts` | Domain tipleri (Agent, Task, Run, Message, Memory, Decision, Report, Provider, **OrgUnit, Project, TeamTemplate**…) |
| `src/shared/ipc.ts` | **Tipli IPC sözleşmesi** (`Api` haritası), `AppEvent` olay birliği, `PreloadBridge` |
| `src/shared/i18n.ts`, `src/shared/locales/` | Çoklu dil: `LANGUAGES`, `createI18n`, `I18nKey`, `ts`; `locales/<dil>/<bölüm>.json` (en referans) — main `src/main/i18n.ts`, renderer `src/renderer/src/i18n.ts` ([docs/I18N.md](docs/I18N.md)) |
| `src/shared/connectionRules.ts` | Bağlantı sınıflandırması (`classifySql`, `classifyCommand`), seviyeler, portlar — etiketsiz; `shared/connections.ts` bunu yeniden dışa aktarır ve çevrilmiş etiketleri ekler |
| `src/shared/support.ts` | Geliştirici iletişimi (sabit, ayar değil): `SUPPORT_URL` (Buy me a coffee), `FEEDBACK_EMAIL`, `FeedbackKind` — durum çubuğundaki Geri bildirim modalı (`features/feedback/`) ve kahve düğmesi |
| `src/shared/models.ts` | Model seçenekleri: `MODEL_CATALOG` (sağlayıcı türüne göre önerilen modeller + kısa not anahtarı), `DEFAULT_MODEL`, `isOpenAiChatModel`; UI `features/settings/ModelSelect.tsx`, canlı liste `providers:models` → `src/main/providers/models.ts`. **Yeni model çıktığında bu kataloğu güncelleyin.** |
| `src/shared/skills.ts` / `src/main/skills/` | Skill'ler (talimat paketleri, `SKILL.md`): `repo.ts` (dosyalar DB'de), `source.ts` (GitHub/zip/klasör/.md → önizleme → kurulum), `service.ts` (ajanın skill'leri, `skill_read`, prompt, Codex kopyaları) — ARCHITECTURE §9e. Ajanın `skills` alanı (yetenek etiketleri) **başka bir şeydir** |
| `src/shared/apps.ts` / `src/main/apps/` | Uygulamalar (MCP sunucuları): `repo.ts` (sırlar şifreli), `client.ts` (MCP istemcisi, OAuth), `service.ts` (**tek giriş noktası**: araç listesi, politika + onay + denetim, prompt, içe aktarma) — ARCHITECTURE §9f |
| `src/shared/review.ts` | Lider inceleme kararını ayrıştırma (`parseReview`; yalnızca gerçek boolean onaylar) — `tests/review.test.ts` |
| `src/shared/leadComms.ts` | Lider → ekip notları (```` ```message ```` → `parseLeadMessages`) ve rapor özeti (`reportExcerpt`); yalnızca lider ekiple konuşur — `tests/leadComms.test.ts` |
| `src/shared/demoKind.ts` | Demo sağlayıcının iş türü tahmini (kod / araştırma / içerik / veri) — `tests/demo.test.ts` |
| `src/shared/settingsRules.ts` | `DEFAULT_SETTINGS`, `validateSettingsPatch` (`settings:update` her değeri denetler), `agentEnv` (ajan CLI'larının devraldığı ortam: izin listesi) — `tests/settings.test.ts` |
| `src/shared/redact.ts` / `src/shared/cancel.ts` | Transkriptte sır maskeleme (`logsRepo.add`) / durdurulan çalışmanın DB-SSH çağrısını kesme (`cancellable`) — `tests/redact.test.ts`, `tests/cancel.test.ts` |
| `src/shared/org.ts` | Main ve renderer'ın ortak saf yardımcıları: `descendantIds`, `unitMemberIds`, `projectMemberIds`, `unitPath`, `wouldCycle` |
| `src/main/index.ts` | Pencere, yaşam döngüsü (DB → dil → `ensureOrgDefaults` → `renameLegacyDefne` → IPC → orkestratör → bakım → pencere), dev sunucusu yeniden deneme |
| `src/main/ipc.ts` | Tek `api` kanalı için handler tablosu (`Api`'ye göre tip kontrollü) + organizasyon/proje kuralları |
| `src/main/events.ts` | `emit()` / `toast()` — main → renderer olay yayını (`event` kanalı) |
| `src/main/secrets.ts` | API anahtarı şifreleme (`safeStorage`) |
| `src/main/db/` | `index.ts` bağlantı + pragmalar, `schema.ts` sürümlü migration'lar (v1–v20), `repos.ts` sorgu katmanı (başlangıç verisi yok: ilk açılış boş organizasyon + tek boş proje) |
| `src/main/core/orchestrator.ts` | Tick, görev çalıştırma, onay, inceleme, sohbet — hepsi **proje kapsamlı** |
| `src/main/core/org.ts` | `ensureOrgDefaults()`, `projectMembers`, `projectLead`, `memberProjectIds`, `activeProjectIds`, `getProject` |
| `src/main/web/` | `web_fetch` (`browser` izni): `netGuard.ts` (SSRF: yalnızca genel adresler), `fetchPage.ts` (IP sabitleme, yönlendirme denetimi, sınırlar), `tool.ts` — `tests/web.test.ts`, `tests/webFetch.test.ts` |
| `src/main/core/team.ts` / `src/main/core/worktree.ts` | Paralel çalışma (ADR-025): canlı ekip durumu + `team_status` / görev başına git worktree (dal, commit, birleştirme, çakışma; depo hook'ları çalışmaz) — `tests/team.test.ts`, `tests/worktree.test.ts` (gerçek git) |
| `src/main/core/legacy.ts` | Eski sürümlerin verisi için tek seferlik açılış düzeltmeleri: `renameLegacyDefne()` (eski başlangıç ekibindeki "Defne" → "Zeynep": ajan + saklanan metinler; `settings` bayrağı `legacy.defneRenamed`) |
| `src/main/core/folders.ts` | Proje klasörü denetimi: `normalizePath`, `isAppFolder`, `inspectFolder`, `assertUsableFolder`, `folderStatus` |
| `src/main/core/templates.ts` | Hazır takım/şirket şablonları ve `instantiateTemplate()` |
| `src/main/core/memory.ts` | Hafıza motoru (FTS5 + önem + tazelik; proje + organizasyon geneli) |
| `src/shared/projectMemory.ts` / `src/main/projectMemory/service.ts` | Proje hafızası klasörü `.agentbits/memory/` (ADR-030): saf ad / rehber / not / arama / prompt bölümü — dosya erişimi, araçlar (`project_memory_read/search/write`), onay — `tests/projectMemory.test.ts`, `tests/e2e/projectMemory.e2e.ts` |
| `src/main/core/maintenance.ts` | Veri yönetimi: kullanım, proje/organizasyon temizliği, log saklama (`startMaintenance`), yedek (`VACUUM INTO`), geri yükleme (yeniden başlatır), `factoryReset` |
| `src/main/core/permissions.ts` / `prompts.ts` | İzin matrisi → araç listesi; lider/çalışan/inceleme prompt'ları, ```` ```tasks ```` / ```` ```decision ```` ayrıştırma |
| `src/main/providers/` | Sağlayıcı adaptörleri: `anthropic`, `openai`, `claudeCli`, `codexCli`, `mock`, ortak `cli.ts`, `types.ts` |
| `src/main/terminal/manager.ts` | Kullanıcı kabukları: node-pty ile gerçek PTY, yoksa pipe (`mode`), `resize` (projeler arası ortak) |
| `src/main/db/usage.ts` / `src/main/core/usage.ts` | `usageRepo` (token_usage), `instructionsRepo` (agent_instructions), `APP_SESSION_ID`; `usageSummary()` |
| `src/shared/connections.ts` | Bağlantı türleri/varsayılan portlar, `classifySql`, `classifyCommand`, `DEFAULT_SSH_READ`, erişim seviyeleri (main + renderer + testler) |
| `src/main/connections/` | `repo.ts` (bağlantı, izin, denetim kayıtları; sırlar `safeStorage`), `drivers.ts` (pg / mysql2 / mssql / ssh2 — çağrı başına kısa bağlantı), `service.ts` (**tek giriş noktası**: yetki, Production onayı, denetim, transkript satırları, araçlar), `tools.ts` (araç tanımları, `runTool`), `bridge.ts` (127.0.0.1 HTTP köprüsü, çalışma başına token, MCP yapılandırması) |
| `src/shared/files.ts` | Dosya sınırları (`MAX_FILE_BYTES` 50 MB, `MAX_FILES_PER_SEND` 20, `MAX_SAVE_BYTES` 2 MB, `MAX_SAVES_PER_RUN` 20), etiketler, `SAFE_OPEN_EXT`, `SAVE_EXT`, `estimateTokens`, `fileRef`, `kindFromName`, `safeFileName` |
| `src/main/files/` | `extract.ts` (saf çıkarma: tür tespiti, kodlama, ZIP sınırları, PDF/DOCX/XLSX/PPTX/CSV/MD/JSON, parçalama, `findSuspicious`), `worker.ts` (worker_threads; 768 MB, 120 sn, en fazla 2 paralel), `storage.ts` (içerik-adresli orijinaller, yedek farkında GC), `repo.ts` (`filesRepo`: kayıt, parça, FTS, bağlar, erişim), `service.ts` (**tek giriş noktası**: alma, erişim, paylaşım, prompt bölümü, araçlar, klasör taraması), `tools.ts` (`files_list`, `file_read`, `file_search`, `file_save`) |
| `src/main/agentTools.ts` | `agentTools(ctx)` / `runAgentTool`: bağlantı + dosya + skill + uygulama araçlarını moda ve izinlere göre birleştirir |
| `src/main/mcp/server.ts` | Claude Code (ve uygulaması olan Codex ajanı) için MCP sunucusu (`out/main/mcp-connections.js`; Electron binary'si + `ELECTRON_RUN_AS_NODE=1`; tüm Agentbits araçlarını köprüye iletir) |
| `src/shared/steering.ts` | `steeringFor(kind)` (talimatın sağlayıcıda ne yaptığı: resume / restart / simulated), `usageReportingFor` |
| `src/preload/index.ts` | `contextBridge` → `window.agentbits` (`invoke`, `on`, `platform`, `pathForFile`) |
| `src/renderer/src/App.tsx` | Kapı sırası (yükleniyor → Onboarding → ana düzen; giriş ekranı yok), `view` (org / project) yönlendirme, kısayollar |
| `src/renderer/src/store/useAppStore.ts` | Zustand store: veri, `view`/`orgTab`/`activeProjectId`/`openProjectIds`, `channelKey`, olay birleştirme |
| `src/renderer/src/lib/` | `api.ts` (`call`, `apiError`), `format.ts`, `markdown.tsx`, `org.ts` (`useProjectScope`, `resolveProjectLead`, `isCliProvider`…), `transcripts.ts` (ajan başına `log:new` aboneliği) |
| `src/renderer/src/components/` | `layout/` (iki satırlı TopBar, Sidebar, StatusBar, Toasts), `common/` (`Logo`, `PixelAvatar`, `ui`, `ErrorBoundary`, `TokenUsage`), `onboarding/` (sağlayıcı + ilk projenin adı/klasörü) |
| `src/renderer/src/features/` | `org/` (Organizasyon sayfası: Şema, Takımlar, Ajanlar, Şablonlar, Skill'ler, Uygulamalar, Bağlantılar), `skills/` (`SkillsView`, `AddSkillModal`, `AgentSkills`), `apps/` (`AppsView`, `AgentApps`), `connections/` (`ConnectionsView`, `AuditList`, `ApprovalsDock` = Production onayları), `agents/` (Organizasyon → Ajanlar), `project/` (ProjectLauncher = açılış proje seçici + ProjectHome, ProjectModal, Ekip bölümü), proje bölümleri `chat`, `office`, `terminal` (`AgentGrid` + `AgentPane` = ajan terminalleri, `TerminalView` = Kabuklar), `tasks`, `reports` (+ `UsagePanel`), `decisions`, `browser`, `files` (`FilesView`, `FilePreviewModal`, `TaskFiles`, `hooks.ts`, `parts.tsx`); `settings` (`SettingsPanel`, `DataSection` = Veri yönetimi, `parts.tsx`), `guide` (`GuideDrawer` = Kılavuz yan paneli: 8 adım otomatik işaretlenir, "Nerede ne var", Kısayollar; TopBar "Kılavuz" / `F1`) |
| `src/renderer/src/index.css` | Tailwind + bileşen sınıfları (`btn-*`, `input`, `card`, `label`, `panel-title`…) |
| `electron-builder.config.js`, `build-resources/` | Paketleme yapılandırması (JS; `extraResources`: `LICENSE` → `LICENSE.txt`, `THIRD_PARTY_NOTICES.md`; `appId` `app.agentbits.desktop`; Windows NSIS + macOS DMG, `publish: null` → güncelleme dosyası / blockmap yok; imza/noterlik ortam değişkenleriyle açılır → `docs/DEVELOPMENT.md` §8); `build-resources/icon.svg` (logo kaynağı), `icon.png` (512 px, dev penceresi), `icon.ico` (16–256), `icon.icns` (macOS), `entitlements.mac.plist` (özel NSIS betiği yok; `installer.nsh` kaldırıldı) |
| `.github/workflows/ci.yml`, `.github/workflows/release.yml` | GitHub Actions: `CI` her push/PR'da Windows + Ubuntu'da `npm ci` → typecheck → `test:unit` → build → `npm audit`; `Build packages` yalnızca elle (Actions → Run workflow) Windows + macOS paketlerini derler, `release_tag` verilirse taslak Release oluşturur (etiket tetikleyicisi bilinçli olarak yok) |
| `docs/` | Proje belgeleri (bkz. aşağı) |
| `out/`, `release/` | Derleme çıktıları (gitignore'da) — elle düzenlemeyin |

## En önemli kurallar ve tuzaklar

1. **IPC sözleşmesi tek yerden yönetilir.** Yeni bir main çağrısı = `src/shared/ipc.ts`'deki `Api`'ye
   imza ekle → `src/shared/ipcSchema.ts`'teki `IPC_SCHEMA`'ya argüman türlerini ekle (eksikse typecheck kırılır; main her
   çağrıyı buna göre denetler) → `src/main/ipc.ts`'deki `handlers`'a handler ekle (`Handlers` tipi eksikte derlemeyi kırar)
   → renderer'da `call('alan:eylem', ...args)`. Yerel yol alan metot `pathGrants.ts`'ten geçer (`assertPathsAllowed`). `ipcRenderer`'ı doğrudan kullanmayın. Main hatalarını
   kullanıcıya `apiError(e)` ile gösterin. Adım adım → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#4-ipc).
2. **Main → renderer güncellemeleri** `emit({ type: '…:changed' })` ile gider (`units:changed`,
   `projects:changed`, `messages:changed` dahil); store bunları `schedule()` ile 120 ms'de birleştirip yeniden
   çeker. Veri değiştiren her handler uygun olayı yayınlamalıdır. `message:new` / `log:new` yalnızca ekleme
   taşır; mesaj veya log **silen** kod `messages:changed` yayınlamalıdır (feed, loglar ve kanal önbelleği
   yeniden yüklenir). `usage:changed` (500 ms kısıtlı), `instructions:changed`, `connections:changed`, `approvals:changed`, `audit:changed`
   ve `files:changed` da vardır. Ajan terminalleri
   `log:new`'i store'dan değil `lib/transcripts.ts` üzerinden ajan başına dinler; canlı sohbet yanıtı (`reply:stream`) da
   `lib/replyStreams.ts`'tedir — yüksek frekanslı akışları global store'a koymayın.
3. **Her yeni proje kayıtı `projectId` taşımalıdır.** Görev, çalışma (run), mesaj, karar, rapor, ajan
   transkripti (`agent_logs`), token kullanımı, talimat, dosya ve projeye ait hafıza `project_id` ile yazılır (`tasksRepo.create({ …, projectId })`,
   `messagesRepo.create(channel, type, sender, content, projectId)`, `runsRepo.create(…, projectId)`…).
   Renderer görünümleri aktif projeye göre süzer (`useProjectScope()`); kanal önbelleği
   `channelKey(projectId, channel)` ile anahtarlanır. `project_id = NULL` olan hafıza **organizasyon
   genelidir**. Unutulan `projectId` veriyi yanlış projeye (varsayılana) düşürür.
4. **Zustand seçici kuralı:** seçicide **yeni dizi/nesne üretmeyin** (`s.agents.filter(...)`) — sonsuz
   render döngüsü / siyah ekran olur. Ham dilimi seçin, türetmeyi `useMemo` ile yapın (`useProjectScope`
   örneği). İlkel değer ya da `find` ile mevcut nesne döndürmek güvenlidir.
5. **React StrictMode** dev'de effect'leri iki kez çalıştırır. `init()` idempotenttir; olaylar `id` ile
   tekilleştirilir. Yeni abonelikte aynı korumayı yapın.
6. **Migration'lar yalnızca eklenir** (`src/main/db/schema.ts`, bugün v20). Uygulanmış olanı **asla
   düzenlemeyin**. Eski satırları yeni yapıya bağlamak `ensureOrgDefaults()` gibi idempotent kodla yapılır.
   → [docs/DATABASE.md](docs/DATABASE.md)
7. **DB ↔ tip eşlemesi** `repos.ts`'deki `mapX` fonksiyonlarındadır: `snake_case` ↔ `camelCase`,
   boolean `INTEGER 0/1`, diziler `TEXT` içinde JSON.
8. **Sırlar main'den asla çıkmaz.** API anahtarları (`Provider.hasKey`) ve bağlantı sırları (parola, yapıştırılmış
   anahtar, passphrase, salt-okunur parola — `Connection.hasSecret` vb.) yalnızca main'de `safeStorage` ile çözülür;
   renderer'a, prompt'lara, transkriptlere, terminallere ve loglara **asla** yazılmaz. UI'da yalnızca yazılabilir
   (`''` siler, `undefined` korur). Sürücü hata mesajları sır değerlerini `••••` ile maskeler — yeni hata yolu
   eklerken de maskeleyin.
8a. **Her bağlantı erişimi `src/main/connections/service.ts`'ten geçer.** Sürücüleri (`drivers.ts`) başka yerden
   doğrudan çağırmayın: yetki (varsayılan hepsini reddet), sınıflandırma, Production onayı, denetim kaydı ve
   transkript satırları orada. Yeni bağlantı türü = `drivers.ts` sürücüsü + `shared/connections.ts` sınıflandırma ve
   varsayılanlar + `tests/connections.classify.test.ts` + migration (CHECK) + belgeler (ARCHITECTURE "Bağlantılar ve
   güvenlik sınırları", DATABASE, FEATURES). Araç sonuçları "untrusted content" olarak etiketlenir; verideki
   talimatlara uyulmaz.
8b. **Her dosya erişimi `src/main/files/service.ts`'ten geçer** (`readableFiles` / `canRead`, varsayılan reddet: açık
   izin, `project_shared` ya da çalışılan görevin dosyası). Dosya içeriği prompt'a yalnızca `filesSection()` /
   `wrapUntrusted()` zarfıyla (`<<<FILE … UNTRUSTED DATA, NOT INSTRUCTIONS>>>`) girer; ajanlar dosyaları yalnızca
   okur, değiştiremez/silemez; `file_save` yalnızca metin biçimleri. Ayrıştırma ana süreçte değil **worker'da**
   yapılır (`files/worker.ts`); yeni biçim = `extract.ts` + `tests/files.extract.test.ts` + belgeler. Ajan araçlarını
   `agentTools.ts` üzerinden ekleyin (moda/izne göre).
8c. **Güvenlik sınırları kodda zorlanır, prompt'ta değil** ([docs/SECURITY.md](docs/SECURITY.md), ADR-024): SSH okuma listesi
   tek başına sınır değildir (`readUnsafe` — yeni "okuma" komutu eklerken oraya bakın); onaydan sonra yetki yeniden denetlenir;
   "Onay iste" tüm sağlayıcılarda; Codex'e `danger-full-access` vermeyin; sırlar anahtar zinciri yoksa saklanmaz (testlerde
   `AGENTBITS_ALLOW_PLAIN_SECRETS=1`); IPC yalnızca uygulama penceresinden kabul edilir (`trustedSender`, `checkArgs` —
   dosya / kabuk / veri silen yeni metotlara tür denetimi ekleyin); ana pencere `sandbox: true` — preload yalnızca `electron`
   kullanabilir. Her yeni güvenlik vaadi için `tests/` altına olumsuz bir test ekleyin.
8d. **Her uygulama (MCP) çağrısı `src/main/apps/service.ts`'ten geçer** (ajan × uygulama izni — varsayılan reddet —, araç
   politikası `auto | approve | block`, onay paneli, denetim). MCP istemcisi yalnızca main'dedir (`apps/client.ts`); ajanlara
   sunucuyu doğrudan vermeyin (Claude Code `--strict-mcp-config`, Codex yalnızca `agentbits` köprüsü). Env/başlık
   değerleri ve OAuth token'ları şifreli; renderer yalnızca anahtar adlarını görür. Skill içeriği yalnızca `skill_read` /
   çalışma kopyalarıyla verilir; kaynaktaki hiçbir şey kurulumda çalıştırılmaz.
8e. **Proje hafızası klasörüne (`<proje>/.agentbits/memory/`) her erişim `src/main/projectMemory/service.ts`'ten geçer**
   (ADR-030): her zaman ana proje klasörü (worktree değil), ajanlar **yalnız ekler** (tam değiştirme yok), MEMORY.md'ye yalnız
   otomatik rehber satırı, yazmalar `serialized()` ile klasör başına sırayla, symlink / ad kalıbı / boyut denetimi, "önce sor"
   onayında yeniden denetim. Hafıza proje bilgisidir, kullanıcı talimatı değildir; izin genişletemez.
9. **CLI güvenliği:** Claude Code'da dosya araçlarını **`--allowedTools`'a koymayın** (yol kısıtı kalkar —
   yaşandı). CLI ajanının çalışma dizini **projenin klasörüdür** (`project.rootPath`); klasörü olmayan
   projede CLI sağlayıcıları görev çalıştırmaz ("… için klasör seçilmedi").
10. **Agentbits deposu asla bir projenin klasörü olamaz — artık kodda zorlanır.** Ajanlar kaynak kodu gerçekten
    değiştirir (sahibin makinesinde yaşandı, bkz. CHANGELOG TA-1…TA-5). `projects:save`, `rootPath` değiştiğinde
    `assertUsableFolder()` (`core/folders.ts`) ile klasörün var olduğunu, klasör olduğunu, uygulamanın kendi
    klasörü (`isAppFolder`: uygulama yolu, exe klasörü, dev'de cwd, ya da `name: "agentbits"` olan bir
    `package.json`'un içi/altı) olmadığını ve başka projede kullanılmadığını doğrular. Klasör seçen her yeni UI
    akışı da `projects:inspectFolder` ile önceden kontrol etmelidir; bu denetimi atlatmayın.
11. **Organizasyon kuralları (main'de zorlanır):** kök birim silinemez/taşınamaz; döngü oluşturan taşıma
    reddedilir (`wouldCycle`); varsayılan proje de silinebilir (rolü en son açılan diğer projeye geçer; tek kalan proje silinemez); proje silmek görev, çalışma, log,
    sohbet, karar, rapor ve proje hafızasını siler; birime lider atamak üyeliği otomatik ekler; bir ajan
    birden çok birimde olabilir; projeye atanan birimin alt birimleri de projeye dahildir.
12. **UI iki dilli (İngilizce + Türkçe)**, kod/yorumlar İngilizce. **Çoklu dil (ZORUNLU):** kullanıcının gördüğü hiçbir metin koda yazılmaz — her metin
    `src/shared/locales/en/` **ve** `tr/` altındaki aynı anahtara eklenir (`t('bölüm:anahtar')`); `npm run test:unit`
    çevirileri ve kaynaktaki Türkçe sabit metinleri denetler. Ayrıntı ve örnekler: [docs/I18N.md](docs/I18N.md). TopBar iki satırlıdır: üstte "Organizasyon" + proje
    sekmeleri, altta proje bölümleri Chat, Office, Ekip, Terminal, Tasks, Reports, Decisions, Browser, Dosyalar
    (`Ctrl+1…9`; Terminal'in içinde "Ajan terminalleri" / "Kabuklar"). `Ctrl+Tab` / `Ctrl+Shift+Tab` projeler arası, `Ctrl+P` proje seçici (terminalde yok sayılır), `F1` Kılavuz,
    `Ctrl+O` Organizasyon, `Ctrl+,` ayarlar. Açılışta varsayılan proje otomatik açılmaz: proje seçici çıkar
    (`settings.startupProjects`); hiç sekme açık değilse ProjectHome görünür.
    Yeni bölüm = `Tab` tipi + `TABS` (`TopBar.tsx`) + `App.tsx`.
13. **Office, Terminal ve Browser hep monte kalır** (`hidden` ile gizlenir); koşullu render'a çevirmeyin. Ajan
    terminal bölmeleri de büyütülünce diğerleri monte kalır (gizlenir); ekran dışındaki bölmeler
    `IntersectionObserver` ile çizimi durdurur, sonra yetişir. Talimat akışında UI asla "modele canlı yazıyor"
    gibi davranmaz; sağlayıcının gerçek davranışını `steeringFor()` etiketiyle gösterir (ADR-017).
14. **Ofiste 10 çalışan masası + 1 lider masası** var (`WORKER_DESKS`, `LEAD_DESK` — `features/office/map.ts`;
    sayaç `WORKER_DESK_COUNT`). Ofis yalnızca aktif projenin ekibini gösterir; fazlası masa paylaşır.
15. **Native bağımlılık yalnızca hazır N-API binary'li ve ADR'li olabilir.** Bugün iki tane var:
    `better-sqlite3` (ADR-002) ve `@lydell/node-pty` (ADR-016; platform başına opsiyonel paketlerle gelir,
    `asarUnpack`'te). `electron-rebuild` / Build Tools gerektiren paket eklemeyin; yeni bir native modül önce ADR
    ister. node-pty yüklenemezse terminal pipe moduna düşer (görünür "Pipe modu" rozeti). Saf JS bağımlılıklar
    (ör. bağlantı sürücüleri `pg`, `mysql2`, `mssql`, `ssh2`) ADR gerektirmez; `ssh2`'nin opsiyonel native kripto
    eklentisi Build Tools yoksa derleme uyarısı basıp saf JS'e düşer — bu beklenen durumdur. Dosya çıkarma
    kütüphaneleri (`unpdf`, `fflate`, `papaparse`) worker'a paketlenir (`externalizeDepsPlugin` `exclude`). Yol takma adları:
    `@/…` → `src/renderer/src`, `@shared/…` → `src/shared`.
16. **Bitirmeden önce doğrulama:** `npm run typecheck`, `npm run build` ve `npm run test:unit` (sınıflandırma, dosya
    çıkarma ve çeviri denetimi) hatasız. Başka test altyapısı yok; Demo sağlayıcı + ayrı `AGENTBITS_DATA_DIR` ile elle
    doğrulayın. Bağlantıları yalnızca Development/Staging sunucularında ve salt-okunur DB kullanıcısıyla deneyin. Electron uygulamasını ve Claude Code /
    Codex CLI'ını ajan oturumundan **çalıştırmayın**.

17. **Depo GitHub'da herkese açık** (<https://github.com/godilman/agentbits>, `main`). Commit edilen her şey herkese
    görünür ve geçmişte kalır: sır, kişisel veri/yol, veritabanı, derleme çıktısı (`release/`, `out/`) commit etmeyin;
    commit'ten önce `git status`. Yerel klasörün GitHub'a bağlanması, günlük akış (`pull` → değişiklik → doğrulama →
    `commit` → `push`), sürüm yayınlama (Build packages + `release_tag` → taslak Release) ve **sahibin elle yapacağı açık işler** →
    [docs/DEVELOPMENT.md §9](docs/DEVELOPMENT.md#9-github-deposu-günlük-iş-akışı-ve-sürüm-yayınlama). Sahibe yol gösterirken
    oradaki komutları kullanın; tamamlanan maddeleri oradan işaretleyin.

## Belgeler

| Belge | İçerik |
|---|---|
| [docs/PROJECT.md](docs/PROJECT.md) | Vizyon, hedefler, hedef kullanıcı, UX ilkeleri, Organizasyon sayfası + 8 proje bölümü, sözlük |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Süreç modeli, IPC (yeni metot ekleme), organizasyon/proje çözümü, orkestratör, hafıza, sağlayıcılar, izin → CLI bayrakları, terminal, veri yönetimi, bağlantılar ve güvenlik sınırları (§9b), dosya ekleri (§9c), ofis motoru, renderer durumu |
| [docs/DATABASE.md](docs/DATABASE.md) | Tüm tablolar/sütunlar, FTS5, migration kuralları ve geçmişi, DB dosyasının yeri, yedek / geri yükleme / sıfırlama, anahtar saklama |
| [docs/FEATURES.md](docs/FEATURES.md) | Özellik bazlı durum tablosu (✅ / 🟡 / 🚧 / ⏳ / —), paketleme, kapsam dışı (yapmadıkları, §12), bilinen sorunlar |
| [docs/I18N.md](docs/I18N.md) | Çoklu dil: dil dosyaları, `t()` kullanımı, kurallar, denetim, yeni dil ekleme |
| [docs/SECURITY.md](docs/SECURITY.md) | Güvenlik sınırları, 2026-10-13 incelemesinin 27 bulgusunun durumu, açık kalanlar |
| [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) | Windows kurulumu, komutlar, sorun giderme, güvenli test, kod ve UI kuralları |
| [docs/CHANGELOG.md](docs/CHANGELOG.md) | Tarihli değişiklik geçmişi (en yeni üstte) |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Mimari karar kayıtları (ADR) |
| [docs/UX_REVIEW_2026-10-19.md](docs/UX_REVIEW_2026-10-19.md) | Ürün deneyimi incelemesi (v0.7.1): yolculuklar, öncelikli bulgular (kanıt etiketli), sıralı plan, ilk çalışma paketi, kullanıcı deneme senaryosu; ekran görüntüleri `docs/ux-review-2026-10-19/` |
| [docs/TEST_SCENARIOS_KANBAN.md](docs/TEST_SCENARIOS_KANBAN.md) | Kanban sürükle-bırak elle test senaryoları |
| [docs/RELEASE_TEMPLATE.md](docs/RELEASE_TEMPLATE.md) | Sürüm notu şablonu |
| [README.md](README.md) / [README.tr.md](README.tr.md) | GitHub ürün sayfası (İngilizce / Türkçe, içerik aynı tutulur): tanıtım, kullanım senaryoları, ekran görüntüleri (`docs/screenshots/`, `tr/`), sağlayıcılar, kurulum, sınırlamalar, yol haritası, lisans |
| [LICENSE](LICENSE) | **PolyForm Strict 1.0.0** (kaynağı açık, açık kaynak değil): ticari olmayan kullanım serbest; değişiklik, türev ve yeniden dağıtım yok. Telif: Gökhan Dilman. `package.json` → `"license": "SEE LICENSE IN LICENSE"` |
| [CONTRIBUTING.md](CONTRIBUTING.md) / [SECURITY.md](SECURITY.md) | Katkı koşulları (lisans nedeniyle katkı izni + katkı sözü), güvenlik açığı bildirimi (GitHub özel bildirim). İç güvenlik sınırları ayrı: [docs/SECURITY.md](docs/SECURITY.md) |
| [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) | Pakete giren açık kaynak bağımlılıkların lisans metinleri; bağımlılık değişince yeniden üretin (bkz. DEVELOPMENT §8) |
| [AGENTS.md](AGENTS.md) | Claude dışı ajanlar için yönlendirme (bu dosyaya işaret eder) |

## Belgeleri güncel tutma kuralı (ZORUNLU)

Bu depo başka bilgisayarlarda, önceki konuşmaları bilmeyen ajanlar tarafından da geliştirilir. Tek
bellek bu belgelerdir. Bu yüzden **her değişiklikten sonra**, işi bitti saymadan önce:

1. **`docs/FEATURES.md`** — etkilenen özelliğin durumunu (✅ / 🟡 / 🚧 / ⏳) ve gerekiyorsa "Bilinen
   sorunlar" listesini güncelleyin. Yeni özellik = yeni satır.
2. **`docs/CHANGELOG.md`** — en üste tarihli (`YYYY-MM-DD`) bir kayıt ekleyin: ne değişti, neden,
   hangi dosyalar. En yeni kayıt her zaman en üstte; eski kayıtları silmeyin.
3. **`docs/ARCHITECTURE.md`** — klasör yapısı, süreç/IPC (`Api` metodu, `AppEvent` türü), orkestratör
   akışı, organizasyon/proje çözümü, sağlayıcı veya izin eşlemesi değiştiyse güncelleyin.
4. **`docs/DATABASE.md`** — şema değiştiyse (yeni migration, tablo, sütun, ayar anahtarı) güncelleyin. Yeni
   tablo eklerseniz `maintenance.ts`'teki temizlik/sıfırlama listelerini de gözden geçirin.
5. **`docs/DECISIONS.md`** — kalıcı bir teknik karar aldıysanız yeni ADR ekleyin; eskiyi silmeyin.
6. Bu dosyadaki kurallar/depo haritası artık doğru değilse **CLAUDE.md**'yi de güncelleyin (kısa tutun).

### Bitirme kontrol listesi

- [ ] `npm run typecheck` hatasız
- [ ] `npm run build` hatasız
- [ ] Yeni/değişen her UI metni `en` + `tr` locale dosyalarında (sabit metin yok); `npm run test:unit` hatasız
- [ ] Kod/yorumlar İngilizce
- [ ] Yeni IPC metodu `Api` + `handlers` + gerekiyorsa `AppEvent`/`handleEvent` ile bağlandı
- [ ] Yeni kayıtlar doğru `projectId` ile yazılıyor; görünümler aktif projeye göre süzüyor
- [ ] Şema değiştiyse yeni migration eklendi (eskisi düzenlenmedi)
- [ ] `docs/FEATURES.md` ve `docs/CHANGELOG.md` güncellendi; gerekiyorsa `ARCHITECTURE.md` / `DATABASE.md` / `DECISIONS.md`
