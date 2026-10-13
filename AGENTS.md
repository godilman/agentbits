# AGENTS.md

Bu depoda çalışan **Claude dışı kodlama ajanları** (Codex, Cursor, Aider vb.) için kısa yönlendirme.

## Önce CLAUDE.md'yi okuyun

Projenin ne olduğu, teknoloji yığını, komutlar, depo haritası ve uyulması gereken kurallar
**[CLAUDE.md](CLAUDE.md)** dosyasındadır. Oradan `docs/` altındaki ayrıntılı belgelere bağlantı verilir:

- [docs/PROJECT.md](docs/PROJECT.md) — vizyon, sekmeler, sözlük
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — süreç modeli, IPC, orkestratör, sağlayıcılar, ofis motoru
- [docs/DATABASE.md](docs/DATABASE.md) — SQLite şeması ve migration kuralları
- [docs/FEATURES.md](docs/FEATURES.md) — özellik durumu ve bilinen sorunlar
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — kurulum, sorun giderme, kod kuralları
- [docs/I18N.md](docs/I18N.md) — çoklu dil (dil dosyaları, kurallar, yeni dil ekleme)
- [docs/CHANGELOG.md](docs/CHANGELOG.md) — değişiklik geçmişi
- [docs/DECISIONS.md](docs/DECISIONS.md) — mimari kararlar (ADR)

## Kısaca en kritik kurallar

- Doğrulama: her değişiklikten sonra `npm run typecheck`, `npm run test:unit` (çeviri denetimi dahil) ve `npm run build`
  hatasız geçmeli.
- IPC sözleşmesi `src/shared/ipc.ts` (`Api`) + `src/main/ipc.ts` (`handlers`); renderer `call()` kullanır.
- Zustand seçicisinde yeni dizi/nesne üretmeyin; `useMemo` kullanın.
- Migration'lar yalnızca eklenir (`src/main/db/schema.ts`); uygulanmış olanı düzenlemeyin.
- UI iki dilli (İngilizce + Türkçe): kullanıcıya görünen her metin `src/shared/locales/en/` ve `tr/` dosyalarına aynı
  anahtarla eklenir, kodda `t('bölüm:anahtar')` kullanılır — sabit metin yazılmaz ([docs/I18N.md](docs/I18N.md)).
  Kod/yorumlar İngilizce.
- Görev, mesaj, çalışma, karar, rapor ve proje hafızası her zaman `projectId` ile yazılır; görünümler aktif projeye göre süzer.
- Bu depoyu asla bir Agentbits projesinin klasörü (`project.rootPath`) yapmayın — ajanlar kodu gerçekten değiştirir.

## Belgeleri güncel tutma kuralı (ZORUNLU)

Her değişiklikten sonra, işi bitti saymadan önce:

1. `docs/FEATURES.md` — özellik durumunu güncelleyin.
2. `docs/CHANGELOG.md` — en üste tarihli kayıt ekleyin (en yeni üstte).
3. Yapı, IPC veya orkestratör değiştiyse `docs/ARCHITECTURE.md`; şema değiştiyse `docs/DATABASE.md`;
   kalıcı teknik karar aldıysanız `docs/DECISIONS.md`.

Ayrıntılı kontrol listesi CLAUDE.md'nin "Belgeleri güncel tutma kuralı" bölümündedir.
