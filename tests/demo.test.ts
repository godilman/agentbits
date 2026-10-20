/** Demo provider: the kind of work guessed from a task decides what the simulation touches. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { demoIsWork, demoKind, demoParts } from '../src/shared/demoKind.ts'

const is = (kind: string, task: string, profile = ''): void => assert.equal(demoKind(task, profile), kind, task)

is('code', 'LoginForm: validate the e-mail field and fix the API error')
is('code', 'API uç noktasındaki hatayı düzelt') // i18n-ignore
is('research', 'Rakip analizi: 5 rakibin fiyatlarını karşılaştır') // i18n-ignore
is('research', 'Research competitors and compare their pricing')
is('content', 'Yeni ürün için LinkedIn duyuru metni yaz') // i18n-ignore
is('content', 'İçerik takvimi ve blog yazısı hazırla') // i18n-ignore, "İ" must lower-case to a plain "i"
is('content', 'Write a newsletter for the marketing campaign')
is('data', 'Satış verisini Excel’den oku, aylık KPI tablosu çıkar') // i18n-ignore
is('data', 'Build a dashboard of monthly metrics from the CSV')
// no keyword in the task: the agent's role decides, and unknown work stays code
is('content', 'Haftalık özet hazırla', 'Content writer · copywriting') // i18n-ignore
is('code', 'Haftalık özet hazırla') // i18n-ignore
is('code', '')
// the task text outweighs the role: a developer asked for a blog post writes content
is('content', 'Blog yazısı yaz: ürünün yeni sürümü', 'Frontend developer · React, CSS') // i18n-ignore

// Splitting a request into tasks: only real sentence ends split; file names, versions and URLs stay whole.
const parts = (msg: string, want: string[]): void => assert.deepEqual(demoParts(msg), want, msg)
parts('math.js dosyasındaki toplama hatasını düzelt', ['math.js dosyasındaki toplama hatasını düzelt']) // i18n-ignore
parts('Fix the rounding bug in utils/math.js and src/app.config.ts', ['Fix the rounding bug in utils/math.js and src/app.config.ts'])
parts("Paketi 1.2.3'ten 2.0.1'e yükselt ve changelog'u güncelle.", ["Paketi 1.2.3'ten 2.0.1'e yükselt ve changelog'u güncelle"]) // i18n-ignore
parts('https://example.com/a.b/c.html?x=1.5 adresindeki formu düzelt', ['https://example.com/a.b/c.html?x=1.5 adresindeki formu düzelt']) // i18n-ignore
parts('Giriş formunu düzelt, ve ayrıca kayıt sayfasına doğrulama ekle', ['Giriş formunu düzelt, ve ayrıca kayıt sayfasına doğrulama ekle']) // i18n-ignore
parts('Fix the login form. Then add tests for the API at https://api.example.com/v1.2.', ['Fix the login form', 'Then add tests for the API at https://api.example.com/v1.2'])
parts('1. Login ekranını düzelt\n2. Kayıt formuna doğrulama ekle', ['1. Login ekranını düzelt', '2. Kayıt formuna doğrulama ekle']) // i18n-ignore
parts('Do it. Now.', ['Do it. Now'])
parts('One two three. Four five six. Seven eight nine. Ten eleven twelve. Thirteen fourteen fifteen.', ['One two three', 'Four five six', 'Seven eight nine', 'Ten eleven twelve. Thirteen fourteen fifteen'])
// Work or talk: short work orders are work; greetings, short remarks and questions are talk.
for (const m of ["math.js'i düzelt", 'Hatayı düzelt', 'Fix math.js', 'Add tests', 'README güncelle', 'Giriş formunu düzelt lütfen hemen']) assert.ok(demoIsWork(m), m) // i18n-ignore
for (const m of ['Merhaba', 'Selam nasılsın', 'Thanks!', 'ok', 'Bunu düzeltebilir misin?', 'What is left on the board?']) assert.ok(!demoIsWork(m), m) // i18n-ignore
console.log('demo: task kinds, request parts and work orders ok')
