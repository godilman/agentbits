# Agentbits — Geliştirme Rehberi

## 1. Kurulum (Windows)

Gereksinimler:

- **Node.js 22+** (`node --version`). `better-sqlite3` v13 Node 22 ister.
- Windows 10/11 + PowerShell. (macOS / Linux da çalışır.)
- **Visual Studio Build Tools gerekmez** — `better-sqlite3` N-API hazır binary ile gelir (ADR-002).
- İsteğe bağlı: Claude Code CLI (`claude`) ve/veya Codex CLI (`codex`), girişleri yapılmış olarak.

```powershell
git clone https://github.com/godilman/agentbits.git
cd agentbits
npm ci               # Electron (~100 MB), node-pty binary'si (opsiyonel paket), pg / mysql2 / mssql / ssh2,
                     # unpdf / fflate / papaparse indirilir
npm run dev          # electron-vite dev: main/preload yeniden derlenir, renderer HMR
```

## 2. Komutlar

| Komut | Ne yapar |
|---|---|
| `npm run dev` | Geliştirme modu (HMR). Main süreç logları bu terminalde görünür |
| CI | `.github/workflows/ci.yml`: her push / PR'da Windows + Ubuntu'da `npm ci`, typecheck, `test:unit`, build, `npm audit --omit=dev --audit-level=critical`. `release.yml` paketlerle birlikte `SHA256SUMS-*.txt` (commit + karma) yükler |
| `npm run test:unit` | Test dosyaları, `node --experimental-strip-types` ile (framework yok; Node 22.6+): `tests/connections.classify.test.ts` (SQL/SSH sınıflandırma) ve `tests/files.extract.test.ts` (tür tespiti, kodlamalar, CSV, parçalama, DOCX, XLSX tarih/formül, zip bombası, elle yazılmış ve bozuk PDF, talimat sezgiseli). Ayrıca `tests/skills.test.ts` (SKILL.md ön bilgisi, GitHub adresleri), `tests/apps.test.ts` (MCP yapılandırma JSON'u, araç adları, varsayılan politikalar), `tests/review.test.ts` (inceleme kararı), `tests/demo.test.ts` (Demo sağlayıcının iş türü tahmini) ve `tests/i18n.test.ts` (çeviri anahtarları, sabit Türkçe metin). Sınıflandırmaya, `files/extract.ts`'e, `shared/skills.ts`'e ya da `shared/apps.ts`'e dokunduysanız zorunlu |
| `npm run typecheck` | `tsc --noEmit` — önce `tsconfig.node.json` (main/preload/shared), sonra `tsconfig.web.json` (renderer/shared) |
| `npm run build` | `out/main`, `out/preload`, `out/renderer` üretim derlemesi |
| `npm start` | `electron-vite preview` — derlenmiş uygulamayı çalıştırır |
| `npm run dist` / `dist:win` / `dist:mac` | `build` + `electron-builder` → `release/`. Windows: NSIS kurulum `Agentbits-Setup-<sürüm>.exe` (x64). macOS: `Agentbits-<sürüm>-arm64.dmg` / `-x64.dmg` (yalnızca bir Mac'te ya da GitHub Actions'ta derlenir). Hepsi `--publish never`. İmza ve noterlik ortam değişkenleriyle açılır → §8 "Dağıtım paketleri". `asarUnpack`: `better-sqlite3`, `@lydell/node-pty*`, `out/main/mcp-connections.js`, `out/main/files-worker.js`, `out/main/chunks/**` (worker ve MCP sunucusu asar dışından yüklenir; Linux unpacked paketle doğrulandı) |

Her değişiklikten sonra **`npm run typecheck` ve `npm run build`** hatasız geçmelidir. Tek otomatik test `npm run test:unit`'tir
(bağlantı sınıflandırması + dosya çıkarma); lint ve UI/entegrasyon testi yoktur.

> **Faz 1 sonrası (2026-10-13):** `@lydell/node-pty` eklendi — çekip güncelledikten sonra **`npm install`** çalıştırın.
> Derleme gerekmez; `--no-optional` / `--omit=optional` kullanmayın (platform binary'si opsiyonel pakettir). Yüklenemezse
> Kabuklar "Pipe modu" rozetiyle çalışır; main süreç konsolunda `node-pty unavailable` uyarısı çıkar. `electron-rebuild`
> çalıştırmayın. DB açılışta otomatik v5'e yükselir (`agent_logs` yeniden kurulur, id'ler korunur).

> **Faz 2 sonrası (2026-10-13):** bağlantı sürücüleri (`pg`, `mysql2`, `mssql`, `ssh2`; saf JS) eklendi — çekip
> güncelledikten sonra **`npm install`**. `ssh2`'nin opsiyonel native kripto eklentisi Build Tools yoksa derleme
> uyarısı basabilir; yok sayın (saf JS'e düşer). DB açılışta v6'ya yükselir. Claude Code'un bağlantı araçları için
> `npm run build` / `npm run dev` ayrıca `out/main/mcp-connections.js`'i üretir (ayrı electron-vite girdisi).
>
> **Faz 3 sonrası (2026-10-13):** dosya çıkarma kütüphaneleri `unpdf` (PDF.js), `fflate` (ZIP), `papaparse` (CSV) eklendi —
> **`npm install`**. Bunlar `externalizeDepsPlugin({ exclude: ['unpdf','fflate','papaparse'] })` ile **worker'a paketlenir**;
> üçüncü main girdisi `files-worker` → `out/main/files-worker.js` (+ `out/main/chunks/pdfjs-*.js`). Çıkarma ana süreçte değil
> bu worker'da çalışır (768 MB, 120 sn, en fazla 2 paralel); worker sorunlarında main süreç konsoluna bakın. DB açılışta
> v7'ye yükselir; dosya orijinalleri `<veri klasörü>/files/` altında.

## 3. Sorun giderme

### Electron binary eksik ("Electron failed to install correctly", uygulama açılmıyor)
`npm install` sırasında Electron indirmesi yarıda kalmış olabilir (sahibin makinesinde yaşandı):

```powershell
node node_modules\electron\install.js
```

İndirme engelleniyor/yavaşsa bir ayna kullanın:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
node node_modules\electron\install.js
```

Kontrol: `node_modules\electron\dist\electron.exe` var olmalı.

### Pencere siyah kalıyor, terminalde `ERR_CONNECTION_TIMED_OUT` (localhost:5173)

Electron, Vite geliştirme sunucusuna bağlanamıyor. Sunucu `127.0.0.1:5173`'e sabitlendi ve main süreç
15 kez yeniden dener; olmazsa pencerede sorun giderme sayfası çıkar. Hâlâ oluyorsa: `npm run dev`'i yeniden
başlatın, ayrı bir PowerShell'de `curl.exe -I http://127.0.0.1:5173` deneyin, antivirüs/güvenlik duvarının
Node.js'i engellemediğini kontrol edin; geçici çözüm `npm run build` + `npm start`.

### PowerShell "running scripts is disabled on this system"
`npm` / `npx` PowerShell betik shim'leri yürütme ilkesine takılabilir:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
# veya ilkeyi değiştirmeden: npm.cmd run dev
```

(Uygulamanın kendi Terminal sekmesi PowerShell'i `-ExecutionPolicy Bypass` ile açar; bu ayar onu etkilemez.)

### Claude Code oturumu süresi doldu / API anahtarı geçersiz
Belirti: `#general`'de "🔑 Claude Code oturumunun süresi dolmuş…" mesajı, tüm ekip duraklatılmış, ajanlar
`error`. Çözüm:

```powershell
claude auth login      # Codex için: codex login
```

Sonra Ayarlar → Sağlayıcılar → **Test et** (Claude için `claude auth status` kontrol edilir) ve üst bardaki
**"Devam et"** (hata durumlarını sıfırlar, ekibi yeniden başlatır). API sağlayıcılarında anahtarı yeniden
girin (aynı sağlayıcıyı silip ekleyin).

### `better-sqlite3` modül/ABI hatası
`electron-rebuild` çalıştırmayın. `node_modules`'u silip `npm install` yapın; Node 22+ kullandığınızdan emin olun.

### Ekran kararıyor / görünüm çöktü
Bir sekme hata verirse `ErrorBoundary` mesajı gösterir. DevTools konsoluna bakın (varsayılan Electron menüsü
gizli ama duruyor; `Ctrl+Shift+I` genelde DevTools'u açar). Sonsuz render döngüsü şüphesinde önce Zustand
seçicilerinde yeni dizi/nesne üretimi arayın (bkz. §5).

## 4. Güvenli test

1. **Ayrı veri klasörü** kullanın; gerçek DB'nize dokunmaz, her seferinde boş bir ilk kurulum verir (ajan yok; Organizasyon → Şablonlar → "Çekirdek Ekip" ile hızlıca ekip kurulur):
   ```powershell
   $env:AGENTBITS_DATA_DIR = "$env:TEMP\agentbits-test"; npm run dev
   ```
   Sıfırlamak için uygulama kapalıyken o klasörü silin.
   Farklı veri klasörü = ayrı bir uygulama örneği (kendi Chromium profili `<veri>/electron` ve kilidi); aynı veri klasörüyle
   ikinci kez açmak yalnızca mevcut pencereyi öne getirir.
   Anahtar zinciri olmayan ortamlarda (Linux kapsayıcı / CI) sır kaydı reddedilir; yalnızca testler için
   `AGENTBITS_ALLOW_PLAIN_SECRETS=1` eski base64 saklamaya izin verir — gerçek anahtarlarla kullanmayın.
2. **Demo (simülasyon) sağlayıcısı** ile başlayın (Organizasyon → Ajanlar'da yetenekli bir ajan oluşturup lidere
   uygun bir iş tarif ederek yeteneğe göre atamayı da deneyebilirsiniz): anahtar gerekmez, dosyaya dokunmaz; ofis, Kanban,
   sohbet, onay ve inceleme akışlarını uçtan uca gösterir. (Tüm şablon ajanlarında "Onay iste" açık — onay
   kartını test etmek için ideal.)
3. CLI sağlayıcılarıyla gerçek test için **boş bir klasör** ya da git ile takip edilen tek kullanımlık bir
   depo/dal seçin.
4. **Agentbits deposunun kendisini asla bir projenin klasörü yapmayın** (proje ayarları → Klasör; varsayılan
   proje için Onboarding). v4'ten beri `projects:save` bunu reddeder (`core/folders.ts` → `isAppFolder`), ama
   eski kayıtlarda klasör değişmedikçe doğrulama çalışmaz — mevcut projelerin klasörünü kontrol edin. Ajanlar kaynak kodu gerçekten değiştirir; bu yüzden sahte giriş ekranı, sayfalama,
   paketleme yapılandırması, kontrast değişiklikleri gibi istenmemiş değişiklikler depoya girdi
   (bkz. [CHANGELOG.md](CHANGELOG.md), TA-1…TA-5).
5. **Organizasyon ve projeleri test etmek** (Demo sağlayıcıyla, ayrı `AGENTBITS_DATA_DIR`'de):
   - İlk açılışta yalnızca "Organizasyon" kökü ve tek boş proje (Onboarding'de verilen adla) olmalı; ajan, takım, görev yok;
     Kılavuz açık ve 1–8 adımları işaretsiz. "Çekirdek Ekip" şablonu kurulunca Atlas, Nehir, Zeki, Zeynep, Kaan gelmeli.
   - Organizasyon (`Ctrl+O`) → Şablonlar → ör. "E-ticaret Şirketi"ni kur; Şema'da şirket + 5 takım görünmeli.
   - Üst bardaki "+" ile yeni proje aç, klasörü **boş bir test klasörü** seç, şablondan gelen birimi işaretle
     (alt takımlar "dahil" görünür), lideri otomatik bırak. Projenin Chat'inde lidere (ör. Kaya) birkaç parçalı
     bir iş tarif et: görevler yalnızca o projenin üyelerine atanmalı.
   - Şablon ajanlarında "Onay iste" açıktır — sol paneldeki onay kartlarını onaylayın.
   - Proje sekmeleri arasında geçin (`Ctrl+Tab`): görevler, sohbet, kararlar, raporlar ve Office ekibi projeye göre
     değişmeli; başka projede çalışan ajan soluk ve "· başka projede" görünmeli.
   - Açılış seçicisini test edin: uygulamayı kapatıp açın → "Hangi projeleri açalım?" çıkmalı, son oturumun
     sekmeleri işaretli olmalı; bir projenin klasörünü diskte yeniden adlandırıp tekrar açın → "klasör bulunamadı"
     rozeti, ön seçim yok. "Klasör aç…" ile bu deponun klasörünü seçin → reddedilmeli. Tüm sekmeleri kapatın →
     "Açık proje yok" ekranı. `Ctrl+P` seçiciyi açmalı (terminal odaktayken açmamalı).
   - Eski bir DB ile v2→v3 geçişini denemek için eski veri klasörünün **kopyasını** `AGENTBITS_DATA_DIR` ile açın;
     eski görevler "Varsayılan Proje"de görünmeli.
6. **Veri yönetimini (temizlik / yedek / geri yükleme / sıfırlama) yalnızca test veri klasöründe deneyin:**
   `$env:AGENTBITS_DATA_DIR = "$env:TEMP\agentbits-test"; npm run dev`. Yedekler `$env:TEMP\agentbits-test\backups\`
   altına yazılır. Geri yükleme uygulamayı `app.relaunch()` ile yeniden başlatır — `npm run dev` altında yeni süreç
   aynı ortam değişkeniyle açılır ama geliştirme sunucusuna bağlanamayabilir; o durumda uygulamayı elle yeniden
   başlatın (aynı `AGENTBITS_DATA_DIR` ile). "Her şeyi sıfırla" kayıtlı API anahtarlarını da siler; gerçek
   veri klasörünüzde denemeden önce Ayarlar → Veri yönetimi → yedek alın.
7. Önce izinleri kısıtlayın (Ayarlar → İzin Matrisi): terminal/ağ kapalı, "Onay iste" açık.
8. **Ajan terminalleri ve talimatları test etmek** (Demo sağlayıcı, test veri klasörü):
   - Terminal → "Ajan terminalleri": her üye için bölme; bir görev başlatın → bölmede `📨 <lider> → <ajan>` satırı,
     "Gönderilen tam prompt" açılmalı, token şeridi artmalı.
   - Çalışırken "Yönlendir" ve "Sıraya al" deneyin; `↪` durum satırları, görev kanalında kullanıcı mesajı ve `#general`'de
     sistem notu çıkmalı. Boştaki ajana "Görev ver" → yeni görev başlamalı. İki pencereden/hızla iki talimat → sırayla
     uygulanmalı; ajan çalışmayı bitirdikten sonra eski bölmeden gönderilen talimat reddedilmeli.
   - Durdur → görev "Yapılacak"a döner, bekleyen talimatlar iptal. Uygulamayı yeniden açın → transkript kalıcı,
     `queued` talimatlar iptal.
   - Reports → Token kullanımı: Bu proje / Tüm projeler; Demo değerleri "tahmini" etiketli olmalı.
   - Kabuklar: `vim`/`htop` gibi tam ekran uygulama ve `Ctrl+C` çalışmalı (PTY); rozet "Pipe modu" ise node-pty
     yüklenememiştir.
   - Gerçek Claude Code ile `--resume` akışı henüz uçtan uca test edilmedi; denerken boş bir test klasörü kullanın.
9. **Bağlantıları güvenle test etmek:**
   - **Asla önce Production ile başlamayın.** Development/Staging bir sunucu ya da yerel bir test veritabanı
     (ör. Docker'da PostgreSQL/MySQL) kullanın; ayrı `AGENTBITS_DATA_DIR`.
   - DB için yalnızca SELECT yetkili bir kullanıcı oluşturup "salt-okunur giriş" alanına girin; ana kullanıcıya
     yazma yetkisi gerekmiyorsa onu da kısıtlayın. SSH için ayrı, yetkisi kısıtlı bir OS kullanıcısı kullanın.
   - "Test" → sunucu sürümü / SSH parmak izi (TOFU) görünmeli. Şema panelini yenileyin.
   - Ajan erişimi: önce tek bir ajana `read` verin. Demo sağlayıcıyla "satış tablosundaki son kayıtları özetle" gibi
     bir görev → transkriptte 🔌 satırları, Denetim'de `ok` kayıtları. İzinsiz bir ajanla aynı görev → bağlantı
     prompt'ta görünmemeli; araç denemesi `denied` olarak düşmeli.
   - Production davranışını test etmek için bir **test** bağlantısının ortamını Production yapın ve `write` verin:
     sol altta onay kutusu çıkmalı; Reddet / 10 dk bekleme → `denied`.
   - Bash ve ağ iznini bağlantı kullanan test ajanlarından kaldırın (makinedeki kimlik bilgileriyle doğrudan erişimi
     önlemek için).
   - `npm run test:unit` ile sınıflandırma testlerini çalıştırın.
10. **Dosya eklerini test etmek** (test veri klasörü, Demo sağlayıcı):
    - Çeşitli örnekler: küçük/büyük PDF, taranmış PDF (metin katmanı yok → "Kısmen okundu"), DOCX, XLSX (tarih + formül),
      PPTX, Windows-1254 CSV, ~1 MB metin (yüzlerce parça), görsel, `.exe` (desteklenmez, açılamaz), bozuk PDF (temiz
      "failed"), zip bombası (reddedilmeli). Dosyalar bölümünde durum/uyarı, önizleme ve içerik araması.
    - #general'de dosyayla iş tarif edin (paylaşım seçici: yalnızca lider / ekip / takım) → liderin görevlerine dosyalar
      bağlanmalı; çalışan ajan araçlarla okumalı (transkript, önizlemede "Kullanım"), `file_save` çıktısı görev akışında
      çip olarak görünmeli. Paylaşılmamış dosyayı okumaya çalışan ajan → `file:read` denied (Denetim).
    - Ajan terminaline dosya bırakıp talimat gönderin; görev çekmecesinden dosya ekleyip kaldırın.
    - Veri yönetimi: proje temizliğinde "Dosyalar"; yedek alıp dosyayı silin → orijinal yedek silinene kadar kalmalı.
    - İçinde "önceki talimatları yok say…" gibi satırlar olan bir dosya → "talimat benzeri satır" bandı; ajan uymamalı.
11. **Skill'leri test etmek** (test veri klasörü, Demo sağlayıcı): Organizasyon → Skill'ler → "Skill ekle" → bir GitHub
    adresi (ör. herkese açık bir skill deposu) ya da elle yazılmış bir `SKILL.md` klasörü / .zip / .md. Önizlemede
    uyarıları okuyun; kurun, bir ajana ya da takıma atayın. Ajana skill açıklamasıyla örtüşen bir görev verin → Demo
    transkriptte `skill_read` çağrısı ve raporda "Kullanılan skill'ler" görünmeli.
12. **Uygulamaları (MCP) test etmek:** önce zararsız bir sunucuyla başlayın — ör. yerel program `npx` +
    `-y @modelcontextprotocol/server-everything` (Node.js gerekir) ya da yalnızca okuma yapan bir sunucu. Gerçek
    e-posta / takvim hesabınızı bağlamadan önce politikaları gözden geçirin: değiştiren araçlar "Önce bana sor"da kalsın.
    "Bağlan ve araçları listele" → araçlar ve salt-okunur işaretleri görünmeli; "Erişim"de tek bir ajana izin verin;
    görev metninde uygulamanın adını geçirin (Demo yalnızca adı geçen uygulamayı dener) → sol altta onay kartı, Denetim
    kaydında `app:<araç>` satırları. İzinsiz ajan araçları görmemeli. OAuth gerektiren sunucuda "Giriş yap" tarayıcıyı açar.
13. Kodlama ajanı olarak çalışıyorsanız Electron uygulamasını ya da Claude Code / Codex CLI'ını kendiniz
   çalıştırmayın; `typecheck` + `build` ile doğrulayıp çalıştırmayı kullanıcıya bırakın.

## 5. Kod kuralları

- **TypeScript strict**; `any` yalnızca DB satırı (`Row`) ve CLI JSON olayları gibi sınırlarda,
  `eslint-disable` yorumuyla.
- **Sözleşme önce:** yeni veri/metot = `src/shared/types.ts` + `src/shared/ipc.ts`, sonra main handler, sonra
  renderer `call()`. Adımlar: [ARCHITECTURE.md §4.3](ARCHITECTURE.md#43-yeni-bir-ipc-metodu-eklemek-uçtan-uca).
- Veriyi değiştiren her main handler uygun `emit({ type: '…:changed' })` olayını yayınlar.
- **Proje kapsamı:** projeye ait her yeni kayıt (`tasks`, `runs`, `messages`, `decisions`, `reports`, proje
  hafızası) `projectId` ile yazılır; renderer'da aktif proje için `useProjectScope()` (`lib/org.ts`) kullanın,
  kanal önbelleği için `channelKey(projectId, channel)`. Üyelik/lider çözümünü yeniden yazmayın —
  `@shared/org` (`projectMemberIds`…) ve `resolveProjectLead` / main'de `projectMembers` / `projectLead`.
- **Ajan transkripti ve token:** ajanla ilgili her olayı `logsRepo.add({ agentId, runId?, taskId?, projectId, level,
  message, meta? })` ile yazın (orkestratörde `this.log`); ajana giden prompt'lar `level: 'prompt'` + `meta.prompt` /
  `meta.system`. Yeni bir sağlayıcı adaptörü token'ları `ctx.onUsage` ile bildirmeli ve `usageReportingFor()`'a eklenmeli;
  talimat davranışı `steeringFor()`'da dürüstçe tanımlanmalı.
- **Eski veriyi taşımak** gerekiyorsa migration SQL'ine iş mantığı koymayın; `ensureOrgDefaults()` gibi
  idempotent bir açılış adımı yazın.
- Main'de doğrulama hatası fırlatmak için çevrilmiş mesajlı `Error` kullanın (`throw new Error(t('main:errors.…'))`); renderer'da `try/catch` + `apiError(e)`
  (`@/lib/api`) ile toast'a verin (ör. "Bu isimde bir ajan zaten var: …").
- **Zustand:** seçicide yeni dizi/nesne üretmeyin:
  ```ts
  // YANLIŞ — her render'da yeni dizi → sonsuz döngü
  const workers = useAppStore((s) => s.agents.filter((a) => !a.isLead))
  // DOĞRU
  const agents = useAppStore((s) => s.agents)
  const workers = useMemo(() => agents.filter((a) => !a.isLead), [agents])
  ```
  İlkel döndürmek (`s.tasks.filter(...).length`) ya da mevcut nesneyi `find` ile seçmek güvenlidir.
- **StrictMode:** effect'ler dev'de iki kez çalışır; abonelikleri temizleyin, tek seferlik başlatmaları
  bayrakla koruyun, gelen olayları `id` ile tekilleştirin.
- **DB:** sütunlar `snake_case`, tipler `camelCase`; dönüşüm `repos.ts`'deki `mapX` fonksiyonlarında.
  Yazmalar çoklu adımlıysa `db.transaction(...)()`. Şema değişikliği = yeni migration ([DATABASE.md](DATABASE.md)).
- **Güvenlik:** API anahtarı renderer'a gitmez; Claude Code'da dosya araçlarını `--allowedTools`'a eklemeyin;
  uzun metni CLI'a komut satırından değil stdin'den verin.
- Yeni native bağımlılık (node-pty vb.) eklemeyin; gerekiyorsa önce ADR yazın.
- **Dil:** kod, tanımlayıcılar ve yorumlar İngilizce; kullanıcıya görünen her metin (UI, toast, sohbetteki
  sistem mesajları, hata açıklamaları) **çeviri dosyalarından** gelir: `src/shared/locales/en/` + `tr/`, aynı anahtar,
  kodda `t('bölüm:anahtar')`. Sabit metin yazmayın; `npm run test:unit` yakalar. Ayrıntı: [I18N.md](I18N.md). Ajan
  prompt'ları İngilizcedir, ama ajanlardan kullanıcının diliyle cevap vermeleri istenir.
- Tarih/sayı biçimi seçili dile göre: renderer `locale()` (`@/i18n`), main `intlLocale(currentLanguage())`;
  `lib/format.ts` → `clock`, `timeAgo`, `ago`, `duration`, `compact`. `'tr-TR'` sabit yazmayın.
- Biçim: 2 boşluk girinti, noktalı virgülsüz, tek tırnak (mevcut kodla aynı).

## 6. UI kuralları

- **Renkler / tema** (`tailwind.config.js`): `bg-canvas`, `bg-surface`, `bg-surface-2/3`, `border-line`,
  `border-line-soft`, `bg-accent` / `text-accent-soft`; ek olarak Tailwind `zinc-*` tonları ve durum renkleri
  (emerald / amber / rose / violet / indigo). Fontlar: `font-sans` (Inter), `font-mono` (JetBrains Mono),
  `font-pixel`. Animasyonlar: `animate-fade-in`, `animate-slide-in`, `animate-shimmer`; gölge `shadow-pop`.
- **Bileşen sınıfları** (`src/renderer/src/index.css`, `@layer components`):
  `btn`, `btn-primary`, `btn-ghost`, `btn-outline`, `btn-danger`, `icon-btn`, `input`, `textarea`, `label`,
  `panel-title`, `card`, `kbd`; Markdown için `prose-dark`; `pixelated`, `selectable` (metin seçilebilir —
  gövdede `user-select: none`), `drag` / `no-drag` (pencere sürükleme bölgesi).
- **Ortak bileşenler** (`src/renderer/src/components/common/`):
  - `PixelAvatar` — ajanın piksel portresi (ofisle aynı sprite verisi), `showStatus` ile durum noktası.
  - `ui.tsx` — `ProgressBar` (tone: emerald/indigo/violet/amber), `Toggle`, `Modal` (Esc ile kapanır,
    `footer`), `Empty` (boş durum), `Badge`, `Segmented` (sekmeli seçim).
  - `ErrorBoundary` — görünüm hatalarını yakalar.
- **Yardımcılar** (`lib/format.ts`): `cn()`, `STATUS_META` (ajan durum etiketi/renk), `PRIORITY_META`,
  `TASK_COLUMNS`. Markdown için `lib/markdown.tsx` → `<Markdown text=… />` (ham HTML üretmez).
- İkonlar yalnızca `lucide-react`'ten; genelde 11–15 px.
- **Kontrast (WCAG AA, TA-5):** koyu zeminde okunacak metin en az `text-zinc-400` kadar açık olmalı (`zinc-500/600` yalnızca dekoratif öğe veya debug log); `btn-primary` `bg-indigo-600` (beyaz metinle ≥4.5:1).
- Yazı boyutları küçük ve yoğun: gövde 13 px, ikincil 11–12.5 px.
- Yeni proje bölümü eklemek: `Tab` tipi (`useAppStore.ts`) + `TABS` (`TopBar.tsx` alt satırı, kısayol tuşu — bugün `1…9`) + `App.tsx`'te `view === 'project'` altında render. Organizasyon sayfasına sekme: `OrgTab` + `OrgView` `TABS`.
- İzin anahtarlarının etiket/ipucu listesi tek yerde: `PERMISSIONS` (`features/agents/constants.ts`); hem Organizasyon → Ajanlar
  editörü hem Ayarlar → İzin Matrisi kullanır. Yeni izin eklenirse burayı güncelleyin.
- Form parçaları (`Section`, `Field`, `Swatches`, `TagInput`, `useSavedFlash`) `features/agents/parts.tsx`'tedir; organizasyon ve proje ekranları da bunları kullanır. Birim türü etiket/ikonları `features/org/meta.ts` → `KIND_META`.
  Durum korunması gereken görünümler `hidden` ile monte tutulur.
- Arayüz metinleri kısa; Türkçe arayüzde proje bölüm adları (Chat, Office, Terminal…; istisna: **Ekip**) ve Kanban sütun adları (To do / In progress…) İngilizce kalır.

## 7. Dizinler ve dosyalar

- `out/` — `npm run build` çıktısı; `release/` — `npm run dist` çıktısı. İkisi de gitignore'da.
- Kalıcı veri kod deposunda değil, kullanıcı veri klasöründedir ([DATABASE.md](DATABASE.md)).
- Belgeler `docs/` altında; değişiklik sonrası güncelleme kuralı [../CLAUDE.md](../CLAUDE.md)'de.

## 8. Dağıtım paketleri (Windows / macOS)

**Nerede derlenir:** Windows paketi Windows'ta (`npm run dist:win`). macOS paketi **yalnızca macOS'ta** derlenebilir
(DMG, imza ve noterlik Apple araçları ister); Mac yoksa `.github/workflows/release.yml` GitHub Actions'ta ikisini de derler:
Actions → "Build packages" → *Run workflow* (`release_tag` verilirse taslak GitHub Release oluşur; etiket tetikleyicisi yok).
Sürüm numarası `package.json` → `version`.

**Lisans dosyaları:** paket `LICENSE`'ı (`resources/LICENSE.txt`, kurulum sihirbazında da gösterilir) ve
`THIRD_PARTY_NOTICES.md`'yi (`resources/`) taşır. Bağımlılık eklediğinizde/güncellediğinizde `npm run notices` ile
`THIRD_PARTY_NOTICES.md`'yi yeniden üretin (yalnızca izin verici lisanslar beklenir; GPL/LGPL gibi bir lisans çıkarsa
önce sahibe sorun).

**Mimari:** Windows x64; macOS Apple Silicon (arm64) ve Intel (x64) ayrı paketler. Yerel modüller hazır gelir:
`better-sqlite3` tüm platform binary'lerini taşır; `@lydell/node-pty` npm'de yalnızca derleyen makinenin CPU'su için
kurulur — CI, Intel paketi için `@lydell/node-pty-darwin-x64`'ü ayrıca kurar.

**İmzasız paketler** (hiç ayar yapmadan) çalışır ama uyarı verir:
- Windows: SmartScreen "Windows bilgisayarınızı korudu" → *Ek bilgi* → *Yine de çalıştır*.
- macOS: ad-hoc imzalı (Apple Silicon'da açılabilmesi için gerekli) ama noterlik yok → ilk açılışta uyarı;
  *Sistem Ayarları → Gizlilik ve Güvenlik → Yine de Aç* (Sequoia'dan beri sağ tık → Aç atlatması yok).

**İmzalı paketler için gerekenler**
| | Gerekli | Ortam değişkeni / GitHub secret |
|---|---|---|
| macOS imza | Apple Developer Program üyeliği + "Developer ID Application" sertifikası (.p12) | `CSC_LINK` (dosya yolu ya da base64), `CSC_KEY_PASSWORD` · CI: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD` |
| macOS noterlik | App Store Connect API anahtarı (.p8) — ya da Apple ID + uygulamaya özel parola + Team ID | `APPLE_API_KEY` (dosya yolu), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` · CI: `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` |
| Windows imza | OV kod imzalama sertifikası (sertifika deposunda) ya da dışa aktarılabilir .pfx | `WIN_CERT_SUBJECT` (signtool, yerel) ya da `CSC_LINK` + `CSC_KEY_PASSWORD` · CI: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

Notlar: imzalı Windows paketleri de SmartScreen itibarı biriktirene kadar uyarı alabilir (EV sertifikasının anında
güven ayrıcalığı 2024'te kalktı). Bugünkü OV sertifikaların çoğu anahtarı donanımda / bulutta tutar (dışa aktarılamaz);
bulut imza hizmeti kullanılırsa electron-builder'a `win.signtoolOptions.sign` ile özel imza betiği eklenmelidir.
macOS ayarları: `hardenedRuntime`, `build-resources/entitlements.mac.plist` (JIT + kütüphane doğrulaması kapalı — yerel
modüller için), simge `build-resources/icon.icns` (`icon.png`'den üretildi). Sertifika yoksa `identity: '-'` (ad-hoc),
noterlik yalnızca sertifika **ve** Apple kimlik bilgileri varken çalışır.

**Sürüm çıkarma ve güncelleme:** her sürümde `package.json` → `version`'ı artırın, `npm run dist:win` ile
`release\Agentbits-Setup-<sürüm>.exe`'yi üretin, notları `docs/RELEASE_TEMPLATE.md` ile yazın. Kullanıcı yeni exe'yi
çalıştırınca sabit `appId` sayesinde eski sürüm yerinde değiştirilir (önce kaldırmak gerekmez); kurulumda her seferinde
aynı kapsam ("benim için" / "herkes") seçilmelidir. `%APPDATA%\Agentbits` (DB, yedekler, dosyalar) güncellemede ve
kaldırmada korunur (`deleteAppDataOnUninstall: false`); şema açılışta migrate edilir. Özel NSIS betiği yoktur
(`installer.nsh` kaldırıldı); tüm ayarlar `electron-builder.config.js` → `nsis`'tedir.

**Bilinen:** macOS paketi bu depoda henüz bir Mac'te / CI'da derlenip denenmedi; ilk derlemeden sonra açılış, terminal
(node-pty), SQLite ve dosya çıkarma (worker) kontrol edilmeli. Otomatik güncelleme yok: `publish: null`, `nsis.differentialPackage: false`, `dmg.writeUpdateInfo: false` → yalnızca
kurulum dosyaları üretilir (`latest*.yml` / `.blockmap` yok). `publish` kaldırılırsa electron-builder `package.json` →
`repository`'den GitHub yapılandırmasını kendisi türetip `latest.yml` yazar; bu yüzden açıkça `null`'dır.


## 9. GitHub deposu, günlük iş akışı ve sürüm yayınlama

**Depo:** <https://github.com/godilman/agentbits> — **herkese açık (Public)**, varsayılan dal `main`, lisans PolyForm Strict
1.0.0. İlk yayın 2026-10-13. Commit yazar e-postası `godilman@users.noreply.github.com` (GitHub'ın gizli adresi; kişisel
e-posta herkese açık geçmişe girmesin diye — bu adrese mail gitmez, yalnızca commit'i hesaba bağlar).

**Repoya hiçbir zaman girmemesi gerekenler** (`.gitignore` bunları dışarıda tutar, yine de commit'ten önce
`git status` ile bakın): `node_modules/`, `out/`, `release/` (derleme çıktısı; kurulum dosyaları git'e değil GitHub
**Releases**'e konur — GitHub 100 MB üstü dosyayı reddeder, git geçmişi de sonsuza kadar şişer), veritabanı / yedek
dosyaları (`*.db`, `*.sqlite*`), `.env*`, anahtar ve sertifikalar, loglar. Ekran görüntülerinde gerçek veri, API anahtarı,
kişisel yol görünmemeli (Demo + ayrı `AGENTBITS_DATA_DIR` ile çekin; README görselleri `docs/screenshots/` ve `tr/`).

### 9.1 Yerel klasörü GitHub'a bağlamak (bir kez)

Sahibin yerel klasörü ilk yayından önce git deposu değildi; içerik GitHub'dakiyle aynıdır (yalnızca `.github/` eksik
olabilir ve ekran görüntüleri baytça farklı, piksel olarak aynı olabilir). Bağlamak için klasörde PowerShell
(Git for Windows kurulu olmalı: `git --version`):

```powershell
git init -b main
git remote add origin https://github.com/godilman/agentbits.git
git fetch origin
git reset origin/main                      # dosyalara dokunmaz, yalnızca git'e "şu an origin/main'deyiz" der
git checkout -- .github docs/screenshots   # eksik .github klasörünü ve görselleri GitHub'daki haliyle getirir
git config user.name "Gökhan Dilman"
git config user.email "godilman@users.noreply.github.com"
git status                                 # "nothing to commit, working tree clean" görmelisiniz
```

`git status` başka değişiklik gösterirse bunlar yerelde yapılmış ve henüz GitHub'a gitmemiş değişikliklerdir; körlemesine
silmeyin, inceleyip commit edin.

### 9.2 Günlük iş akışı

```powershell
git pull                                   # başka bir yerde (ör. bir ajan oturumunda) yapılan değişiklikleri al
# … değişiklik …
npm run typecheck; npm run test:unit; npm run build
git status                                 # yalnızca beklenen dosyalar mı?
git add -A
git commit -m "Kısa açıklama"
git push                                   # ilk seferde tarayıcıda GitHub girişi ister (Git Credential Manager)
```

Her push'ta **CI** (`.github/workflows/ci.yml`) Windows + Ubuntu'da `npm ci`, typecheck, `test:unit`, build ve
`npm audit --omit=dev --audit-level=critical` çalıştırır; sonuç repo sayfasındaki CI rozetinde ve Actions sekmesinde.
Satır sonları `.gitattributes` ile her yerde LF'dir (Windows'ta CRLF'ye dönüşen dosyalar `tests/i18n.test.ts`'i
bozuyordu).

### 9.3 Sürüm yayınlama (GitHub Releases)

Kurulum dosyasını kendi bilgisayarınızda derlemeniz **gerekmez**; GitHub Actions temiz kurulumla (`npm ci`) derler:

1. `package.json` → `version`'ı artırın (ör. `0.1.1`), `docs/CHANGELOG.md`'ye yazın, commit + push.
2. Taslak sürümü başlatın: Actions → **Build packages** → *Run workflow* → `release_tag` kutusuna `v0.1.1` yazın →
   *Run workflow*. İş akışı (`release.yml`) Windows + macOS paketlerini ve `SHA256SUMS-*.txt`'yi derleyip **taslak** bir
   Release'e ekler (yalnızca sahip görür). Etiket, taslak yayımlanınca derlenen commit'te oluşur — **elle etiket
   göndermeyin**: iş akışında bilinçli olarak etiket tetikleyicisi yok (v0.1.0 yayımlanınca etiket tetikleyicisi her şeyi
   yeniden derleyip zaten var olan Release yüzünden düşmüştü). Ajan oturumları da iş akışını `release_tag` ile başlatabilir
   (`gh api -X POST repos/godilman/agentbits/actions/workflows/release.yml/dispatches -f ref=main -f 'inputs[release_tag]=v0.1.1'`);
   etiket gönderemez, Release düzenleyemez / yayımlayamaz.
3. Taslaktaki exe'yi indirip kurun, açılışı deneyin; notları yazın (v0.1.0'ın İngilizce notları örnek alınabilir) ve
   **Publish** deyin. README'ler `releases/latest`'e bağlıdır; sürüm numarası geçmediği için her sürümde değiştirmek gerekmez.

macOS paketi henüz doğrulanmadı: macOS işi düşse de Windows paketi başarılıysa taslak Release yine oluşur (yalnızca
Windows dosyalarıyla). İlk çalıştırmada macOS, boş `CSC_LINK` yüzünden ("<repo> not a file") düşüyordu; düzeltildi
(imza secret'ları yalnızca tanımlıysa dışa aktarılır, yapılandırma boş değişkenleri yok sayar).

Yalnızca denemek için: Actions → **Build packages** → *Run workflow*, `release_tag` boş (Release oluşturmaz; dosyalar çalışmanın
"Artifacts" bölümünde). Yerelde derlenecekse önce **`npm ci`** (eski `node_modules` eski bağımlılıklarla paketler — 2026-10-13'te
bu yüzden eski MCP SDK 1.30.1 pakete giriyordu), sonra `npm run dist:win`.

### 9.4 Sahibin GitHub'da elle yapması gerekenler

Ajan oturumları repo **ayarlarını** değiştiremez, Release düzenleyemez, etiket gönderemez (yalnızca kod gönderir ve iş
akışı başlatır). Durum (2026-10-14):

- [x] Private vulnerability reporting açık.
- [x] Topics eklendi.
- [x] **v0.1.0 yayımlandı** (2026-10-14; Windows exe + macOS DMG/ZIP + SHA256SUMS; paketler commit `61eb389`'den). README'ler
  `releases/latest`'e bağlandı.
- [x] Yerel klasör git'e bağlandı (`origin` = GitHub, `user.email` = noreply adresi).
- [ ] GitHub → Settings → Emails → **Keep my email addresses private** ve **Block command line pushes that expose my
  email** açılmalı: 2026-10-14'te web arayüzünden yapılan iki README commit'i kişisel Gmail ile yazıldı (geçmişte kalır;
  adres zaten `FEEDBACK_EMAIL`'de herkese açık olduğundan geçmişi yeniden yazmaya gerek görülmedi).
- [ ] (İsteğe bağlı) Uygulamadaki geri bildirim adresi (`src/shared/support.ts` → `FEEDBACK_EMAIL`) kişisel Gmail'dir;
  ayrı bir destek adresi düşünülebilir.
- [ ] Bilgisayardaki eski `release\Agentbits-Setup-0.1.0.exe` (SDK 1.30.1 içerir) silinebilir; kullanılmamalı.

Bunlar yapıldıkça bu listeyi güncelleyin.
