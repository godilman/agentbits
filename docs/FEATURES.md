# Agentbits — Özellik Durumu

> **Her değişiklikten sonra bu dosyayı güncelleyin** (bkz. [../CLAUDE.md](../CLAUDE.md)).
> Son güncelleme: **2026-10-13** (Belgeler: kapsam denetimi — §11 Paketleme, §12 Kapsam dışı)

Lejant: ✅ tamam · 🟡 kısmi · 🚧 geliştiriliyor · ⏳ planlı · — yok / kapsam dışı

## 1. Kabuk, açılış ve genel

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| Electron penceresi, gizli başlık çubuğu + overlay, koyu tema | ✅ | `src/main/index.ts`, `TopBar.tsx` |
| WCAG AA kontrast denetimi — tüm text/bg kombinasyonları ≥4.5:1 (normal metin), ≥3:1 (büyük metin/UI bileşeni) | ✅ | `index.css` `btn-primary`; 24 bileşen dosyasında `zinc-500/600` → `zinc-400`; iki kasıtlı istisna (debug log, dekoratif ayraç) |
| Onboarding: sağlayıcı seç + test et → ilk projenin adı ve klasörü | ✅ | `components/onboarding/Onboarding.tsx`; ad boşsa "İlk Proje"; klasör `projects:inspectFolder` ile doğrulanır (hata gösterilir) ve varsayılan projeye yazılır; bitince proje doğrudan açılır ve Kılavuz gelir; CLI sağlayıcıda zorunlu |
| Boş ilk kurulum: hiç ajan, takım, görev yok | ✅ | 2026-10-13; seed kaldırıldı. Eski başlangıç ekibi "Çekirdek Ekip" şablonu (Atlas, Nehir, Zeki, Zeynep, Kaan) |
| Kılavuz yan paneli (TopBar "Kılavuz" + `x/8` rozeti, `F1`) | ✅ | `features/guide/GuideDrawer.tsx`; 8 adım (sağlayıcı, takım, ajanlar, lider, izinler, projeye takım, ilk iş, izleme) durumdan otomatik işaretlenir, her adımda neden/nasıl + kısayol düğmeleri; "Nerede ne var" başvurusu ve Kısayollar; içeriği daraltır, örtmez |
| Boş durumlar: ofis "Ofis boş", Ekip "Henüz hiç ajanın yok", Chat "Henüz konuşacak bir lider yok" | ✅ | Şablonlar ve Kılavuz'a yönlendirir |
| Çoklu dil: İngilizce + Türkçe arayüz | ✅ | 2026-10-13; i18next + react-i18next, `src/shared/locales/{en,tr}/*.json` (21 bölüm), anahtarlar tip denetimli; main süreç hataları, sistem mesajları, şablonlar ve Demo metinleri de çevrilir ([I18N.md](I18N.md)) |
| Türkçe arayüzde sekme ve Kanban sütun adları Türkçe | ✅ | 2026-10-15: Sohbet, Ofis, Ekip, Terminal, Görevler, Raporlar, Kararlar, Tarayıcı, Dosyalar; Yapılacak → Devam eden → İncelemede → Bitti (`layout.json`, `common.json` → `status`). README ekran görüntüleri (`docs/screenshots/tr/`) henüz eski adları gösteriyor |
| Dil seçimi: Ayarlar → Genel → Dil ve Onboarding ilk adımı; varsayılan "Sistem" | ✅ | `settings.language` (`'auto'` → işletim sistemi dili, desteklenmiyorsa İngilizce); anında uygulanır, yeniden başlatma gerekmez |
| Dil değişince dokunulmamış varsayılan adlar ("Organizasyon", "Varsayılan Proje"…) yeni dile çevrilir | ✅ | `relabelDefaults()`; kullanıcının değiştirdiği adlara dokunulmaz |
| Çeviri denetimi (`npm run test:unit` / `npm run i18n:check`) | ✅ | `tests/i18n.test.ts`: aynı anahtarlar, dile özgü çoğul biçimleri, `{{yer tutucular}}`, boş değer yok, kaynakta Türkçe harfli sabit metin yok |
| Saklanmış metinlerin dil değişince çevrilmesi | — | Sohbet/sistem mesajları, durum notları, denetim kaydı, görev raporları yazıldıkları dilde kalır |
| Ek diller (topluluk) | ⏳ | Yeni dil = klasör + `LANGUAGES` satırı; adımlar [I18N.md](I18N.md) |
| İlk yükleme hatasında "Veriler yüklenemedi / Tekrar dene" ekranı | ✅ | `initError`, `loadAll()`; `refresh()` hataları yakalanır |
| Onboarding arkasında canlı ofis önizlemesi | ✅ | Aynı `OfficeEngine` sahte durumlarla |
| Ayarlar → Genel → "Kurulum sihirbazı / Yeniden başlat" | ✅ | `onboarded = false` |
| E-posta/parola giriş ekranı | — | **Kaldırıldı** (2026-10-13): yalnızca istemci tarafıydı, gerçek güvenlik sağlamıyordu; uygulama doğrudan açılır |
| Tek uygulama örneği (veri klasörü başına) | ✅ | İkinci açılış mevcut pencereyi öne getirir; aynı DB'de çift çalışma olmaz |
| Klavye kısayolları (`Ctrl+1…9` proje bölümleri, `Ctrl+Tab`/`Ctrl+Shift+Tab` projeler, `Ctrl+P` proje seçici, `Ctrl+O` Organizasyon, `F1` Kılavuz, `Ctrl+,`, `Esc`, `Ctrl+Enter`) | ✅ | `App.tsx`, `Modal`, `SettingsPanel`, `NewTaskModal` |
| ErrorBoundary (bir görünüm çökünce tüm pencere kararmaz) | ✅ | `components/common/ErrorBoundary.tsx`, sekme değişince sıfırlanır |
| Durum çubuğu (otopilot, ajan sayıları, sağlayıcı, aktif proje + klasörü, oturum ve tüm zamanlar token toplamı, hafıza) | ✅ | `StatusBar.tsx` |
| Destek düğmesi "☕ Buy me a coffee" (durum çubuğu sağı; sabit adres sistem tarayıcısında açılır, `app:openSupport`; dar pencerede yalnızca ikon) | ✅ | `StatusBar.tsx`, `src/main/ipc.ts`, adres `src/shared/support.ts` |
| Geri bildirim düğmesi (durum çubuğu sağı, kahve düğmesinin solu) → modal: Öneri / Hata / Teşekkür + 1–5 puan | ✅ | `features/feedback/FeedbackModal.tsx`; form yok: ne yazılacağını anlatır, `app:feedbackMail(kind, rating?)` kullanıcının e-posta uygulamasını sabit adrese (`FEEDBACK_EMAIL`) konu + şablonla açar; hata bildirimine sürüm, işletim sistemi ve dil eklenir; Teşekkür bölümünde "Buy me a coffee"; adresi kopyala düğmesi; İngilizce + Türkçe; Kılavuz → Nerede ne var → Durum çubuğu |
| Toast bildirimleri | ✅ | `Toasts.tsx`, main'den `toast()` |
| Ürün adı **Agentbits** + yeni piksel logo (uygulama içi `Logo`, `icon.svg/png/ico`) | ✅ | 2026-10-13; `appId` `app.agentbits.desktop` |

## 2. Organizasyon & Projeler

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| Organizasyon sayfası (`Ctrl+O`): Şema / Takımlar / Ajanlar / Şablonlar, "Şablondan kur", "Yeni birim" | ✅ | `features/org/OrgView.tsx` |
| Organizasyon şeması: yukarıdan aşağı, bağlantı çizgileri, katlanabilir, "n projede" rozeti, "Takımsız ajanlar" şeridi | ✅ | `OrgChart.tsx` |
| Sınırsız iç içe birimler (organizasyon › şirket › departman › takım) | ✅ | `units` tablosu, `src/shared/org.ts` |
| Birim düzenleyici: ad, tür, açıklama, renk, üst birim, lider, üyeler (birim içi unvan, lider yıldızı), başka birimler, alt birimler, onaylı silme | ✅ | `TeamsView.tsx`, `UnitEditor.tsx` |
| Birime üye ekleme modalı; birime doğrudan yeni ajan oluşturma | ✅ | `AddMembersModal.tsx`; `NewAgentModal` `unitId` ile |
| Bir ajanın birden çok birimde olması; ajan editöründe birimleri/projeleri | ✅ | `AgentUnits.tsx` |
| Birime lider atayınca üyeliğin otomatik eklenmesi | ✅ | `units:save` |
| Kök birim silinemez/taşınamaz, döngü oluşturan taşıma reddedilir | ✅ | `units:save` / `units:delete`, `wouldCycle` |
| "Projelerde kullanılıyor" + "Projeye ekle" (takımın yeniden kullanımı) | ✅ | `UnitEditor.tsx` |
| Hazır şablonlar (6): Çekirdek Ekip (5; eski başlangıç ekibi), Yazılım (5), Araştırma & Analiz (4), Ürün Geliştirme (4), Pazarlama & İçerik (4), E-ticaret Şirketi (Genel Müdür + 5 alt takım, 10 ajan) | ✅ | `src/main/core/templates.ts`, `TemplatesView.tsx` |
| **Paylaşım:** birim (altındaki her şeyle) ya da ajan `.agentbits` dosyasına dışa aktarılır; dosyadan ya da GitHub bağlantısından önizlemeli içe aktarılır | ✅ | 2026-10-15; birim / ajan sayfasında "Paylaş → Dışa aktar", Organizasyon → Şablonlar → "Paket içe aktar". Pakette: birim ağacı, ajan profilleri, unvanlar, liderler, önerilen sağlayıcı türü + model, istenen izinler, skill dosyaları (çalıştırılabilirler hariç), bağlantı/uygulama **adları** (kurulum notu). Asla: anahtarlar, bağlantı/uygulama ayarları, sağlayıcı kayıtları, görevler, sohbet, hafıza, dosyalar, yerel yollar. İçe aktarmada iş tanımı/kişilik tam gösterilir, talimata benzeyen satırlar işaretlenir; ajanlar hep "Onay iste" açık ve ek klasörsüz başlar, adı alınmışsa numara alır, lider olmaz; aynı adlı kurulu skill korunur. Sağlayıcı: aynı türdeki sağlayıcın (varsayılan önce), yoksa varsayılan. `core/share.ts`, `shared/share.ts`, `tests/share.test.ts`. Galeri (agentbits.app) ⏳ |
| Şablon kurulumu: birimler + benzersiz adlı yeni ajanlar (iş tanımı, yetenekler, yetki şablonu), birim liderleri | ✅ | Şablon ajanlarında "Onay iste" açık (Çekirdek Ekip lideri Atlas hariç; lider zaten görev almaz) |
| Projeler: üst barda tarayıcı benzeri sekmeler (renk, ad, koşan iş sayısı, ×), "+" yeni proje, proje değiştirici ("Proje aç… (Ctrl+P)", "Klasör aç…" dahil) | ✅ | `TopBar.tsx`; açık sekmeler `localStorage`'da; son sekme de kapatılabilir |
| **Açılış proje seçici** ("Hangi projeleri açalım?"): son açılana göre sıralı liste, >6'da arama, "Arşivdekiler", ön seçim (son oturum / en son proje; klasörü kayıp olanlar hariç), rozetler (klasör bulunamadı / seçilmedi / açık / koşan iş), tık = seç, çift tık = aç, Enter = seçilenleri aç; arşivdeki proje açılınca arşivden çıkar | ✅ | `features/project/ProjectLauncher.tsx`; varsayılan proje artık otomatik açılmaz (ADR-015) |
| Seçicide "Yeni proje" ve "Klasör aç…" (klasörü kullanan proje açılır; uygulama klasörü reddedilir; değilse klasör adıyla dolu yeni proje formu) | ✅ | `projects:inspectFolder`, `openProjectModal(null, draft)` |
| "Açılışta sorma, son açık projeleri aç" (`startupProjects: 'ask' \| 'restore'`) | ✅ | Seçicinin altında ve Ayarlar → Genel → "Açılışta" |
| Açık proje yokken başlangıç ekranı ("Açık proje yok"; Proje aç… / Yeni proje / Klasör aç…; son 5 proje) | ✅ | `ProjectHome`; Sidebar ve bölüm satırı gizlenir |
| Son açılma zamanı (`last_opened_at`) | ✅ | Migration v4, `projects:touch` |
| Proje klasörü doğrulaması main'de: var olmalı, klasör olmalı, Agentbits uygulama/depo klasörü olmamalı, başka projede kullanılmamalı | ✅ | `core/folders.ts` → `assertUsableFolder`, `projects:save` (yalnızca `rootPath` değişince) |
| ProjectModal'da klasör seçiminde satır içi hata (bulunamadı / uygulama klasörü / başka projede), kayıp klasör uyarısı, klasör adından ad önerisi | ✅ | `ProjectModal.tsx` |
| Proje ayarları modalı: ad, açıklama, klasör, renk, birim seçimi (alt birimler "dahil"), canlı üye önizlemesi, lider, arşivle, sil | ✅ | `features/project/ProjectModal.tsx`; varsayılan proje de silinebilir; rolü en son açılan diğer projeye geçer, tek kalan proje silinemez; proje seçicideki her satırda ⚙ ile ayarlara gidilir (kapatınca seçiciye dönülür) |
| Arşivlenmiş projeleri değiştiriciden yeniden açma | ✅ | |
| Proje silme: görevler, çalışmalar, loglar, sohbet, kararlar, raporlar ve proje hafızası birlikte silinir | ✅ | `projectsRepo.delete` (onaylı); **proje klasörü ve içindeki dosyalar asla silinmez** (onay metninde de yazar) |
| Proje bazlı veri ayrımı (görev, sohbet, çalışma, karar, rapor, hafıza) | ✅ | `project_id` sütunları (migration v3) |
| Ajanlar projeler arasında paylaşılır (aynı anda tek görev) | ✅ | Office'te başka projede çalışan üye soluk + "· başka projede" |
| Proje lideri çözümü (açık lider → ilk birimin lideri → organizasyon lideri → ilk üye) | ✅ | `core/org.ts` → `projectLead`, renderer `lib/org.ts` |
| Proje klasörü (CLI çalışma dizini); klasörsüz projede CLI görevi reddedilir | ✅ | Alt satırda amber "Klasör seçilmedi" çipi |
| Ekip bölümü (projenin birimleri, üyeleri, lideri) | ✅ | `ProjectTeamView.tsx` |
| Ayarlar → Genel: klasör proje başına ("Proje ayarlarını aç") | ✅ | `SettingsPanel.tsx` |
| Eski (v2) verinin taşınması: "Organizasyon" kökü, "Çekirdek Ekip", "Varsayılan Proje" | ✅ | `ensureOrgDefaults()` her açılışta idempotent |

## 3. Proje bölümleri (eski üst sekmeler)

| Sekme / özellik | Durum | Not |
|---|---|---|
| **Chat** — projenin `#general` kanalında proje lideri ile sohbet | ✅ | Lider ```` ```tasks ```` bloğu → projede otomatik görevler; atananlar yalnızca proje üyeleri |
| Lider ↔ ekip: lider biten işlerin rapor özetlerini görür, ```` ```message ```` ile göreve not bırakır (çalışan göreve mevcut adımdan sonra iletilir) | ✅ | 2026-10-15; yalnızca lider ekiple konuşur, ajanlar birbirine yazmaz (sahibin kararı). `shared/leadComms.ts`, `tests/leadComms.test.ts`; Demo lideri mesajda geçen görev anahtarına not iletir. Sıradaki talimat ipucunda "Liderden" etiketi |
| Chat — ajanlara DM (`agent:<id>`) | ✅ | Çalışan ajan kendi persona'sıyla kısa cevap verir |
| Chat — görev akışları (`task:<id>`) | ✅ | Not bırakılır, cevap gelmez; sonraki çalışmada prompt'a girer |
| Chat — "yazıyor…" göstergesi, öneri düğmeleri, Markdown | ✅ | |
| **Office** — piksel harita, masa/laptop, yürüme, mola lounge'ı | ✅ | `features/office/*`; yalnızca aktif projenin ekibi, lider masasında proje lideri; proje değişince ajanlar masalar arasında yürür |
| Office — durum baloncukları (onay `?`, hata `!`, duraklatıldı `=`, kahve) | ✅ | |
| Office — ajana tıkla → panel (şu anki iş, aktivite logu, mesaj, çevrimdışı yap) | ✅ | `OfficeView.tsx` → `AgentPanel` |
| Office — 10'dan fazla çalışanlı proje | 🟡 | 10 masa var; fazlası masaları paylaşır (`i % 10`) |
| **Terminal → Ajan terminalleri** (varsayılan): projenin her üyesi için bölme, lider önce; sütun Oto/1–4, filtre Tümü/Çalışanlar; bölme büyütme ve tarayıcı tam ekranı (Esc) | ✅ | `features/terminal/AgentGrid.tsx`, `AgentPane.tsx` — ayrıntı §3a |
| **Terminal → Kabuklar**: gerçek etkileşimli kabuk (node-pty PTY; tam ekran TUI, Ctrl+C, yeniden boyutlandırma) | ✅ | `@lydell/node-pty`; yüklenemezse görünür "Pipe modu" yedeği; kabuklar projeler arası ortak |
| **Tasks** — 4 sütunlu Kanban, sürükle-bırak sıralama | ✅ | In progress'e bırakmak işi başlatır; dışarı sürüklemek durdurur. Test senaryoları: `docs/TEST_SCENARIOS_KANBAN.md` |
| Tasks — arama, ajana göre filtre, yeni görev modalı | ✅ | Yalnızca aktif proje; atanabilecekler = proje üyeleri (lider hariç) |
| Tasks — görev çekmecesi (düzenleme, durum/öncelik/atanan, akış / loglar / çalışmalar, şimdi başlat, durdur, sil) | ✅ | `TaskDrawer.tsx` |
| Tasks — `tasks:list` cursor sayfalama | ✅ | Ajanlar ekledi; renderer tüm sayfaları gezer (`fetchAllTasks`) |
| **Reports** — istatistik kartları, ajan performansı, görev raporları | ✅ | |
| Reports — günlük rapor üretme | ✅ | `reports:generateDaily(projectId)` — proje bazlı |
| Reports — özel (`custom`) rapor | ✅ | 2026-10-15: Raporlar → Özel: lider istenen konuda projenin verisinden (pano, görevler, kararlar, son raporlar) araçsız yazar (`reports:generateCustom`) |
| **Decisions** — ADR listesi, filtre, oluştur/düzenle, kabul/ret/geçersiz kıl, sil | ✅ | Kabul → hafızaya önem 1.0 |
| Decisions — ajanların ```` ```decision ```` önerileri | ✅ | `proposed` olarak eklenir, üst barda sayaç |
| **Browser** — `<webview>`, adres çubuğu, geri/ileri/yenile, yer imleri, arama | ✅ | `persist:agentbits-browser` oturumu |
| Browser — ajanların tarayıcıyı araç olarak kullanması | ⏳ | `browser` izni şu an uygulanmıyor |
| **Ekip** bölümü (eski "Agents" sekmesinin yerinde, `Ctrl+3`) | ✅ | `ProjectTeamView.tsx` |
| Organizasyon → **Ajanlar**: aranabilir liste, durum noktası, lider yıldızı, "Masa n/10" sayacı | ✅ | `features/agents/AgentsView.tsx` (Organizasyon sayfasında) |
| Ajanlar — yeni ajan modalı (ad zorunlu, rol, iş tanımı, yetenekler, yetki şablonu, rastgele görünüm, isteğe bağlı birim) | ✅ | `NewAgentModal.tsx` |
| Ajanlar — profil editörü (Durum, Kimlik, Görev ve iş tanımı, Birimler/projeler, Model, İzinler, silme onayı; "Kaydedildi") | ✅ | `AgentEditor.tsx`, `AgentUnits.tsx`; organizasyon lideri silinemez |
| Ajanlar — "Mesaj" ve "Görev ata" | ✅ | `NewTaskModal` `App.tsx`'te |
| Office ajan panelinden "Profili düzenle" | ✅ | `openAgentProfile()` → Organizasyon → Ajanlar |

## 3a. Ajan terminalleri, doğrudan talimatlar ve token kullanımı (Faz 1)

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| Bölme başlığı: ad, rol, lider tacı, durum / çalışma durumu, mevcut görev, sağlayıcı/model, token şeridi (Görev / Oturum / Toplam, üzerine gelince döküm), duraklat/devam, onaylı durdur | ✅ | `AgentPane.tsx`, `components/common/TokenUsage.tsx` |
| Kalıcı transkript: seviyeye göre biçimli satırlar; "📨 Lider → Ajan: TA-n" prompt satırları ve "Gönderilen tam prompt" (prompt + sistem) | ✅ | `agent_logs` yeni seviyeler `prompt` / `instruction` / `status` + `meta` (v5) |
| Transkripte yazılanlar: görev prompt'u, liderin inceleme prompt'u ve kararı (çalışanın terminaline de), sohbet prompt'ları/cevapları, planlanan görev listeleri, Claude Code araç sonuçları (`↳`) | ✅ | `orchestrator.ts` |
| Performans: ajan başına `log:new` aboneliği (global store render yok), animasyon karesi başına toplu güncelleme, ekran dışı bölmede çizim durur, en fazla 4000 satır + "Daha eski kayıtlar" (`beforeId`), "yeni çıktı" rozeti | ✅ | `lib/transcripts.ts`, `logs:list` |
| **Doğrudan talimat** — Yönlendir (`redirect`: mevcut adım kesilir, aynı görev talimatla sürer) | ✅ | `agents:instruct`; Claude Code `--resume`, API'ler kısmi çıktı + talimatla yeniden, Codex geçmişi metin olarak, Demo simülasyon — bölmede `steeringFor()` etiketi |
| Doğrudan talimat — Sıraya al (`queue`: adım bitince, incelemeden önce; onay beklerken ilk prompt'a eklenir) | ✅ | |
| Doğrudan talimat — Görev ver (`task`: boştaki ajana atanmış görev oluşturup başlatır) | ✅ | `createdBy: 'Kullanıcı'` |
| Talimat güvenliği: ajan başına sıralama kilidi, `expectedRunId` ile iyimser eşzamanlılık (ajan başka çalışmaya geçtiyse Türkçe hata), en fazla 8000 karakter | ✅ | `orchestrator.instruct()` |
| Talimat görünürlüğü: `agent_instructions` kaydı, transkript, görev kanalında kullanıcı mesajı, projenin `general`'inde sistem notu, liderin prompt'unda "Direct user interventions" (son 6) | ✅ | v5 |
| Bekleyen talimatların iptali: yeniden başlatma, durdurma, onay reddi | ✅ | `status = cancelled` |
| Token kaydı: çağrı/segment başına (ajan, çalışma, görev, proje, mod task/chat/review, sağlayıcı, model, input/output/cache okuma/yazma, maliyet, tahmini mi, uygulama oturumu) — sohbet ve inceleme dahil | ✅ | `token_usage` (v5), `ctx.onUsage` |
| Sağlayıcı bildirim düzeyi: Claude Code / Anthropic / OpenAI tam; Codex yalnızca toplam (`partial`); Demo tahmini | ✅ | `usageReportingFor()` |
| Reports → **Token kullanımı**: Bu proje / Tüm projeler, özet kartlar, ajan tablosu, son 14 gün grafiği, dürüstlük notu | ✅ | `features/reports/UsagePanel.tsx`, `usage:summary`, `usage:daily` |
| Token bilgisi ajan bölmelerinde, Office ajan listesi/detayında, Ekip satırlarında ve StatusBar'da | ✅ | `TokenUsage.tsx` |
| Genel amaçlı çalışan prompt'u (yazılım, araştırma, veri analizi, doküman, içerik, planlama…) | ✅ | `prompts.ts` |

## 3b. Bağlantılar (Faz 2) — Organizasyon → Bağlantılar

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| Bağlantı türleri: SSH, PostgreSQL, MySQL/MariaDB, SQL Server — organizasyon geneli, projeler paylaşır | ✅ | `features/connections/ConnectionsView.tsx`, `src/main/connections/` |
| Alanlar: benzersiz ad, ortam (Development/Staging/Production), açıklama, "Kullanım amacı", notlar, host, port (türe göre varsayılan), kullanıcı, veritabanı, SSL/encrypt, sunucu sertifikasına güven, salt-okunur DB girişi (ajan okumaları için zorunlu) | ✅ | Tür oluşturulduktan sonra değişmez; doğrulama ve hatalar Türkçe |
| SSH kimlik doğrulama: anahtar dosyası / yapıştırılmış anahtar / parola / ssh-agent (Windows OpenSSH pipe ya da `SSH_AUTH_SOCK`) | ✅ | `app:pickFile` ile dosya seçimi |
| SSH komut izin listeleri (read / write / execute; `*` joker; varsayılan okuma listesi) | ✅ | `DEFAULT_SSH_READ` |
| Paneller: Ayarlar / Ajan erişimi / Şema (DB) / Denetim; "Denetim kaydı (tümü)" | ✅ | `AuditList.tsx` (filtreler, "Daha eski kayıtlar") |
| Test: DB sunucu sürümü + salt-okunur girişin doğrulanması; SSH ana bilgisayar anahtarı sabitleme (TOFU, SHA256), değişen anahtar "Sıfırla"ya kadar reddedilir | ✅ | `connections:test` |
| Şema gezgini (`information_schema`, en fazla 4000 sütun, önbellekli) | ✅ | `connections:schema(id, refresh?)` |
| Sırlar `safeStorage` ile şifreli, UI'da yalnızca yazılabilir, renderer/prompt/terminal/log'a gitmez, sürücü hataları maskeli | ✅ | `hasSecret` bayrakları |
| Ajan başına bağlantı izinleri — varsayılan hepsini reddet (none/read/write/execute/admin) | ✅ | Bağlantının "Ajan erişimi" paneli + Ayarlar → İzin Matrisi → "Bağlantı izinleri" |
| SQL / SSH sınıflandırması (yorum/değişmez ayıklama, PG dolar tırnağı, çoklu ifade = admin; boru hattı parçaları, tehlikeli işleçler = admin) | ✅ | `src/shared/connections.ts`, `npm run test:unit` |
| DB düzeyi zorlama: `read` PG/MySQL salt-okunur işlem + her zaman geri al (MSSQL: yalnızca sınıflandırma + geri alınan işlem), ajan okumaları yalnızca salt-okunur girişle (yoksa reddedilir); `write` işlem + commit; `admin` doğrudan; 30 sn zaman aşımı, 200 satır, 48 KB; SSH 60 sn, 64 KB; çağrı başına kısa bağlantı | ✅ | `drivers.ts`, `service.ts` |
| Production onayı: `read` dışı her işlem kullanıcıyı bekler — sol alttaki onay kutusu (geri sayım, "Onayla ve çalıştır" / "Reddet") + toast; 10 dk'da yanıt yoksa ret; durdurma/yönlendirme/sıfırlama/kapanışta ret | ✅ | `ApprovalsDock.tsx`, `approvals:list|resolve` |
| Denetim kaydı: tüm ajan erişimleri (reddedilenler dahil) ve kullanıcı işlemleri (bağlantı CRUD, test, şema, izin eski → yeni, onaylar) | ✅ | `audit_log`, `audit:list` |
| Keşif: çalışan prompt'una yalnızca izinli bağlantılar (ad, tür, ortam, seviye, açıklama, amaç, notlar, veritabanı) | ✅ | `connectionsPrompt()` |
| Araçlar: `connections_list`, `db_schema`, `db_query`, `ssh_exec` — yalnızca main'de çalışır, transkriptte 🔌 / 🖥 / ⛔ / ↳ satırları | ✅ | `tools.ts`, `service.ts` |
| Claude Code: çalışma başına MCP yapılandırması + köprü (127.0.0.1, çalışma token'ı), `--strict-mcp-config` (projenin `.mcp.json`'u yok sayılır), `mcp__agentbits` ön-onaylı | ✅ | `bridge.ts`, `mcp/server.ts` |
| Anthropic / OpenAI: yerel tool-use döngüsü (en fazla 16 tur; tur başına kullanım), yalnızca bağlantısı olan ajanlara | ✅ | `anthropic.ts`, `openai.ts` |
| Codex CLI ile bağlantı araçları | ✅ | 2026-10-15: görevde Codex her zaman Agentbits MCP köprüsünü alır (bağlantı, dosya, skill, uygulama, `team_status`); yetki köprüde denetlenir. Gerçek Codex CLI ile denenmedi |
| Demo: veri/sunucu görevlerinde aynı yoldan **gerçek** çağrılar (liste, şema, `SELECT … LIMIT 5`, 0 satırlık `UPDATE`, `uptime`/`df`) | ✅ | İzin, onay ve denetimi göstermek için |
| Araç sonuçları "untrusted content" etiketli; prompt verideki talimatlara uyulmamasını söyler | ✅ | |

## 3c. Dosya ekleri (Faz 3)

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| **Faz 3 — Dosya ekleri** | ✅ | `src/main/files/`, `features/files/`, migration v7 |
| Ekleme yerleri: sohbet composer'ı (#general'de paylaşım seçici: Yalnızca lider / Tüm proje ekibi / Takım: X), DM, görev çekmecesi ("Dosyalar"), yeni görev modalı, ajan terminali talimatı (tüm bölme bırakma alanı) | ✅ | Düğme + sürükle-bırak + yapıştır (`useFileDrop`); yüklemeler hemen başlar, gönderilmeyen yüklemeler silinir |
| Proje bölümü **Dosyalar** (`Ctrl+9`): filtre Tümü / Yüklenen / Ajan / Klasör, ad + içerik araması (isabetler önizlemeyi ilgili parçada açar), yükleme düğmesi, bırakma alanı | ✅ | `FilesView.tsx` |
| Önizleme modalı: meta, durum, uyarılar, "talimat benzeri satır" bandı; sekmeler İçerik (20'şer parça; CSV/Excel tablo; görseller) / Erişim / Kullanım (Eklendi / Prompta verildi / Okundu / Üretildi); Farklı kaydet, Aç (yalnızca güvenli uzantılar), Klasörde göster, Sil | ✅ | `FilePreviewModal.tsx` |
| Sohbet mesajlarında ve talimat satırlarında dosya çipleri | ✅ | `meta.files` |
| Biçimler: PDF (sayfa başına), DOCX (başlık/liste/tablo; izlenen silmeler atlanır), XLSX (tüm sayfalar, tarih biçimleri, önbellekli değeri olmayan formül `=FORMÜL`), PPTX (slayt + konuşmacı notları), CSV (ayraç tespiti), Markdown (başlıklara göre), JSON/JSONL, kod/metin, görseller (PNG/JPEG/GIF/WebP/BMP boyut bilgisi) | ✅ | `extract.ts`; uzantı sihirli baytlarla doğrulanır |
| Metin kodlaması: UTF-8 / BOM / UTF-16, yoksa Windows-1254 | ✅ | |
| Güvenli çıkarma: worker_threads (768 MB, 120 sn, en fazla 2 paralel); ZIP bombasına karşı sınır (girdi başına 120 MB, arşiv başına 250 MB açılmış) | ✅ | `worker.ts`, `readZip` |
| Parçalama (~3500 karakter; küçük sayfalar "[Sayfa N]" ile birleşir; tablolarda başlık tekrarı ve "Sayfa · satır a–b") + FTS5 arama | ✅ | `chunkSections`, `file_chunks_fts` |
| Talimat benzeri satır tespiti (EN/TR, sezgisel) — uyarı olarak gösterilir, içerik her durumda veri sayılır | ✅ | `findSuspicious` |
| İçerik-adresli depolama (SHA-256, tekilleştirme), yedek farkında çöp toplama | ✅ | `storage.ts` |
| Erişim modeli (varsayılan reddet): açık izin, proje geneli paylaşım ya da çalışılan görevin dosyası; önizlemedeki "Erişim" sekmesinde ajan başına ve proje geneli anahtarlar (denetlenir) | ✅ | `file_access`, `files.project_shared`, `file_links` |
| Paylaşım hedefleri: #general → lider (varsayılan) / ekip / takım; DM → o ajan; görev akışı → göreve bağ; talimat → o ajan + talimat ve görevine bağ; `file_save` → üreten + proje lideri | ✅ | |
| Liderin planlaması: ```` ```tasks ```` bloğunda `"files": […]`; varsayılan olarak kullanıcı mesajının dosyaları her yeni göreve | ✅ | "📎 dosyalar görevlere eklendi" notu |
| Prompt bölümü: dosya listesi (ref, tür, boyut, sayfa/sayfa adları, parça, ~token, notlar, ⚠ talimat benzeri), içerik güvenilmeyen-veri zarfında; küçükler önce; araçlı 24k / araçsız 60k karakter bütçesi; uzunlar için önizleme + `file_search`/`file_read` | ✅ | `filesSection()` |
| Ajan araçları: `files_list`, `file_read` (parça, en fazla 3), `file_search`, `file_save` (yalnızca görev modunda) | ✅ | Claude Code MCP, Anthropic/OpenAI function calling, Demo |
| Sohbette de araçlar: Claude Code lider sohbette salt-okunur dosya araçları (MCP), API sağlayıcıları dosya okuma fonksiyonları | ✅ | `agentTools.ts` |
| Görseller ve taranmış PDF'ler: Anthropic görsel/belge blokları; OpenAI `image_url` (PDF yerel gönderilmez); Claude Code MCP görsel içeriği; Codex `--image`; Demo görsel yok | ✅ | OCR yok |
| Üretilen dosyalar: `file_save` (metin biçimleri, 2 MB, çalışma başına 20); CLI ajanlarında (fsWrite) çalışma sonrası proje klasörü taraması → "Klasör" dosyaları (kopyalanmaz); görev akışında çipler, #general'de "📎 N dosya", transkriptte "📎 Üretilen dosyalar", görev raporunda "## Dosyalar" | ✅ | `recordWorkspaceChanges` |
| Denetim: reddedilen okumalar, `file_save`, kullanıcı silmeleri, erişim değişiklikleri (`file:grant` / `file:revoke` / `file:share-project`) | ✅ | `audit_log` ("📎 <ad>") |
| Veri yönetimi: "Dosyalar" istatistiği, proje başına sayı, proje temizliğinde "Dosyalar" parçası; sıfırlama ve proje silme sonrası GC | ✅ | |
| OCR (taranmış PDF / görsel metni) | ✅ | 2026-10-15: tesseract.js (WASM, native değil), İngilizce + Türkçe dil verisi pakette, **çevrimdışı** (ağsız ortamda paketlenmiş uygulamayla denendi). Görseller ve metin katmanı olmayan PDF sayfaları (en fazla 20 sayfa / 75 sn); "OCR ile okundu, hatalar olabilir" uyarısı. `files/ocr.ts`, `tests/ocr.test.ts` |
| Eski Office biçimleri (.doc / .xls / .ppt) ve .rtf okuma | ✅ | 2026-10-15: .doc (word-extractor), .xls (kendi BIFF8 okuyucusu, cfb), .ppt (kayıt ağacı, slayt sırası, notlar), .rtf (kendi ayrıştırıcısı, kod sayfaları). Parolalı ve Excel 95 dosyaları açık mesajla. `files/legacyOffice.ts`, `tests/files.legacy.test.ts` (fuzz dosyaları dahil) |

## 3e. Skill'ler — Organizasyon → Skill'ler

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| **Skill'ler** (Agent Skills biçimi: `SKILL.md` + dosyalar) | ✅ | `src/main/skills/`, `features/skills/`, migration v8, ADR-023 |
| Ekleme: GitHub adresi (`owner/repo`, `/tree/<ref>/<yol>`, `/blob/.../SKILL.md`; herkese açık depolar), klasör, `.zip`, tek `.md`, uygulamada yeni yaz | ✅ | Önce önizleme: bulunan skill'ler, dosya sayısı/boyutu, betik var mı, şüpheli satır uyarıları, "zaten kurulu" |
| Sınırlar: arşiv 50 MB, skill 10 MB, dosya 2 MB, 300 dosya; kaynaktaki hiçbir şey çalıştırılmaz | ✅ | `SKILL_LIMITS` |
| Atama: ajana doğrudan ya da birime (alt birimler dahil; kök = herkes); ajan düzenleyicide "Skill'ler" bölümü (nereden geldiği) | ✅ | `skill_assignments` |
| Ajanlar: prompt'ta `## Skills` (ad + açıklama), içerik `skill_read` ile (API, Claude Code, Demo); Codex çalışma kopyalarını okur; terminal izinli Claude Code betikli skill klasörünü alır | ✅ | `skills/service.ts` |
| Düzenle (SKILL.md), kaynaktan güncelle, devre dışı bırak, sil (satır içi onay) | ✅ | Düzenlenen skill kaynaktan güncellenince düzenleme kaybolur (uyarılır) |
| Özel (private) GitHub depoları | ✅ | 2026-10-15: anahtar zincirinde şifreli GitHub token'ı; yalnızca herkese açık indirme bulunamazsa ve yalnızca api.github.com'a gider |

## 3f. Uygulamalar (MCP) — Organizasyon → Uygulamalar

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| **Uygulamalar** (MCP sunucuları; Claude Desktop / ChatGPT bağlayıcıları gibi) | ✅ | `src/main/apps/`, `features/apps/`, migration v9, ADR-022 |
| Yerel program (stdio: komut, argümanlar, çalışma klasörü, ortam değişkenleri) | ✅ | Windows'ta `npx`/`.cmd` (SDK cross-spawn); çoğu sunucu için Node.js ya da uv gerekir |
| Uzak sunucu (Streamable HTTP, eski SSE'ye düşer; ek başlıklar) | ✅ | |
| OAuth ile giriş (tarayıcıda; dinamik istemci kaydı + PKCE; 127.0.0.1:33418 geri dönüş) | ✅ | SDK'nın demo yetkilendirme sunucusuyla test edildi; gerçek sağlayıcılarla (Notion, Linear…) denenmedi |
| JSON yapıştırarak ekleme (`mcpServers` / `servers` / README parçası) ve Claude Desktop'tan içe aktarma | ✅ | `parseMcpConfig`, `claude_desktop_config.json` |
| Sırlar (ortam değişkeni / başlık değerleri, OAuth token'ları) şifreli, UI'da yalnızca yazılır | ✅ | `safeStorage` |
| Araç başına politika: Otomatik / Önce bana sor / Kapalı (varsayılan: salt-okunur → otomatik, diğerleri sor) | ✅ | `mcp_tool_policies` |
| Ajan başına erişim (varsayılan reddet): uygulamanın "Erişim" sekmesi + ajan düzenleyicide "Uygulamalar" | ✅ | `mcp_permissions` |
| "Önce bana sor" araçları sol alttaki onay panelinde (argümanlarla; 10 dk sonra ret) + toast | ✅ | `waitForApproval` |
| Denetim: her ajan çağrısı (`app:<araç>`, sonuç, süre) ve kullanıcı işlemleri; uygulamanın "Denetim kaydı" sekmesi | ✅ | `audit_log` |
| Sağlayıcılar: Anthropic / OpenAI (yerel araç), Claude Code (MCP köprüsü), Codex (köprü `-c mcp_servers…`), Demo (adı geçen uygulamanın bir aracını dener) | ✅ | Codex ve Claude Code yalnızca sahte CLI'larla test edildi |
| MCP kaynakları (resources) ve istemler (prompts) | ✅ | 2026-10-15: `apps_resources`, `apps_read_resource`, `apps_prompts`, `apps_get_prompt` (okuma; izinli + açık uygulamalar; denetlenir). Sampling ve elicitation ⏳ |

## 3d. Yol haritası

Sahibin büyük özellik isteğinin üç fazı da tamam: **Faz 1** (§3a), **Faz 2** (§3b), **Faz 3** (§3c). Açık kalanlar
yukarıdaki ⏳ satırları ve "Bilinen sorunlar"dır.

## 4. Sol panel

| Özellik | Durum | Not |
|---|---|---|
| Running work: ajan · görev · durum, ilerleme çubuğu, süre | ✅ | `Sidebar.tsx` → `RunningWork`; tüm projeler, proje çipi (tıklayınca projeye geçer); Organizasyon sayfasında yalnızca bu bölüm |
| Running work: duraklat / devam / durdur | ✅ | CLI'da duraklatma süreci dondurmaz (geri basınç) |
| Running work: lider incelemesi / "yazıyor" gibi yan etkinlikler | ✅ | |
| Onay kartı (Onayla / Reddet, istenen yetkiler) | ✅ | |
| Ekip şeridi (avatar + durum noktası → ofiste seç) | ✅ | Aktif projenin ekibi |
| Live chat akışı + lidere hızlı mesaj | ✅ | Aktif projenin sohbeti ve lideri |

## 5. Orkestrasyon

| Özellik | Durum | Not |
|---|---|---|
| Otopilot (1,5 sn tick, boştaki ajana sıradaki görev) | ✅ | Ayarlar → Genel. Atanmış görevler tüm aktif projelerden; atanmamışlar yalnızca üyesi olup lideri olmadığı projelerden |
| Lider incelemesi (onay → Done, ret → To do + revizyon notu) | ✅ | Sıralı kuyruk; inceleyen = proje lideri |
| Onay gerektiren çalışmalar (`require_approval`) | ✅ | **Tüm sağlayıcılarda** (Anthropic / OpenAI dahil; model isteği onaydan önce yapılmaz) |
| Mola animasyonu (iş bitince 8–16 sn kahve molası) | ✅ | |
| Hata soğuması (45 sn), 2 hatada görevi bekletme | ✅ | Bekletme listesi **kalıcı** (`settings.orchestrator.held`): ret, durdurma, 2 hata, yarıda kalma, 4 inceleme turu; elle başlat / "Yapılacak"a taşı kaldırır |
| Kesin inceleme kararı | ✅ | Yalnızca gerçek boolean `approved` onaylar; belirsiz yanıtta görev incelemede kalır (kullanıcı karar verir) — `src/shared/review.ts`, `tests/review.test.ts` |
| Sohbet yanıtı / inceleme iptali; temizlik ve sıfırlamada işlerin gerçekten bitmesini bekleme | ✅ | `aux` kaydı, `settled()`; iptal edilen yanıt görev/karar oluşturmaz |
| API isteklerinde süre sınırı | ✅ | İstek başına 10 dk, bağlantı testi 20 sn |
| Görev çalışması başına süre / token / harcama tavanı | ✅ | 2026-10-15; Ayarlar → Güvenlik ve sınırlar. Aşılınca çalışma durur, görev bekletilir. Maliyeti yalnızca Claude Code bildirir; `--max-budget-usd` kullanılmıyor (tavan Agentbits'te zorlanır) |
| Kimlik hatası tespiti → Türkçe mesaj + tüm ekibi duraklatma | ✅ | Mesaj etkilenen projenin sohbetine düşer; "Devam et" hata durumlarını sıfırlar |
| Tümünü duraklat / devam et | ✅ | Yeniden açılışta da geçerli (`settings.orchestrator.paused`). CLI'da "duraklat" yalnızca çıktı okumayı bekletir |
| Uygulama yeniden açılınca yarım işleri temizleme | ✅ | Çalışmalar `cancelled`, görevler `todo` **ve bekletilir** (kendiliğinden yeniden başlamaz; görev akışında not) |
| Proje bağlamı prompt'ta (`## Project`: ad, açıklama, klasör) | ✅ | Çalışan ve lider sistem prompt'ları |
| Aynı klasörde eşzamanlı düzenleme çakışma yönetimi | ✅ | 2026-10-15: proje ayarı "Her görev kendi git çalışma kopyasında" (görev başına dal + worktree, biten görev birleşir, çakışma ajana döner; ADR-025). Kapalıyken: ekip farkındalığı + aynı dosyaya ikinci yazana uyarı |
| Ajanı çoğalt (ikiz: aynı rol, izinler, takımlar, erişimler) | ✅ | 2026-10-15; Organizasyon → Ajanlar → Çoğalt (`agents:duplicate`) |
| İş dağıtımı: lider aynı roldekilere dağıtır; boştaki ikiz meşgul ikizin sıradaki görevini devralır | ✅ | 2026-10-15; Ayarlar → Genel → "İkizler arasında iş paylaşımı" (varsayılan açık) |
| Görev bağımlılıkları (`"after"`), sonraki adım önceki raporları görür, kartta "… bekleniyor" | ✅ | 2026-10-15; migration v11; elle başlatma serbest |
| Yarış modu: aynı görev başka sağlayıcı/modeldeki ikinci üyeye de verilir, lider iki denemeyi karşılaştırıp birini tutar | ✅ | 2026-10-15; Ayarlar → Genel → "Yarış modu" (varsayılan kapalı, lider incelemesi gerekir, ~2 kat maliyet). Kartta 🏁 Yarış / Kazandı / Kaybetti. Klasörlü projede "Her görev kendi git çalışma kopyasında" açık olmalı; kaybedenin dalı silinir. Migration v14 |
| Ekip farkındalığı: "Team right now" + `team_status` aracı (kim, hangi görev, hangi dosyalar) | ✅ | 2026-10-15; `core/team.ts`. Dosya bilgisi Claude Code ve Demo'dan; Codex ve API sağlayıcıları dosya yazdığını bildirmez |

## 6. Sağlayıcılar

| Sağlayıcı | Durum | Not |
|---|---|---|
| Claude Code CLI (`claude -p`, stream-json, stdin prompt) | ✅ | Araçlar izin matrisinden; maliyet + token raporlu |
| Claude Code — "Test et" (`--version` + `claude auth status`) | ✅ | |
| Codex CLI (`codex exec`, sandbox) | 🟡 | Yalnızca toplam token ("tokens used: N", `partial`), maliyet yok; resume yok; `allowed_paths` desteklenmez |
| Anthropic API (Messages, SSE) | 🟡 | Dosya sistemi / terminal aracı yok (proje klasöründe dosya değiştiremez, komut çalıştıramaz); yalnızca Agentbits araçları (izinli bağlantılar §3b, dosya ekleri §3c, `file_save`); görsel/PDF blokları; token raporlu, maliyet ($) hesaplanmaz; `require_approval` uygulanır (2026-10-13'ten beri tüm sağlayıcılarda) |
| OpenAI API (Chat Completions, SSE) | 🟡 | Anthropic ile aynı sınırlar; görseller `image_url`, PDF yerel gönderilmez. **OpenAI uyumlu uç nokta** (2026-10-15): Google Gemini, Ollama, LM Studio ya da özel adres (`providers.base_url`); yerel sunucuda anahtar gerekmez, anahtar yalnızca HTTPS'e ya da localhost'a gider; uyumlu uçlara `max_tokens` gider ve token kullanımını bildirmeyebilirler |
| Demo / simülasyon (anahtarsız) | ✅ | Ofis, Kanban, sohbet, inceleme gerçekçi canlanır; atamayı proje ekibi içinde yapar (`RunContext.team`). İş türüne göre simüle eder (2026-10-15, `shared/demoKind.ts`): kod (dosya düzenler, test çalıştırır), araştırma (arar, karşılaştırır), içerik (taslak yazar), veri (tablo/metrik); rapor ve inceleme notları da türe uyar |
| Ajan başına sağlayıcı ve model seçimi | ✅ | Organizasyon → Ajanlar → Model; model listeden seçilir, "Sağlayıcının modeli" varsayılan; sağlayıcı türü değişince ajanın modeli sıfırlanır |
| Model seçimi açılır listeden (elle yazım yok) | ✅ | `features/settings/ModelSelect.tsx` + `src/shared/models.ts` (`MODEL_CATALOG`, `DEFAULT_MODEL`): sağlayıcı ekleme formu, Ayarlar → Sağlayıcılar (mevcut sağlayıcının modeli satırdan değişir), ajan düzenleyici. Önerilen liste kısa notlarla; Anthropic/OpenAI'de anahtarla hesabın canlı listesi (`providers:models`, "Hesabındaki diğer modeller", hesapta olmayan önerilenler işaretlenir); listede olmayan yeni model için "Özel model adı…". OpenAI'de GPT-6 listelenmez (Chat Completions'ta araç çağırmaz; Codex CLI'da var). Katalog 2026-10-13 itibarıyla — yeni modeller çıktıkça güncellenmeli |
| CLI otomatik bulma (`where` / `which`) | ✅ | |
| API anahtarı doğrulama (boş/boşluk kontrolü) | ✅ | Ajanlar ekledi (`ProviderForm`) |
| Hesapla (OAuth) giriş | 🟡 | Yalnızca CLI'ların kendi girişi (`claude auth login`, `codex login`) terminalde, uygulama dışında |
| Uygulama içinde Claude hesabı/aboneliğiyle giriş | — | Sunulmaz (Anthropic'in politikası); Claude için API anahtarı ya da kullanıcının kendi Claude Code girişi |
| CLI'ların uygulamayla gelmesi / kurulması | — | `claude` ve `codex` paketlenmez; kullanıcı kurar ve giriş yapar, Agentbits yalnızca bulur (`where` / `which`) ya da yol verilir |
| Gemini ve yerel modeller (Ollama, LM Studio) | ✅ | 2026-10-15: OpenAI sağlayıcısında "Uç nokta" seçimi (`shared/endpoints.ts`, `tests/endpoints.test.ts`); sahte yerel bir OpenAI uyumlu sunucuyla uçtan uca denendi (model listesi, akış, araç çağrısı, anahtarsız istek). Gerçek Gemini / Ollama ile denenmedi |

## 7. İzin matrisi

| Özellik | Durum | Not |
|---|---|---|
| Ajan başına `fs_read / fs_write / terminal / network / browser / require_approval` anahtarları | ✅ | Ayarlar → İzin Matrisi |
| Ek izinli klasörler (`allowed_paths` → `--add-dir`) | ✅ | Claude Code'da |
| Claude Code eşlemesi (`--tools`, `--allowedTools`, `--permission-mode`) | ✅ | Dosya araçları ön-onaylı değil; çalışma alanı dışı reddedilir |
| Codex eşlemesi (`--sandbox`) | ✅ | `read-only` / `workspace-write` (+ ağ izni varsa `sandbox_workspace_write.network_access`); **`danger-full-access` hiç seçilmez**; `fs_read` kapalı Codex ajanı çalışmaz |
| Claude Code ayar / hook yalıtımı | ✅ | 2.1.248+ `--restricted`, eskisi `--setting-sources user` (deponun `.claude` ayarları ve hook'ları yüklenmez); gerçek CLI ile denenmedi |
| Terminal izni açıkken dosya / ağ kısıtlarının kabukla aşılabildiğini UI'da söyleme | ✅ | İzin açıklaması; OS düzeyinde yalıtım yok (bkz. Bilinen sorunlar #8, #31) |
| Reddedilen araç çağrılarını uyarı olarak loglama | ✅ | `permission_denials` |
| CLI sağlayıcılarında proje klasörü zorunluluğu | ✅ | Klasör proje başınadır (`project.rootPath`) |
| `browser` izninin uygulanması | ✅ | 2026-10-15: `web_fetch` (tüm sağlayıcılar): herkese açık sayfa metin olarak; SSRF koruması (her adımda DNS + yalnızca genel adres, IP sabitleme), 3 MB / 20 sn. JavaScript ile içerik üreten sayfalar zayıf döner |
| İzinleri ajan ekranından yönetme | ✅ | Organizasyon → Ajanlar → İzinler (anında kaydedilir; Ayarlar → İzin Matrisi ile aynı `PERMISSIONS` listesi, senkron) |
| Yeni ajanda yetki şablonu (Salt okuma / Geliştirici / Tam yetki) | ✅ | İzinler ajanla aynı transaction'da yazılır |
| Bağlantı izinleri matrisi (ajan × bağlantı, varsayılan erişim yok) | ✅ | Ayarlar → İzin Matrisi → "Bağlantı izinleri"; bkz. §3b |

## 8. Ajan yönetimi

| Özellik | Durum | Not |
|---|---|---|
| Ajan oluştur / sil / aktif-pasif / lider yap | ✅ | Organizasyon → Ajanlar (Ayarlar → Ajanlar yalnızca yönlendirme notu) |
| Benzersiz ad kontrolü (büyük/küçük harf duyarsız + UNIQUE) | ✅ | Hata: "Bu isimde bir ajan zaten var: <ad>"; boş ad güncellemede reddedilir |
| Lider ajanın silinmesini engelleme | ✅ | Hem UI'da hem main'de (`agents:delete`) |
| Ad, rol, kişilik, sağlayıcı, model, kıyafet/saç/ten rengi | ✅ | Alan bırakılınca (`onBlur`) kaydedilir |
| İş tanımı (job description) ve yetenekler (skills) | ✅ | Migration v2; yetenekler kırpılır ve tekilleştirilir |
| İş tanımı / yeteneklerin prompt'lara girmesi | ✅ | Çalışan: "## Job description", "## Skills"; lider ekip listesinde rol + yetenek + ~160 karakter iş tanımı görür ve atamayı buna göre yapar |
| Demo sağlayıcıda yeteneğe göre atama | ✅ | `assigneeFor`: önce yetenek / iş tanımı kelimeleri, sonra rol anahtar kelimeleri, sonra sırayla |
| Hazır ekiplerde Türkçe iş tanımı ve yetenekler | ✅ | Başlangıç ekibi artık seed değil, "Çekirdek Ekip" şablonu (2026-10-13) |
| Ayrı "Agents" üst sekmesi | — | **Kaldırıldı** (2026-10-12): ajanlar Organizasyon → Ajanlar'da; `Ctrl+3` artık proje Ekip bölümü |

## 9. Hafıza ve kararlar

| Özellik | Durum | Not |
|---|---|---|
| SQLite FTS5 kalıcı hafıza, skorlu geri çağırma | ✅ | bm25 × 0.6 + önem × 0.3 + tazelik × 0.1 |
| Otomatik hafıza yazımı (görev özeti, inceleme notu, uzun kullanıcı mesajı, kabul edilen karar) | ✅ | |
| Ayarlar → Hafıza: arama, ekleme (ortak / ajana özel), silme | ✅ | Kapsam seçici: Organizasyon geneli / Bu proje |
| Proje kapsamlı hafıza (geri çağırma = proje + organizasyon geneli) | ✅ | Görev özetleri, inceleme notları, sohbet ve kabul edilen kararlar projeye yazılır |
| Anlamsal (vektör) hafıza — isteğe bağlı | ✅ | 2026-10-15; Ayarlar → Hafıza → "Anlamsal hafıza" (varsayılan kapalı): OpenAI uyumlu bir sağlayıcı (OpenAI, Gemini, Ollama, LM Studio) + embedding modeli seçilir; hafızalar arka planda dizinlenir, geri çağırma kelime + anlam (`max(bm25, kosinüs)`). Sağlayıcı yanıt vermezse yalnız kelimeler. Yerel sunucuda metin bilgisayardan çıkmaz. Migration v15, ADR-027 |

## 10. Veri yönetimi (Ayarlar → Veri yönetimi)

| Özellik | Durum | Not / ilgili kod |
|---|---|---|
| Kullanım özeti: DB / WAL / yedek boyutları, veri klasörü, proje başına sayılar | ✅ | `data:usage` → `dataUsage()`; `features/settings/DataSection.tsx` |
| Proje bazlı temizlik ("Temizle…"): proje hafızası, sohbet, çalışma kayıtları, raporlar, kararlar, görevler, dosyalar (kayıtlar; klasördeki dosyalara dokunulmaz) — seçmeli | ✅ | `clearProject()`; görev ya da çalışma kaydı silinecekse projede koşan işler önce durdurulur; isteğe bağlı karar hafızasını koru; ajanlar, takımlar ve klasördeki dosyalar korunur |
| Proje modalından kısayol ("Hafızayı ve geçmişi temizle → Verileri yönet") | ✅ | `openSettings('data', projectId)` — ilgili proje açık gelir |
| Organizasyon geneli hafızayı temizleme (kararları koruma seçeneği) | ✅ | `clearOrgMemory()` |
| Log saklama süresi (7 / 30 / 90 / 365 gün / Süresiz), açılışta ve 6 saatte bir otomatik; "Şimdi uygula" | ✅ | `settings.logRetentionDays` (varsayılan 30), `startMaintenance()` / `pruneLogs()` |
| Ayarlar → **Güvenlik ve sınırlar**: görev çalışması başına süre (varsayılan 120 dk) / token / maliyet tavanı, denetim kaydı saklama süresi (varsayılan 180 gün), ajan CLI'larına aktarılacak ek ortam değişkenleri | ✅ | 2026-10-15; `LimitsSection.tsx`, `shared/settingsRules.ts` (`agentEnv`, `validateSettingsPatch`, `DEFAULT_SETTINGS`), `tests/settings.test.ts` |
| Transkriptlerde sır maskeleme (API anahtarı, token, özel anahtar, URL parolası, `password=…`) | ✅ | 2026-10-15; `shared/redact.ts`, `logsRepo.add`; kalıp tabanlı |
| Durdurulan çalışmanın DB sorgusu / SSH komutu hemen kesilir | ✅ | 2026-10-15; `shared/cancel.ts`, `tests/cancel.test.ts` |
| IPC argüman şeması (127 metot) ve yerel yol yetkisi (dosya penceresi / gerçek sürüklenen dosya; başka yol için yerel onay) | ✅ | 2026-10-15; `shared/ipcSchema.ts`, `main/pathGrants.ts` |
| Büyük veri: panoda proje başına en yeni 200 bitmiş görev ("N eski görevi göster"), raporlarda proje başına 300 ("Daha eski raporları göster"), dosya deposu kotası (varsayılan 5 GB) | ✅ | 2026-10-15; `tasks:board`, `reports:list(perProject)`, `filesQuotaMb`. Yüklenmemiş eski bir göreve sohbet bağlantısıyla gidilirse çekmece açılmaz (önce "eski görevleri göster") |
| Yedek alma (`VACUUM INTO`), listeleme, silme, klasörü açma; son 10 yedek tutulur | ✅ | `<veri klasörü>/backups/` |
| Yedekten geri yükleme (mevcut durum önce yedeklenir, uygulama yeniden başlar; eski yedekler açılışta migrate edilir) | ✅ | `restoreBackup()` |
| Tehlikeli bölge: "Sadece çalışma verisini sil" / "Her şeyi sıfırla" — "SIFIRLA" yazarak onay, öncesinde otomatik yedek | ✅ | `factoryReset('work' \| 'all')` |

## 11. Paketleme

| Özellik | Durum | Not |
|---|---|---|
| `npm run build` / `npm start` | ✅ | |
| `npm run dist` / `dist:win` → `release/Agentbits-Setup-<sürüm>.exe` (NSIS, x64) | ✅ | `electron-builder.config.js`; adımlı kurulum sihirbazı (kapsam "benim için / herkes", klasör seçimi, masaüstü + Başlat kısayolu, lisans); `--publish never` (yayınlamaz); `asarUnpack` `better-sqlite3`, `@lydell/node-pty*`, MCP sunucusu, dosya worker'ı |
| Kod imzalama (Windows / macOS) | 🟡 | Yalnızca ortam değişkenleri/secret'lar tanımlıysa (`WIN_CERT_SUBJECT` ya da `CSC_LINK`; Apple sertifikası + noterlik). Varsayılan paketler **imzasız** → SmartScreen / Gatekeeper uyarısı; `docs/DEVELOPMENT.md` §8 |
| Yeni sürümün yerinde kurulması | ✅ | Sabit `appId` (`app.agentbits.desktop`): yeni exe eskisini değiştirir; her sürümde `package.json` → `version` artırılmalı; her kurulumda aynı kapsam seçilmeli |
| Güncelleme ve kaldırmada kullanıcı verisinin korunması | ✅ | `%APPDATA%\Agentbits` (DB, yedekler, dosyalar) dokunulmaz (`deleteAppDataOnUninstall: false`); şema açılışta migrate edilir |
| Otomatik güncelleme (uygulama içi denetim/indirme) | — | Yok (`electron-updater` yok; `publish` ayarı yalnızca ileride kullanılırsa) |
| macOS DMG (arm64 + x64, ad-hoc imza) | 🟡 | `npm run dist:mac` yalnızca macOS'ta / Actions'ta; **henüz gerçek bir Mac'te derlenip denenmedi** |
| GitHub Actions paket iş akışı (Windows + macOS; yalnızca elle, `release_tag` verilirse taslak Release) | 🟡 | `.github/workflows/release.yml` (typecheck + `test:unit` + paket). Release'e yalnızca exe, iki dmg ve `SHA256SUMS-*.txt` yüklenir (blockmap / `latest*.yml` / Mac zip yok, 2026-10-15). İki paket de CI'da derlenir (macOS paketi gerçek bir Mac'te hâlâ denenmedi) — macOS düşse de taslak Release Windows dosyalarıyla oluşur. Action'lar Node 24 sürümlerinde (checkout/setup-node/upload-artifact v7, download-artifact v8) |
| Linux paketi | — | Hedef yok; Linux'ta yalnızca kaynaktan (`npm run dev` / `npm start`) |
| Lisans ve üçüncü taraf bildirimleri | ✅ | PolyForm Strict 1.0.0 (`LICENSE`, kurulum sihirbazında ve `resources/LICENSE.txt`); `THIRD_PARTY_NOTICES.md` pakette (`npm run notices` ile yeniden üretilir) |
| GitHub Releases'te yayımlanmış kurulum dosyası | ✅ | v0.1.0 yayımlandı (2026-10-14): Windows exe + macOS DMG/ZIP (imzasız; macOS gerçek Mac'te denenmedi) + SHA256SUMS. CI'da derlenir: Actions → Build packages → `release_tag` (DEVELOPMENT §9.3) |

## 12. Kapsam dışı — Agentbits'in yapmadıkları

Kullanıcıya dürüstçe söylenmesi gerekenler (kodla doğrulandı, 2026-10-13). ⏳ = planlı/olası, — = yok.

| Yapmadığı | Durum | Not |
|---|---|---|
| Kendini güncellemek | — | Yeni sürüm yeni kurulum dosyasıyla kurulur; veriler korunur (§11) |
| Claude Code / Codex CLI'ı getirmek, kurmak ya da oturum açmak | — | Kullanıcı kurar ve terminalde giriş yapar; Agentbits yalnızca çalıştırır |
| Uygulama içinde Claude hesabı/aboneliğiyle giriş | — | Anthropic'in politikası nedeniyle sunulmaz; API anahtarı ya da kullanıcının kendi Claude Code girişi |
| OpenAI uyumlu olmayan sağlayıcılar | ⏳ | Claude Code CLI, Codex CLI, Anthropic API, OpenAI API (+ OpenAI uyumlu uç noktalar: Gemini, Ollama, LM Studio, özel adres), Demo |
| API sağlayıcılarıyla dosya düzenleme / komut çalıştırma | — | Anthropic/OpenAI ajanları yalnızca metin + Agentbits araçları (bağlantılar, dosya ekleri); kod değişikliği için CLI sağlayıcısı gerekir |
| API'lerde maliyet ($) hesabı, proje bütçesi | — | Token sayılır; $ yalnızca Claude Code bildirirse görünür. Görev çalışması başına süre / token / $ tavanı var (2026-10-15, Ayarlar → Güvenlik ve sınırlar; $ tavanı yalnızca Claude Code'da işler); proje ya da aylık bütçe yok |
| Bulut senkronizasyonu, çok kullanıcı, ekip hesabı, uzaktan erişim | — | Tek makine, tek kullanıcı; her şey yerel SQLite'ta (`%APPDATA%\Agentbits`) |
| Uygulama içi hesap / giriş | — | Tek kullanıcılı masaüstü uygulaması; sahte giriş ekranı kaldırıldı (Bilinen sorunlar #1) |
| Telemetri / analitik, Agentbits sunucusu | — | Ağ trafiği yalnızca seçilen sağlayıcılara (anlamsal hafıza açıksa embedding için seçilen sağlayıcıya da), CLI'ların kendisine, tanımlı bağlantılara, eklenen uygulamalara (MCP), skill ya da paylaşım paketi kurulurken GitHub'a, `web_fetch` izni olan ajanın okuduğu sayfalara, Browser sekmesine ve tıklanınca destek sayfasına (sistem tarayıcısında) |
| Ajanların JavaScript çalıştıran tam tarayıcı kullanması | ⏳ | `web_fetch` sayfayı metin olarak okur (2026-10-15); tıklama / form / JS yok |
| Codex CLI ile bağlantı / dosya araçları | ✅ | 2026-10-15: köprü üzerinden; ekler ayrıca prompt bütçesiyle ve `--image` ile |
| Uygulama (MCP) sunucularını kurmak, Node.js / uv getirmek | — | Kullanıcı sunucunun komutunu ya da adresini verir; Agentbits yalnızca bağlanır |
| MCP sampling / elicitation | ⏳ | Kaynaklar ve istemler var (2026-10-15) |
| Özel GitHub depolarından skill | ✅ | Token ile (2026-10-15) |
| Zamanlanmış / tekrarlanan görev, son tarih | — | Görevler sohbetten, elle ya da talimatla oluşur; otopilot yalnızca sıradakini alır |
| İşletim sistemi bildirimleri | — | Yalnızca uygulama içi toast'lar ve rozetler |
| Git entegrasyonu (PR, uzak depoya gönderme) | — | Yalnızca proje ayarı "Her görev kendi git çalışma kopyasında" açıkken Agentbits yerel dal / commit / birleştirme yapar (ADR-025); push, PR, uzak depo yok |
| Aynı klasörde eşzamanlı düzenleme çakışma yönetimi | ✅ | Proje ayarı: görev başına git worktree (ADR-025) |
| El yazısı ve karmaşık düzen OCR'ı | ⏳ | OCR basılı metin içindir; tablolar ve çok sütunlu düzen yaklaşık |
| Ajanların dosya eklerini değiştirmesi / silmesi | — | Bilinçli: ajanlar yalnızca okur, `file_save` yalnızca yeni metin dosyası (ADR-021) |
| Proje klasörlerinin yedeklenmesi | — | Yedek yalnızca veritabanıdır; proje klasörü ve dosyaları silinmez de |
| Vektör (embedding) hafıza | ✅ | İsteğe bağlı, sağlayıcının embedding uç noktasıyla (2026-10-15, ADR-027, §9) |
| Paylaşım galerisi (çevrimiçi paket vitrini) | ⏳ | Bugün: `.agentbits` dosyası ve GitHub bağlantısıyla içe aktarma (§2) |
| Doğrulanmış macOS paketi, Linux paketi, web / mobil sürüm | — | macOS yapılandırması var ama denenmedi; Linux yalnızca kaynaktan; yalnızca Electron masaüstü |

## Bilinen sorunlar / gözden geçirilmeli

Aşağıdaki ilk dört madde, test sırasında çalışma alanı Agentbits deposunun kendisine ayarlıyken
**Agentbits'in kendi ajanlarının sahibin makinesinde otonom olarak yaptığı değişikliklerdir** (seed
görevleri TA-1, TA-2, TA-4 ile örtüşür). Şu an kodda bulunuyorlar; sahibin kararı bekleniyor. Aynı yolla
sonradan TA-3 (`docs/TEST_SCENARIOS_KANBAN.md`), TA-4 (paketleme — #4) ve TA-5 (WCAG kontrast denetimi) de
eklendi; bunlar CHANGELOG'da kayıtlı ve gözden geçirilmeli.

1. ~~**Sahte giriş ekranı**~~ — **Kaldırıldı (2026-10-13, sahibin kararı).** Eski açıklama: `src/renderer/src/features/auth/LoginView.tsx` + `App.tsx`'teki kapı.
   Yalnızca istemci tarafı doğrulama yapar; geçerli görünen **her** e-posta/parolayı (≥8 karakter) kabul
   eder ve `sessionStorage['agentbits:loggedIn'] = '1'` yazar. Arka uç yok, **gerçek kimlik doğrulama
   değildir** ve her uygulama açılışında tekrar sorulur. Karar bekliyor: kaldır / gerçek auth ile değiştir / tut.
2. **`tasks:list` cursor sayfalamaya çevrildi** (`TaskListOpts`, `TaskPage`, `tasksRepo.list(opts)` +
   `tasksRepo.listAll()`); renderer ardından tüm sayfaları gezecek şekilde uyarlandı (`fetchAllTasks`).
   Çalışıyor, ancak pano yine tüm görevleri yüklediği için pratik fayda sınırlı. Gözden geçirilmeli.
3. **`ProviderForm` API anahtarı doğrulaması** (boş / boşluk kontrolü). Zararsız; tutulabilir.
4. ~~**`package.json` → `build`**: Eksik dosyalar yüzünden `npm run dist` başarısız oluyordu.~~ **Düzeltildi** (TA-4): `electron-builder.config.js` oluşturuldu; `build-resources/icon.ico`, `installer.nsh` ve `LICENSE` eklendi; imza `WIN_CERT_SUBJECT` env varıyla koşullu. (`installer.nsh` sonradan kaldırıldı; NSIS ayarları yalnızca `electron-builder.config.js` → `nsis`'te.)
5. ~~Terminal pipe tabanlı~~ — **Düzeltildi (Faz 1):** Kabuklar node-pty ile gerçek PTY. Yalnızca node-pty yüklenemezse
   "Pipe modu"na düşülür; o modda tam ekran uygulamalar çalışmaz, `Ctrl+C` yalnızca yazılan satırı siler.
6. CLI çalışmasında "duraklat" süreci dondurmaz; yalnızca çıktı okumayı bekletir (süreç arka planda devam edebilir).
7. ~~Aynı çalışma alanında birden fazla ajan aynı anda dosya düzenleyebilir~~ — **2026-10-15:** proje ayarıyla görev başına git worktree (ADR-025). Ayar kapalıyken (varsayılan) yalnızca farkındalık ve uyarı var; worktree modunda ana klasör yalnızca görev bitince değişir ve kopyalarda `node_modules` gibi izlenmeyen dosyalar yoktur (gerekirse ajan kurar).
8. Terminal izni olan ajan kabukta her komutu çalıştırabilir (`Bash` ön-onaylı) — yalnızca güvenilen ajanlara verin.
9. API sağlayıcıları (Anthropic/OpenAI) dosya sistemi ve terminal aracı kullanmaz: görevlerde proje klasörüne dokunmaz,
   yalnızca metin ve Agentbits araçları (izinli bağlantılar, dosya ekleri, `file_save`, skill'ler, uygulamalar) kullanır;
   `require_approval` 2026-10-13'ten beri onlarda da uygulanır.
10. ~~`safeStorage` kullanılamazsa anahtar `plain:` base64 olarak saklanır~~ — **Düzeltildi:** güvenli anahtar deposu yoksa sır kaydı açık hatayla reddedilir; eski `plain:` değerler anahtar zinciri çalışınca şifrelenir.
11. ~~Orkestratörün `blocked` listesi bellektedir~~ — **Düzeltildi:** bekletme listesi ve genel duraklatma kalıcı; yarıda kalan görevler açılışta bekletilir.
12. ~~`permissions.ts` → `isPathAllowed()` kullanılmıyor~~ — **Kaldırıldı (2026-10-15):** yol sınırı CLI'larda (`--add-dir`, Codex `workspace-write`) zorlanır; `file_save` diske değil uygulamanın dosya deposuna yazar.
13. Otomatik test `npm run test:unit` (güvenlik incelemesindeki olumsuz örnekler dahil) ve `.github/workflows/ci.yml` (her push/PR'da typecheck + test + build + `npm audit --omit=dev --audit-level=critical`, Windows + Ubuntu). Lint ve UI/entegrasyon testi yok; paket iş akışı (`release.yml`) yalnızca elle çalışır. Elle senaryolar: `docs/TEST_SCENARIOS_KANBAN.md`.
14. Şablondan kurulan ajanlar "Onay iste" açık başlar — ilk çalışmalarda sol panelde onay kartları beklenmeli.
15. "Yazıyor…" göstergesi ajanın genel durumudur (proje bazlı değil); başka projede yazan ajan da yazıyor görünür.
16. Terminal kabukları projeler arasında ortaktır (yalnızca çalışma listesi projeye göre süzülür); yeni kabuk aktif projenin klasöründe (yoksa varsayılan projeninkinde) açılır.
17. Bir projede 10'dan fazla çalışan masa paylaşır.
18. `settings.workspaceRoot` artık yalnızca varsayılan projeyle senkron tutulan eski bir ayardır; diğer projelerin klasörü `projects.root_path`'tedir.
19. Yedekler yalnızca SQLite veritabanını kapsar; proje klasörlerindeki dosyalar yedeklenmez ve geri yükleme/sıfırlama onlara dokunmaz.
20. "Her şeyi sıfırla" kayıtlı API anahtarlarını da siler (yedekte şifreli halleri durur; DPAPI nedeniyle yalnızca aynı kullanıcı/makinede geri yüklenebilir). Yedek klasörü sıfırlamada silinmez.
21. Proje temizliğinde "Çalışma kayıtları" ya da "Görevler" seçilirse projede koşan işler durdurulur (ikisinin de ipucunda yazar); silinen çalışmalar yalnızca bitmiş olanlardır.
22. Proje klasörü doğrulaması yalnızca `rootPath` **değiştiğinde** yapılır: v4 öncesinden kalan bir projenin klasörü uygulama klasörünü ya da başka projenin klasörünü gösteriyorsa kendiliğinden düzeltilmez (seçicide/ProjectModal'da "klasör bulunamadı" uyarısı yalnızca kayıp klasörler için). Klasörü değiştirmek gerekir.
23. Açık proje yokken orkestratör yine tüm aktif projelerde çalışır (sekme açmak yalnızca görünümü etkiler); otopilotu durdurmak için "Tümünü duraklat" ya da projeyi arşivleme kullanılmalı.
24. Ajan CLI oturumları TTY değildir: ajan bölmelerine doğrudan yazılamaz (yalnızca talimat gönderilir); etkileşimli giriş yalnızca **Kabuklar**'da.
25. Claude Code'da "Yönlendir" süreci sonlandırır (Windows'ta `taskkill`); kesilen tur oturumda yarım kalır (Claude Code'un belgelenmiş davranışı) ve sonraki tur `--resume` ile devam eder.
26. Codex token ayrımı (giriş/çıkış/önbellek) ve resume desteklemez; talimatta geçmiş metin olarak yeniden oynatılır.
27. Log saklama süresi (varsayılan 30 gün) ajan transkriptlerini de budar.
28. Kabuk süreçleri uygulama yeniden başlayınca yaşamaz ve kaydırma geçmişleri kaydedilmez (ajan transkriptleri kaydedilir).
29. Faz 1 Demo sağlayıcı ve sahte bir stream-json Claude CLI ile test edildi; **gerçek Claude Code CLI ile henüz test edilmedi** (`--resume`, maliyet tekilleştirme, araç sonuçları).
30. Proje silindiğinde `token_usage` satırları geçmiş olarak kalır (tüm zamanlar toplamı doğru kalsın diye); yalnızca fabrika sıfırlaması siler.
31. **Bağlantı izinleri makinedeki kimlik bilgilerini kapsamaz:** Terminal (Bash) **ve** ağ izni olan bir ajan, makinede bulunan anahtar/parolalarla (`~/.ssh`, `.pgpass`, ortam değişkenleri) sunuculara ve veritabanlarına doğrudan bağlanabilir. Yalnızca bağlantıları kullanması gereken ajanlara Bash/ağ vermeyin ya da Agentbits'i kısıtlı bir OS kullanıcısıyla çalıştırın.
32. MCP köprü token'ı yerel süreçlere görünür (MCP yapılandırma dosyası / süreç ortamı); ancak yalnızca o ajanın zaten sahip olduğu yetkiyi ve yalnızca çalışma süresince verir.
33. SQL sınıflandırması sezgiseldir; bu yüzden ajan okumaları yalnızca SELECT yetkili DB girişiyle çalışır (salt-okunur giriş alanı zorunlu; boşsa ajan okuyamaz). Yazma / admin sorguları ana kullanıcıyla çalışır. PG/MySQL'de salt-okunur işlem yazmaları da engeller (`nextval()` reddedildi); SQL Server'da salt-okunur işlem yoktur.
34. MySQL ve SQL Server sürücüleri yalnızca bağlantı hatası yolunda test edildi (sunucu yoktu); PostgreSQL PGlite'a (soket), SSH yerel bir ssh2 sunucusuna karşı test edildi.
35. `ssh2`'nin opsiyonel native kripto eklentisi Build Tools olmayan Windows'ta `npm install` sırasında derleme uyarısı basabilir; saf JS'e düşer (işlevsel sorun yok).
36. Denetim kaydı varsayılan 180 gün saklanır (Ayarlar → Güvenlik ve sınırlar; 2026-10-15 öncesi süresizdi). Codex CLI'da bağlantı araçları yok. İzin değişiklikleri sonraki çalışmada ya da araç çağrısında geçerli olur (çalışan prompt'u güncellenmez).
37. Dosyalar — OCR (2026-10-15): taranmış PDF sayfaları ve görseller OCR ile okunur; tanıma hatalı olabilir (uyarı gösterilir), en fazla 20 sayfa / 75 sn, el yazısı desteklenmez. Görseller ayrıca görsel destekleyen sağlayıcılara gider (Demo'da görsel yok).
38. Eski .doc / .xls / .ppt ve .rtf okunur (2026-10-15); parolalı Office dosyaları ve Excel 5.0/95 okunmaz. DOCX üst/alt bilgi, dipnotlar ve belge içi görseller çıkarılmaz. XLSX'te önbellekli değeri olmayan formüller `=FORMÜL` olarak görünür. PDF'te yalnızca metin katmanı; düzen ve tablolar yaklaşık.
39. Talimat benzeri satır tespiti sezgiseldir; içerik her durumda güvenilmeyen veri olarak işlenir.
40. OpenAI'ye PDF yerel olarak gönderilmez; tool mesajları yalnızca metin olduğundan `file_read` görselleri ayrı bir kullanıcı turu olarak eklenir.
41. Codex'in `--image` bayrağı yalnızca sahte bir codex ile test edildi; Codex dosyalarda sayfalanamaz (araç yok, yalnızca prompt bütçesi; sığmayan parçalar için açık not).
42. Çalışma sonrası klasör taraması mtime tabanlı ve sınırlıdır (≤20 000 girdi, 3 sn, 40 kayıt; `.git`, `node_modules`, `dist`, `build`, `out`, `venv`, `target`, nokta klasörleri atlanır): çalışma sırasında başka süreçlerin değiştirdiği dosyaları kaçırabilir ya da fazladan alabilir.
43. Yedekler çıkarılmış metni içerir ama orijinal baytlar `<veri klasörü>/files`'ta kalır; bir yedeğin başvurduğu orijinaller o yedek silinene kadar tutulur. Dosya başına 50 MB, gönderim başına 20 dosya.
44. Uygulamalar (MCP) — yerel (stdio) sunucular kullanıcının OS yetkileriyle çalışan programlardır; Agentbits onları kısıtlayamaz. Yalnızca güvenilen sunucuları ekleyin.
45. Araçların "salt-okunur" / "yıkıcı" işaretleri sunucunun beyanıdır; varsayılan politika bunlara göre seçilir. Emin olmadığınız araçları "Önce bana sor"da tutun.
46. Uygulama araç sonuçları güvenilmeyen veri olarak işaretlenir ama prompt enjeksiyonuna karşı garanti değildir (e-posta gövdesi gibi içerikler talimat içerebilir).
47. Codex'te uygulama köprüsü `-c mcp_servers.agentbits.*` ve `default_tools_approval_mode="approve"` ile verilir (belgelere göre); gerçek Codex CLI ile denenmedi. Claude Code'da da yalnızca sahte CLI ile test edildi.
48. OAuth yalnızca SDK'nın demo yetkilendirme sunucusuyla test edildi; geri dönüş portu (33418) doluysa rastgele port ve yeni istemci kaydı kullanılır. İstemci kaydı ön tanımlı `client_id` isteyen sağlayıcılar desteklenmez.
49. Skill'ler yalnızca herkese açık GitHub depolarından indirilebilir; betikler yalnızca ajanın terminal izniyle çalışabilir ve Agentbits tarafından denetlenmez.
50. **Güvenlik incelemesi (2026-10-13)** — 27 bulgunun durumu, yapılanlar ve açık kalanlar: [SECURITY.md](SECURITY.md). Açık kalanların özeti: Claude Code terminal izni OS düzeyinde yalıtılmaz; tam prompt'lar (sırlar maskeli) transkriptte saklanır; paketler imzasız.
51. Testler için `AGENTBITS_ALLOW_PLAIN_SECRETS=1` gereklidir (CI / Linux kapsayıcılarında anahtar zinciri yok); gerçek kullanımda bu değişkeni ayarlamayın.
52. `--restricted` (Claude Code 2.1.248+) ve Codex `sandbox_workspace_write.network_access` / `default_tools_approval_mode` belgelere göre kullanıldı, gerçek CLI'larla denenmedi. Claude Code'da bir sorun çıkarsa CLI'ı güncelleyin; eski sürümler `--setting-sources user` alır.
