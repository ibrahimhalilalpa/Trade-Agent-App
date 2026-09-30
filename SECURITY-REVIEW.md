# Güvenlik İncelemesi

## Kapsam ve durum

İnceleme, herkese açık GitHub deposu ve Vercel dağıtımı öncesinde sanal portföy işlemlerinin istemci/API sınırını ve Supabase erişim kurallarını kapsar.

| # | Önem | Bulgu | Durum |
|---|---|---|---|
| 1 | Orta | Kullanıcılar Supabase REST/RLS üzerinden kendi sanal portföy ve pozisyon kayıtlarına doğrudan yazabiliyordu; snapshot yazımları da kullanıcı oturumlarına açıktı. | Düzeltildi: kullanıcı yazma politikaları/izinleri kaldırıldı; portföy başlatma güvenli RPC'ye taşındı. |
| 2 | Orta | `process_portfolio_action` ve `execute_immediate_limit_order` RPC'leri doğrulanmış kullanıcılarca doğrudan çağrılabiliyor, işlem fiyatı parametreleri istemciden etkilenebiliyordu. | Düzeltildi: RPC yürütme izni yalnızca `service_role` için bırakıldı; API fiyatı sunucu tarafında alıyor. |
| 3 | Orta | Piyasa işlemi API'sindeki “serbest fiyat” akışı istemcinin seçtiği fiyatı portföy işlem fiyatı olarak kullanabiliyordu. | Düzeltildi: serbest fiyat seçeneği arayüzden ve API akışından kaldırıldı. |

## Uygulanan değişiklikler

- [virtual-portfolio-write-protection-migration.sql](./supabase/virtual-portfolio-write-protection-migration.sql), doğrudan tablo yazımlarını engeller ve finansal işlem RPC'lerini `service_role` ile sınırlar.
- [route.ts](./app/api/portfolio/route.ts), finansal RPC'leri oturum kullanıcısını doğruladıktan sonra sunucu tarafındaki Supabase admin istemcisiyle çağırır. Service-role anahtarı yoksa işlem açıkça `503` ile durur.
- [StockDetailModal.tsx](./components/StockDetailModal.tsx), kullanıcı tarafından belirlenen serbest işlem fiyatı türünü sunmaz.
- Kurulum talimatları [supabase/README.md](./supabase/README.md) içinde güncellendi.

## Dağıtım öncesi gerekli adımlar

1. Supabase SQL Editor'da `virtual-portfolio-write-protection-migration.sql` dosyasının tamamını, README'deki portföy/RBAC/bakiye migration'larından sonra çalıştırın.
2. Vercel'de `SUPABASE_SERVICE_ROLE_KEY` değerini yalnızca sunucu ortam değişkeni olarak tanımlayın. `NEXT_PUBLIC_` öneki kullanmayın ve anahtarı istemci koduna koymayın.
3. Migration uygulandıktan sonra giriş yapmış kullanıcıyla portföy başlatma, piyasa alış/satış, bekleyen emir ve super-admin bakiye müdahalesi akışlarını doğrulayın.

Bu inceleme, uygulama kodu ve SQL migration kaynaklarının statik değerlendirmesidir. Migration'ın gerçek Supabase projesinde çalıştırıldığı veya production ortamının erişim politikalarının doğrulandığı anlamına gelmez. Bu incelemede gerçek aracı kurum entegrasyonu ya da gerçek para hareketi doğrulanmadı; kapsam sanal portföydür.

## Doğrulama

- `npm run lint` başarılı.
- `npm run build` başarılı.
- Supabase migration henüz canlı veritabanında uygulanıp test edilmedi.
