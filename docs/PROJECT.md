# Agentbits — Proje Tanımı

## 1. Vizyon

Agentbits, birden fazla yapay zeka ajanının **pikselli bir 2D sanal ofiste** birlikte çalıştığı bir
masaüstü uygulamasıdır. Kullanıcı bir "yapay zeka ekibini" — hatta birkaç takımlı bir şirketi — yönetir. Ekibin işi
yalnızca yazılım değildir: araştırma, veri analizi, raporlama, doküman, içerik, planlama, sunucu ve veritabanı
işleri de olabilir. Kullanıcı lidere iş tarif eder, lider işi
görevlere bölüp ekibe dağıtır, ajanlar resmi CLI'lar (Claude Code, Codex) ya da model API'leri üzerinden
görevleri yürütür, lider sonuçları inceler. Ekibin ne yaptığı her an görünürdür: ofiste kim masasında
yazıyor, kim molada kahve içiyor, kim hata aldı, kim onay bekliyor.

## 2. Hedefler (sahibin özgün hedefleri)

Sahibin ilk ürün özetinden:

- **Masaüstü uygulaması** (Electron ya da Tauri — Electron seçildi, bkz. [DECISIONS.md](DECISIONS.md)).
- **Modern koyu arayüz**: Linear / Discord / geliştirici aracı hissi, slate/zinc tonları.
- **Üst sekmeler:** Chat, Office, Terminal, Tasks, Reports, Decisions, Browser (bugün bunlar her projenin
  bölümleridir; ayrıca **Ekip** bölümü ve proje dışı **Organizasyon** sayfası var).
- **Office:** üstten görünümlü piksel harita; her ajanın masası, bilgisayarı ve sprite'ı var;
  çalışıyor / mola / hata durumları canlı görünür.
- **Tasks:** Kanban (To do / In progress / In review / Done), piksel avatarlar ve ilerleme çubukları.
- **Sol panel:** koşan işler listesi (ör. "Nehir – TA-7 working") durdur/duraklat düğmeleriyle, ayrıca
  ajanların diyaloğu (sohbet akışı).
- **Kimlik / sağlayıcı:** OpenAI ya da Anthropic API anahtarı veya hesabıyla giriş; resmi CLI'ları
  (Claude Code vb.) tetikleyen bir **adaptör katmanı**. → Bugün: API anahtarı ya da CLI'ların kendi girişi
  (`claude auth login`, `codex login`); uygulama içinde Claude hesabı/aboneliğiyle giriş Anthropic'in politikası
  nedeniyle sunulmaz ve CLI'lar uygulamayla gelmez.
- **SQLite kalıcı hafıza:** lider ve ajanlar geçmiş kararları ve bağlamı asla unutmasın.
- **Dinamik izin matrisi:** kullanıcı yeni ajanlar tanımlar, dosya sistemi ve terminal erişimini kısıtlar.

Sonradan eklenen hedefler:

- Kullanıcı **kendi ajanlarını oluşturabilmeli** (ör. "Ali" adında bir ajan), rol / iş tanımı verebilmeli
  ve izinlerini ajan ekranından yönetebilmeli. → **Karşılandı (2026-10-12):** önce ayrı "Agents" sekmesinde, bugün Organizasyon → Ajanlar'da ajan
  oluşturma (ad, rol, iş tanımı, yetenekler, yetki şablonu), profil düzenleme ve izinler aynı ekranda;
  lider görevleri rol + yetenek + iş tanımına göre atar.
- **Organizasyon ve yeniden kullanılabilir takımlar:** organizasyon içinde takımlar (hazır şablondan ya da
  sıfırdan); oluşturulan her takım birçok projede yeniden kullanılabilsin; organizasyon ve takımları
  görülüp düzenlenebilsin. Örnekler: 4 ajanlı araştırma & analiz takımı, ürün geliştirme, pazarlama & içerik,
  hatta içinde ajanlı birkaç takım barındıran bir "e-ticaret şirketi".
  → **Karşılandı (2026-10-12):** Organizasyon sayfası (Şema, Takımlar, Ajanlar, Şablonlar); sınırsız iç içe
  birimler (organizasyon › şirket › departman › takım); 5 hazır şablon (Yazılım, Araştırma & Analiz, Ürün
  Geliştirme, Pazarlama & İçerik, E-ticaret Şirketi) — 2026-10-13'ten beri 6: eski başlangıç ekibi de "Çekirdek Ekip" şablonu. Ayrı "Agents" sekmesi kaldırıldı; ajanlar
  Organizasyon → Ajanlar'da.
- **Proje klasörü seçip her projeyi kendi sekmesinde göstermek.** → **Karşılandı (2026-10-12):** üst barda
  proje sekmeleri; her projenin klasörü, takımları, lideri ve tüm verisi ayrı.
- **Sahibin kararları (organizasyon/proje modeli):**
  - Ajanlar projeler arasında **paylaşılır** (bir ajan aynı anda tek görev yürütür); hafıza/geçmiş projeye göre ayrılır.
  - Birimler **sınırsız** iç içe olabilir; bir ajan **birden çok** birimde olabilir.
  - **Her şey projeye özeldir:** görevler, sohbet, kararlar, raporlar, proje hafızası, klasör; Office yalnızca
    o projenin ekibini gösterir. (Organizasyon geneli hafıza tüm projelerde ortaktır.)
- **Ajanları izlemek ve yönlendirmek, maliyeti görmek, uzak sistemlere bağlanmak, dosya eklemek** (büyük istek,
  üç faz):
  - **Faz 1 — Karşılandı (2026-10-13):** her ajan için kalıcı terminal/transkript (ne sorulduğu, kim sordu, ne
    yaptığı), çalışan ajana doğrudan talimat (yönlendir / sıraya al / görev ver), ajan ve proje bazında token
    kullanımı, gerçek etkileşimli kabuklar. Ekibin işi yalnızca yazılım değil: araştırma, veri analizi, doküman,
    içerik, planlama da olabilir.
  - **Faz 2 — Karşılandı (2026-10-13): Bağlantılar.** Organizasyon → Bağlantılar'da SSH sunucuları ve PostgreSQL /
    MySQL-MariaDB / SQL Server veritabanları tanımlanır (ortam, açıklama, kullanım amacı, notlar; sırlar şifreli).
    Ajanlar yalnızca **izin verilen** bağlantıları görür ve kullanır (varsayılan: hiçbiri); seviye Read / Write /
    Execute / Admin. Production'da okuma dışı her işlem kullanıcı onayı bekler; her erişim ve değişiklik denetim
    kaydına yazılır. Böylece ör. "satış veritabanından son çeyreğin özetini çıkar" ya da "staging sunucusunda disk
    durumunu raporla" gibi işler güvenle verilebilir. Sınırlar: [ARCHITECTURE §9b](ARCHITECTURE.md).
  - **Faz 3 — Karşılandı (2026-10-13): Dosya ekleri.** Kullanıcı sohbete (#general'de kimin göreceğini seçerek),
    DM'lere, görevlere ve ajan talimatlarına dosya ekler (düğme, sürükle-bırak, yapıştır): PDF, Word, Excel,
    PowerPoint, CSV, Markdown, JSON, metin/kod, görseller. Dosyalar güvenli bir worker'da okunur, parçalara bölünür
    ve aranabilir olur; ajanlar yalnızca kendilerine verilen dosyaları **okur** (içerik her zaman güvenilmeyen veri),
    büyük dosyalarda araçlarla sayfalar/arar, metin çıktısını dosya olarak kaydedebilir. Her proje için **Dosyalar**
    bölümü yüklenenleri, ajan çıktılarını ve proje klasöründe değişen dosyaları gösterir. Ör. "ekteki teklif PDF'ini
    özetle ve risklerini çıkar", "bu Excel'deki satışları bölgeye göre analiz et".
  Durum: [FEATURES.md §3a–3c](FEATURES.md).
- **Uygulama bağlantıları (MCP) ve skill'ler** (2026-10-13, sahibin isteği: "Claude Desktop / ChatGPT'deki gibi
  e-postamı, çizim uygulamamı bağlayayım, ajanlar kullansın; GitHub'daki ya da .md skill'leri ekleyebileyim").
  → **Karşılandı (2026-10-13):** Organizasyon → **Uygulamalar** (MCP sunucuları: yerel program ya da uzak adres, OAuth
  girişi, Claude Desktop'tan içe aktarma; araç başına politika, ajan başına izin, onay paneli, denetim) ve
  Organizasyon → **Skill'ler** (GitHub / klasör / .zip / .md'den kurulum, önizleme, ajana ya da birime atama). Ör.
  "Posta kutumdaki teklifleri özetle ve yanıt taslağı hazırla" (e-posta uygulaması), "landing page'i frontend-design
  skill'ine göre yaz". Durum: [FEATURES.md §3e–3f](FEATURES.md), sınırlar: [ARCHITECTURE §9e–9f](ARCHITECTURE.md).
- **Belgeler her değişiklikte güncel tutulmalı**, ki başka bir bilgisayarda açılan yeni bir ajan her şeyi
  bilsin (bkz. [../CLAUDE.md](../CLAUDE.md) → "Belgeleri güncel tutma kuralı").

## 3. Hedef kullanıcı

- Tek başına ya da küçük ekipte çalışan, yapay zeka kodlama ajanlarını (özellikle Claude Code) zaten
  kullanan **Türkçe konuşan geliştirici**.
- Birden fazla ajanı paralel çalıştırmak, ne yaptıklarını görmek ve yetkilerini sınırlamak isteyen kişi.
- Birincil platform **Windows 10/11** (PowerShell, DPAPI, NSIS kurulum paketi); kaynaktan macOS/Linux'ta da çalışır.
  macOS paketi gerçek bir Mac'te açıldı ama her özellik orada denenmedi; Linux paketi yok.
- Tek kullanıcı, tek makine: bulut senkronizasyonu, ekip hesabı ve otomatik güncelleme yoktur. Bilinçli kapsam dışı
  kalanların tam listesi → [FEATURES.md §12](FEATURES.md#12-kapsam-dışı--agentbitsin-yapmadıkları).

## 4. UX ilkeleri

- **Koyu, sakin, yoğun bilgi:** zinc paleti (`canvas #09090b`, `surface #111113`, `line #27272a`),
  **indigo vurgu** (`accent #6366f1`). Durum renkleri: çalışıyor = emerald, mola = amber,
  hata = rose, boşta = zinc, inceleme = violet. Tailwind teması: `tailwind.config.js`.
- **Linear/Discord benzeri yerleşim:** iki satırlı üst bar — üstte (40 px, sürüklenebilir) logo, "Organizasyon",
  tarayıcı benzeri **proje sekmeleri** (renk noktası, ad, koşan iş sayısı, ×), "+" yeni proje, proje
  değiştirici, "Tümünü duraklat", ⚙; altta (yalnızca proje görünümünde) proje bölümleri + klasör çipi + proje
  ayarları. 300 px sol panel (Running work · Ekip · Live chat), 24 px durum çubuğu; ayarlar sağdan kayan panel.
- **Canlılık:** ofis, Kanban ve sol panel IPC olaylarıyla anlık güncellenir; ilerleme çubukları,
  "yazıyor…" göstergeleri, nabız atan durum noktaları.
- **Piksel sanatı tutarlılığı:** aynı sprite verisi hem ofiste (canvas) hem arayüzdeki `PixelAvatar`'da
  (SVG) kullanılır; ajanın kıyafet/saç/ten renkleri her yerde aynıdır.
- **Güvenlik görünür olmalı:** onay bekleyen işler sol panelde sarı kartla, reddedilen araç çağrıları
  ajan logunda uyarı olarak görünür.
- **İki dilli arayüz (İngilizce + Türkçe)**, kısa ve eyleme dönük; teknik terimler (TA-7, token, CLI) olduğu gibi. Dil Ayarlar → Genel'den ya da kurulumda seçilir ([I18N.md](I18N.md)).
- Klavye: `Ctrl+1…9` proje bölümleri, `Ctrl+Tab` / `Ctrl+Shift+Tab` projeler arası, `Ctrl+P` proje seçici, `Ctrl+O` Organizasyon, `F1` Kılavuz, `Ctrl+,` ayarlar, `Esc` panel/modal kapatır, `Ctrl+Enter` yeni görev oluşturur.

- **Açılış akışı (proje seçici):** giriş ve ilk kurulumdan sonra uygulama varsayılan projeyi kendiliğinden açmaz;
  **"Hangi projeleri açalım?"** penceresi çıkar. Aktif projeler son açılma zamanına göre sıralanır (6'dan fazlaysa
  arama, "Arşivdekiler" katlanabilir); son oturumun sekmeleri (yoksa en son açılan proje) önceden işaretlidir,
  klasörü bulunamayanlar işaretlenmez. Satırlarda "klasör bulunamadı", "klasör seçilmedi", "açık" ve koşan iş
  rozetleri. Tıkla = seç, çift tık = hemen aç, Enter = seçilenleri aç; arşivdeki proje açılırken arşivden çıkar.
  "Yeni proje" ve "Klasör aç…" kartları: klasörü zaten bir proje kullanıyorsa o açılır, uygulamanın kendi klasörü
  reddedilir, değilse klasör adıyla doldurulmuş yeni proje formu açılır. "Açılışta sorma, son açık projeleri aç"
  ile (veya Ayarlar → Genel → Açılışta) seçici atlanabilir. İlk kurulumun hemen ardından varsayılan proje doğrudan açılır.
- **Boş durum:** son proje sekmesi de kapatılabilir; o zaman "Açık proje yok" ekranı (Proje aç… / Yeni proje /
  Klasör aç… ve son 5 proje) görünür, sol panel ve bölüm satırı gizlenir.

## 5. Organizasyon sayfası ve proje bölümleri

### 5.1 Organizasyon (`Ctrl+O`)

| Sekme | Amaç |
|---|---|
| **Şema** | Yukarıdan aşağı organizasyon şeması (bağlantı çizgileri, katlanabilir düğümler, her birimde "n projede" rozeti) ve "Takımsız ajanlar" şeridi |
| **Takımlar** | Birim ağacı + birim düzenleyici: ad, tür, açıklama, renk, üst birim, lider, üyeler (birim içi unvan, lider yıldızı), "Üye ekle", birime doğrudan yeni ajan, alt birimler, "Projelerde kullanılıyor" + "Projeye ekle", onaylı silme |
| **Ajanlar** | Ajan profilleri (eski Agents sekmesi): liste, "Yeni ajan" (ad, rol, iş tanımı, yetenekler, yetki şablonu), editör (Durum, Kimlik, Görev ve iş tanımı, Birimler/projeler, Model, İzinler, silme) |
| **Şablonlar** | Hazır takım/şirket galerisi; "Şablondan kur" → birimleri ve yeni ajanları oluşturur |
| **Skill'ler** | Talimat paketleri (`SKILL.md` + dosyalar): GitHub'dan, klasörden, .zip ya da .md'den kur ya da uygulamada yaz; önizleme + uyarılar; ajana ya da birime ata; düzenle, kaynaktan güncelle, devre dışı bırak |
| **Uygulamalar** | MCP bağlantıları (e-posta, takvim, tasarım/çizim araçları…): yerel program ya da uzak sunucu (OAuth girişi), JSON yapıştır / Claude Desktop'tan al; Araçlar (araç başına Otomatik / Önce bana sor / Kapalı), Erişim (ajan başına), Ayarlar, Denetim |
| **Bağlantılar** | SSH / PostgreSQL / MySQL / SQL Server bağlantıları: Ayarlar, Ajan erişimi (izinler), Şema (DB), Denetim; "Denetim kaydı (tümü)". Production onayları sol altta |

### 5.2 Proje bölümleri (`Ctrl+1…9`, aktif proje için)

| # | Bölüm | Amaç |
|---|---|---|
| 1 | **Chat** | Projenin `#general` kanalında proje lideri ile konuşma (iş tarifi → projede otomatik görev), proje üyelerine DM, görev akışları |
| 2 | **Office** | Canvas piksel ofis — yalnızca projenin ekibi; proje lideri lider masasında; başka projede çalışan üye soluk ve "· başka projede" etiketli; proje değişince ajanlar masalar arasında yürür |
| 3 | **Ekip** | Projeye atanan birimler, üyeler ve lider (`ProjectTeamView`) |
| 4 | **Terminal** | **Ajan terminalleri** (varsayılan): projenin her üyesi için kalıcı transkript bölmesi — ajana gönderilen prompt'lar (kim gönderdi), çıktısı, araç adımları, durum işaretleri, token şeridi; buradan doğrudan talimat (Yönlendir / Sıraya al / Görev ver), duraklat, durdur. **Kabuklar**: gerçek etkileşimli kabuk oturumları (node-pty; projeler arası ortak) |
| 5 | **Tasks** | Projenin 4 sütunlu Kanban'ı; atanabilecekler = proje üyeleri (lider hariç) |
| 6 | **Reports** | Projenin istatistikleri, ajan performansı, görev raporları, proje bazlı günlük rapor |
| 7 | **Decisions** | Projenin ADR tarzı kararları; kabul edilen karar projenin hafızasına önem 1.0 ile yazılır |
| 8 | **Browser** | Gömülü `<webview>` tarayıcı |
| 9 | **Dosyalar** | Projenin dosyaları (Yüklenen / Ajan / Klasör), ad ve içerikte arama, önizleme (içerik, erişim, kullanım), farklı kaydet / aç / klasörde göster / sil |

Ek olarak: **Proje ayarları** modalı (ad, açıklama, klasör, renk, birim seçimi — alt birimler "dahil",
üye önizlemesi, lider, arşivle, sil), **Ayarlar** paneli (Ajanlar → yönlendirme, İzin Matrisi,
Sağlayıcılar, Hafıza — organizasyon/proje kapsamı, Veri yönetimi — temizlik / log saklama / yedek / geri yükleme /
sıfırlama, Genel), ilk açılışta **Onboarding** (sağlayıcı + ilk projenin adı ve klasörü), boş organizasyonda kurulumu
adım adım anlatan **Kılavuz** yan paneli (`F1`, 8 adım) ve durum çubuğunda "☕ Buy me a coffee" destek düğmesi.

## 6. Marka

- **Ad:** **Agentbits**. Alan adı **agentbits.app**. Paket adı `agentbits`,
  `productName` `Agentbits`, `appId` / Windows AppUserModelId `app.agentbits.desktop`. Kod ve arayüzde ad
  "Agentbits" olarak yazılır (tümü küçük `agentbits` yalnızca tanımlayıcılarda: `agentbits.db`,
  `window.agentbits`, `agentbits:*` anahtarları, `AGENTBITS_DATA_DIR`).
- **Logo:** piksel sanatı bir **ajan başı** — beyaz kafa, koyu indigo vizör, iki amber göz, amber anten ucu ve
  sağ üstte üç lavanta rengi **"bit"** izi (ajan + bit = Agentbits; ofisteki piksel ajanlarla aynı dil).
  Zemin, dikey gradyanlı yuvarlatılmış kare `#6366F1 → #8B5CF6` (uygulamanın indigo vurgusu).
- **Glif renkleri:** kafa `H #F4F4FF`, vizör `V #1E1B4B`, göz ve anten `E/A #FBBF24`, bitler `B #C4B5FD`.
- **Izgara:** 16×16 hücre, 2 hücre kenar boşluğu içinde 12×12 glif → 16 / 32 / 48 / 64 / 128 / 256 px'de
  piksel-tam (bulanıklaşmaz).
- **Dosyalar:** `build-resources/icon.svg` (kaynak), `build-resources/icon.png` (512 px; dev penceresi ikonu),
  `build-resources/icon.ico` (16, 24, 32, 48, 64, 128, 256), `build-resources/icon.icns` (macOS). Uygulama içindeki `Logo` bileşeni
  (`components/common/Logo.tsx`) aynı ızgarayı `LOGO_ROWS` + `LOGO_FILL` ile SVG olarak çizer — logoyu
  değiştirirseniz SVG, PNG, ICO, ICNS ve `LOGO_ROWS`'u birlikte güncelleyin.

## 7. Sözlük

| Terim | Anlamı |
|---|---|
| **Organizasyon lideri** | `is_lead = 1` olan ajan (ilk kurulumda yok; "Çekirdek Ekip" şablonunda *Atlas*); tek olur. Projede başka lider çözülemezse proje lideri olur. Otopilotta hiçbir zaman görev almaz. |
| **Proje lideri** | Projenin `#general` mesajlarına cevap veren, işi ```` ```tasks ```` bloğuyla proje üyelerine bölen ve biten işleri inceleyen ajan. Çözüm sırası: projede açıkça seçilen lider → atanmış ilk birimin lideri → organizasyon lideri → ilk üye. O projede atanmamış görev almaz. |
| **Organizasyon** | Kök birim (`kind = 'organization'`) ve altındaki tüm birimler; silinemez/taşınamaz. |
| **Birim (unit)** | Organizasyon ağacının düğümü: `organization`, `company` (şirket), `department` (departman) ya da `team` (takım). Sınırsız iç içe; lideri, üyeleri (birim içi unvanla) ve rengi var. Bir ajan birden çok birimde olabilir. |
| **Takım** | Ajan barındıran yeniden kullanılabilir birim; istenen sayıda projeye atanabilir. Projeye atanan birimin alt birimleri de projeye dahildir. |
| **Şablon** | Hazır takım/şirket planı (`templates.ts`): kurulunca birimler + benzersiz adlı yeni ajanlar (iş tanımı, yetenekler, yetki şablonu; hepsinde onay açık) oluşur. |
| **Proje** | Bir klasör (`rootPath`) + atanmış birimler + lider + renk; `active` ya da `archived`. Görevler, sohbet, çalışmalar, kararlar, raporlar ve proje hafızası projeye aittir. Her zaman bir varsayılan proje vardır (proje belirtilmeyen kayıtlar oraya düşer); silinirse rolü en son açılan diğer projeye geçer, tek kalan proje silinemez. |
| **Proje sekmesi** | Üst bardaki açık proje sekmesi; açık sekmeler ve aktif proje `localStorage`'da hatırlanır. Arşivlenmiş proje değiştiriciden yeniden açılabilir. |
| **Proje üyeleri** | Projeye atanmış birimlerin (alt birimler dahil) tüm ajanları (`projectMemberIds`). |
| **Ajan (agent)** | Ekipteki yapay zeka çalışanı: ad (benzersiz, büyük/küçük harf duyarsız), rol, iş tanımı, yetenekler (skills), çalışma tarzı (persona), sağlayıcı/model, görünüm renkleri, masa sırası, durum (`idle / working / break / error / offline`). Başlangıç ekibi yoktur; eski seed ekibi (Atlas, Nehir, Zeki, Zeynep — eski adıyla Defne —, Kaan) artık "Çekirdek Ekip" şablonudur. Ajanlar projeler arasında paylaşılır; aynı anda tek görev yürütür. |
| **İş tanımı / yetenekler** | `jobDescription` (sorumluluklar, kapsam) ve `skills` (etiketler). Çalışanın sistem prompt'una girer; lider ve Demo sağlayıcı görev atarken bunlara bakar. |
| **Yetki şablonu** | Yeni ajan oluştururken izinlerin başlangıç ayarı: Salt okuma / Geliştirici / Tam yetki. |
| **Görev (task)** | Bir projeye ait Kanban kartı, `TA-<seq>` anahtarıyla (numara tüm projelerde ortak artar). Durumlar: `todo → in_progress → in_review → done`. Öncelik 0–3 (Düşük/Normal/Yüksek/Acil). |
| **Çalışma (run)** | Bir ajanın bir görevi bir kez yürütmesi. Durumlar: `awaiting_approval, running, paused, succeeded, failed, cancelled`. Token/maliyet ve çıktı burada saklanır. |
| **Hafıza (memory)** | Kalıcı bağlam kayıtları (`fact, decision, context, preference, summary`), kapsamı ortak/ajan/görev; ayrıca `project_id` ile projeye özel ya da (NULL) organizasyon geneli. Her çalışmada en alakalıları prompt'a "Relevant memory" olarak eklenir. |
| **Karar / ADR (decision)** | Mimari karar kaydı (bağlam, karar, gerekçe). Ajanlar ```` ```decision ```` bloğuyla önerir; kullanıcı Decisions sekmesinden kabul eder. |
| **İzin matrisi** | Ajan başına `fs_read, fs_write, terminal, network, browser, require_approval, allowed_paths`. CLI sağlayıcılarında araç listesine / sandbox moduna çevrilir. Ayrıca "Bağlantı izinleri" matrisi (ajan × bağlantı). |
| **Bağlantı** | Organizasyon genelinde tanımlı bir SSH sunucusu ya da veritabanı (PostgreSQL, MySQL/MariaDB, SQL Server); ortamı Development / Staging / Production. |
| **Bağlantı izni / seviye** | Ajan × bağlantı: `none` (varsayılan, satır yok), `read`, `write`, `execute`, `admin`. |
| **Production onayı** | Production bağlantıda okuma dışı işlemin çalışmadan önce kullanıcıdan beklediği onay (10 dk). |
| **Dosya eki** | Projeye ait dosya kaydı (yüklenen, ajanın ürettiği ya da proje klasöründen); içerik-adresli saklanır, parçalara bölünür. Ajan yalnızca izin verilenleri okur. |
| **Dosya ref** | Dosya kimliğinin ilk 8 onaltılık hanesi; prompt'larda ve araçlarda dosyayı adlandırır. |
| **Denetim kaydı (audit)** | Bağlantılara ve uygulamalara her erişimin ve kritik değişikliğin kaydı: kim, ne zaman, hangi görev, ne, sonuç. |
| **Skill** | Ajanın ihtiyaç duyunca okuduğu talimat paketi (Agent Skills biçimi: `SKILL.md` ön bilgisinde ad + açıklama, ardından talimatlar; ek dosyalar/betikler). Ajanın "yetenekler" etiketlerinden farklıdır. |
| **Uygulama (MCP)** | Kullanıcının bağladığı bir MCP sunucusu; araçlarını izinli ajanlar kullanır. Araç politikası: Otomatik / Önce bana sor / Kapalı. |
| **Sağlayıcı (provider)** | Ajanların "beyni": `claude-cli`, `codex-cli`, `anthropic`, `openai`, `mock` (Demo). Bir varsayılan sağlayıcı vardır; ajan başına farklısı seçilebilir. |
| **Proje klasörü / çalışma alanı** | `project.rootPath`. CLI ajanları o projenin görevlerinde burada başlar ve yalnızca burada (+ `allowed_paths`) dosya düzenleyebilir; CLI sağlayıcılarında zorunludur. (`settings.workspaceRoot` artık yalnızca varsayılan projeyle senkron eski bir ayardır.) |
| **Otopilot** | `settings.autopilot`. Açıkken orkestratör her 1,5 sn'de boştaki ajanlara sıradaki `todo` görevini atar (kendisine atanmış görevler tüm aktif projelerden; atanmamışlar yalnızca üyesi olduğu ve lideri olmadığı projelerden). |
| **Lider incelemesi** | `settings.reviewByLead`. Açıkken `in_review` görevler lider tarafından incelenip `done`'a ya da revizyon notuyla `todo`'ya taşınır. |
| **Onay (approval)** | `require_approval` açık ajanın çalışması `awaiting_approval` durumunda başlar; sol panelde Onayla/Reddet kartı çıkar. |
| **Running work** | Sol paneldeki koşan işler listesi — tüm projelerden, proje çipiyle (tıklayınca o projeye geçer); duraklat / durdur / onayla. |
| **Kılavuz** | Sağdaki yardım paneli (`F1`, TopBar'da `x/8` rozeti): sağlayıcı, takım, ajanlar, lider, izinler, projeye takım, ilk iş, izleme adımları durumdan otomatik işaretlenir; "Nerede ne var" ve kısayollar. |
