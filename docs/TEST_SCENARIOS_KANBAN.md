# Test Senaryoları — Kanban Sürükle-Bırak (TA-3)

> Yazar: Zeynep (QA Engineer) · Tarih: 2026-10-12  
> Kapsam: `TasksView.tsx` → `ipc.ts:tasks:move` → `tasksRepo.move()` → SQLite kalıcılığı

---

## Kod Akışı

```
Kullanıcı bırakır
  → TasksView.onDrop()                    [src/renderer/src/features/tasks/TasksView.tsx]
  → optimistik setState({ tasks: ... })   [Zustand store güncellenir, UI anında değişir]
  → call('tasks:move', id, status, sortOrder)  [src/renderer/src/lib/api.ts]
  → ipc.ts: 'tasks:move' handler          [src/main/ipc.ts]
  → tasksRepo.move(id, status, sortOrder) [src/main/db/repos.ts]
  → UPDATE tasks SET status=?, sort_order=? WHERE id=?  [SQLite WAL]
  → emit({ type: 'tasks:changed' })       [src/main/events.ts]
  → store.refresh('tasks')                [renderer güncellenir]
```

---

## Test Senaryoları

### TC-01 — Temel sütun değişikliği: `todo` → `in_review`

| Alan | Değer |
|---|---|
| Önkoşul | DB'de `status='todo'` olan bir görev var (TA-1) |
| Adım 1 | TA-1 kartını "In Review" sütununa sürükle |
| Adım 2 | Bırak |
| Beklenen (UI) | Kart anında "In Review" sütununda görünür (optimistik) |
| Beklenen (DB) | `SELECT status FROM tasks WHERE key='TA-1'` → `in_review` |
| Beklenen (olay) | `tasks:changed` olayı yayınlanır, store yenilenir |

---

### TC-02 — Geri dönüş: `in_progress` → `todo`

| Alan | Değer |
|---|---|
| Önkoşul | `status='in_progress'` olan bir görev var |
| Adım | Kartı "Todo" sütununa sürükle-bırak |
| Beklenen (UI) | Kart "Todo" sütununda görünür |
| Beklenen (DB) | `status='todo'` |
| Risk | Orchestrator çalışan görevi yeniden `in_progress`'e alabilir — yarış koşulu |

---

### TC-03 — Tamamlama: `in_review` → `done`

| Alan | Değer |
|---|---|
| Önkoşul | `status='in_review'` olan bir görev var |
| Adım | Kartı "Done" sütununa sürükle-bırak |
| Beklenen (UI) | Kart "Done" sütununda görünür |
| Beklenen (DB) | `status='done'` |
| Not | `completed_at` alanının güncellenip güncellenmediği de kontrol edilmeli |

---

### TC-04 — Sıralama değişikliği (aynı sütun içinde)

| Alan | Değer |
|---|---|
| Önkoşul | "Todo" sütununda en az 2 görev var (TA-1 üstte, TA-2 altta) |
| Adım | TA-2'yi TA-1'in üstüne sürükle |
| Beklenen (UI) | TA-2 üstte görünür |
| Beklenen (DB) | TA-2'nin `sort_order` < TA-1'in `sort_order` |
| Beklenen (kalıcılık) | Sayfa yenilendikten sonra sıralama korunur |

---

### TC-05 — Optimistik güncelleme geri alımı (IPC hatası)

| Alan | Değer |
|---|---|
| Önkoşul | `tasks:move` IPC handler'ı hata fırlatacak şekilde simüle edilmiş (mock) |
| Adım | Kartı farklı sütuna sürükle-bırak |
| Beklenen (UI) | Kart optimistik olarak hareket eder, hata sonrası eski sütununa geri döner |
| Beklenen (toast) | Hata bildirimi görünür |
| Beklenen (DB) | `status` değişmemiş |

---

### TC-06 — `in_progress` sütununa bırakmak görevi başlatır

| Alan | Değer |
|---|---|
| Önkoşul | `status='todo'` olan, atanmış bir ajan var olan görev |
| Adım | Kartı "In Progress" sütununa sürükle-bırak |
| Beklenen (DB) | `status='in_progress'` |
| Beklenen (orkestratör) | Orkestratör bir sonraki tick'te görevi çalıştırır |
| Risk | Orchestrator'ın görevi hemen alıp almadığı (`tick` zamanlaması) |

---

### TC-07 — `in_progress` dışına sürüklemek görevi durdurur

| Alan | Değer |
|---|---|
| Önkoşul | `status='in_progress'`, aktif çalışan (`run`) olan görev |
| Adım | Kartı "Todo" sütununa sürükle-bırak |
| Beklenen (DB) | `status='todo'` |
| Beklenen (orkestratör) | Aktif çalışma durdurulur veya terk edilir |
| Risk | Çalışma logu yarıda kesiliyor olabilir |

---

### TC-08 — Eş zamanlı sürükleme (iki farklı kart)

| Alan | Değer |
|---|---|
| Önkoşul | En az 2 görev farklı sütunlarda |
| Adım | Hızlı ardışık iki sürükleme işlemi (farklı kartlar) |
| Beklenen (UI) | Her iki kart da doğru sütunda görünür |
| Beklenen (DB) | Her iki `status` de doğru |
| Risk | Zustand optimistik güncelleme çakışması |

---

### TC-09 — Sayfa yenilemesinde kalıcılık

| Alan | Değer |
|---|---|
| Önkoşul | Herhangi bir kart farklı sütuna taşınmış |
| Adım | Electron penceresini kapat ve yeniden aç (veya `Ctrl+R`) |
| Beklenen | Kartlar son sütunlarında görünür |
| Beklenen (DB) | `status` değerleri `tasks` tablosunda doğru yazılmış |

---

### TC-10 — Arama/filtre aktifken sürükleme

| Alan | Değer |
|---|---|
| Önkoşul | Arama kutusunda filtre aktif (bir kart görünür) |
| Adım | Görünen kartı farklı sütuna sürükle |
| Beklenen (UI) | Kart yeni sütunda görünür; filtre bozulmaz |
| Beklenen (DB) | `status` güncellenir |
| Risk | Filtre sonucu daraltılmışken `sort_order` hesaplaması yanlış olabilir |

---

## Risk Özeti

| Risk | Etki | İlgili TC |
|---|---|---|
| Orchestrator yarış koşulu (`in_progress` ↔ `todo`) | Yüksek | TC-02, TC-06, TC-07 |
| Optimistik güncelleme geri alımı eksikliği | Orta | TC-05 |
| `sort_order` hesaplama hatası (filtre + sıralama) | Orta | TC-04, TC-10 |
| `completed_at` güncellenmemesi | Düşük | TC-03 |
| Eş zamanlı sürükleme çakışması | Düşük | TC-08 |

---

## İlgili Dosyalar

| Dosya | Rol |
|---|---|
| `src/renderer/src/features/tasks/TasksView.tsx` | `onDrop` handler, optimistik güncelleme |
| `src/main/ipc.ts` | `tasks:move` IPC handler |
| `src/main/db/repos.ts` | `tasksRepo.move()` — SQL |
| `src/renderer/src/store/useAppStore.ts` | Zustand store, `handleEvent` |
| `src/main/events.ts` | `emit({ type: 'tasks:changed' })` |
