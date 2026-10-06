# Trade Agent

Borsa İstanbul (BİST) araştırması, sanal portföy takibi ve yatırım eğitimi için geliştirilen web uygulaması. Uygulama piyasa verilerini ve teknik göstergeleri sunar; yapay zekâ analizleri tahmin niteliğindedir ve yatırım tavsiyesi değildir.

## Özellikler

- BİST hisseleri için piyasa takibi, grafikler ve şirket bilgileri
- Kişisel izleme listeleri, araştırma günlüğü, fiyat alarmları ve sanal portföy
- Limit, kâr-al, zarar-durdur ve zincir sanal emirleri
- Yapay zekâ destekli araştırma akışı
- Akademi, trader sıralaması, kullanıcı profilleri ve bildirimler
- Yönetici araçları ve kullanıcı bazlı tema tercihi

> Bu proje sanal portföy işlemleri içindir; gerçek aracı kurum emirleri göndermez. Piyasa verilerinde gecikme veya sağlayıcı kaynaklı eksiklik olabilir. Finansal kararlarınızı yalnızca bu uygulamadaki verilere dayandırmayın.

## Gereksinimler

- Node.js (LTS önerilir)
- npm
- Supabase projesi

## Yerel geliştirme

1. Depoyu klonlayıp proje klasörüne geçin.
2. Bağımlılıkları kurun:

   ```bash
   npm install
   ```

3. Kök dizinde `.env.local` oluşturun:

   ```dotenv
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
   NEXT_PUBLIC_APP_URL=http://localhost:3000

   # İsteğe bağlı AI sağlayıcıları
   GEMINI_API_KEY=
   GROQ_API_KEY=

   # Yalnızca sunucu tarafında kullanılmalı; istemciye açmayın.
   SUPABASE_SERVICE_ROLE_KEY=
   ```

   Supabase URL ve anon key, Supabase Dashboard > Project Settings > API bölümünden alınır. `SUPABASE_SERVICE_ROLE_KEY` gizli ayrıcalıklı anahtardır: Git'e eklemeyin, istemci koduna koymayın ve `NEXT_PUBLIC_` öneki vermeyin. AI anahtarları yalnızca ilgili sağlayıcının özellikleri kullanılacaksa gerekir.

4. [Supabase kurulum rehberindeki](./supabase/README.md) SQL dosyalarını belirtilen sırayla çalıştırın. İlk super admin hesabı için `admin-bootstrap.sql` dosyasındaki e-posta adresini kendi Supabase Auth hesabınızla eşleştirin.
5. Geliştirme sunucusunu başlatın:

   ```bash
   npm run dev
   ```

6. Uygulamayı [http://localhost:3000](http://localhost:3000) adresinde açın.

## Kontroller

```bash
npm run lint
npm run build
```

## Vercel dağıtımı

Projeyi Vercel'e bağlayın ve gerekli ortam değişkenlerini Vercel Project Settings > Environment Variables bölümünde tanımlayın. Production için `NEXT_PUBLIC_APP_URL` değerini uygulamanın HTTPS adresine ayarlayın. Supabase Authentication > URL Configuration içindeki Site URL ve Redirect URLs değerlerini de aynı domaine göre güncelleyin; callback adresi `/auth/callback` olmalıdır.

Bekleyen emirlerin otomatik izlenmesini etkinleştirecekseniz Supabase Edge Function, Vault ve cron adımlarını [Supabase kurulum rehberinde](./supabase/README.md) anlatıldığı şekilde ayrıca tamamlayın. Monitor Vault SQL dosyasındaki proje URL'sinin kendi Supabase projenize ait olduğunu doğrulayın.

## Güvenlik ve gizli bilgiler

- `.env.local` ve diğer gizli değerleri Git'e yüklemeyin.
- Hiçbir gizli anahtarı `NEXT_PUBLIC_` değişkeni olarak tanımlamayın.
- Supabase RLS, Auth redirect URL'leri ve gerekli migration'ların doğru projede uygulandığını dağıtımdan önce doğrulayın.
- Bu README tek başına güvenlik denetimi veya production güvenliği garantisi değildir. Herkese açık dağıtım öncesinde Supabase izinlerini ve sunucu ortam değişkenlerini gözden geçirin.

## Lisans

Bu depoda lisans dosyası bulunmuyorsa, kodun yeniden kullanım ve dağıtım hakları otomatik olarak verilmiş sayılmaz. Bir açık kaynak lisansı seçmek istiyorsanız yayımlamadan önce `LICENSE` dosyası ekleyin.
