/** Demo provider: the kind of work guessed from a task decides what the simulation touches. Run: npm run test:unit */
import assert from 'node:assert/strict'
import { demoKind } from '../src/shared/demoKind.ts'

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
console.log('demo: task kinds ok')
