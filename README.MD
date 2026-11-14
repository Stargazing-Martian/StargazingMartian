# Stargazing

Cesium tabanlı Mars görünümü. NASA Trek yüzey görüntüsünü, CTOD HRSC/MOLA
rasterından ürettiği 3B yükseklik geometrisini sağlar.

## Yıldız arka planı

`assets/skybox` içindeki altı Tycho/Hipparcos görseli açılışta ve serbest kamera
modunda tek Cesium canvas'ında gösterilir. Arka plan CTOD bağlantısı gerektirmez;
dosyalar modüle göre çözümlendiği için alt dizin altında sunum da desteklenir.
Yükleme hatasında Mars çalışmaya devam eder ve kullanıcıya uyarı gösterilir.

Görseller gerçek yıldız kataloğundan türetilmiştir; Mars'tan çekilmiş fotoğraflar
değildir. IAU 2000 kutup/meridyen modeliyle **yaklaşık Mars yönelimi** uygulanır.
Bu bir hassas gözlem/efemeris simülasyonu değildir. Kaynak, dosya doğrulaması ve
astronomik sınırlar: [skybox notları](assets/skybox/README.md).

Yönelim testleri: `node --test tests/mars-orientation.test.mjs`.

## Ayrı sunucularla kullanım

Stargazing ve CTOD'yi kendi seçtiğiniz adreslerde/portlarda çalıştırın. Uygulama
belirli bir port gerektirmez. Stargazing'i açıp **Arazi bağlantısı → CTOD terrain
adresi** alanına çalışan servisin `/tiles/mars` adresini girin ve **Bağlan**'a
basın. Sunucu kök adresi veya `layer.json` adresi de kabul edilir. Başarılı adres
bu tarayıcı ve origin için hatırlanır. Port/origin değiştiğinde yeniden girilebilir.

İstenirse `index.html` içindeki module script'ten önce merkezi ayar verilebilir:

```html
<script>
  globalThis.STARGAZING_CONFIG = {
    terrainUrl: "https://terrain.example.com/tiles/mars",
    terrainTimeoutMs: 15000
  };
</script>
```

Bu açık ayar, tarayıcıda kaydedilen adresten önceliklidir. HTTPS sayfası HTTPS
terrain servisi gerektirir. `file://` yerine bir HTTP geliştirme sunucusu kullanın.

## CORS

CTOD'deki güncel ayar `localhost`, `127.0.0.1` ve `[::1]` originlerini herhangi
bir portta kabul eder. Harici host/domain kullanıldığında CTOD'ye **Stargazing
sayfasının origin'i** `--cors-allow-origins` veya `CTOD_CORS_ALLOW_ORIGINS` ile
verilmelidir. Bu, CTOD'nin kendi adresi değildir. Panel mevcut sayfanın origin'ini
gösterir. Ayar değişikliği CTOD tekrardan başlatılınca uygulanır.

Üretimde yerel geliştirme iznini kapatmak için `CTOD_CORS_ALLOW_ORIGIN_REGEX=""`
kullanın ve izin verilen site originlerini açıkça belirtin. `no-cors` kullanmak
çözüm değildir: tarayıcı opaque yanıtın yükseklik verisini okuyamaz.

## Topografya

**3B arazi etkin** durumu yalnızca metadata ve örnek terrain tile'ları Cesium
tarafından okunup yükseklikler doğrulanınca gösterilir. Bağlantı başarısızsa
uygulama açıkça yalnızca yüzey görüntüsü gösterdiğini belirtir. Tek tile hatası
önceden yüklenmiş bütün araziyi kapatmaz. Bağlantı panelinden yeniden denenebilir.

- **Olympus Mons’a yaklaş:** eğik yakın görünümle yamaç ve krateri inceleyin.
- **Topografya renkleri:** doku yerine DEM yüksekliklerini renklerle gösterir.
- **1×:** kaynak yüksekliklerinin gerçek ölçeği; **5×/10×:** açıkça etiketlenmiş
  görsel abartı. Renk lejandı abartıdan bağımsız kaynak yüksekliklerini gösterir.

Gezegenin tamamına uzaktan bakarken gerçek ölçekte kabartı çok küçük görünür;
yakın görünüm veya abartılı ölçek kullanın. Globe, terrain ve WMTS aynı
3396190 m Mars küresini kullanır. Kaynak raster değerleri korunur; düşey datum
ve birim metadata'sı açık olmadığından mutlak Mars yarıçapı doğruluğu iddia edilmez.
Areoid düzeltmesi uygulanmamıştır. Mevcut terrain üst seviyesi 8, görüntü seviyesi
7'dir; yakınlaştırmak kaynak çözünürlüğünün ötesinde yeni ayrıntı üretmez.

## Doğrulama

15 CTOD regresyon testi geçti: CORS farklı loopback host/portları ve preflight,
örnekleme, kenar/kutup sürekliliği, cache, hata/timeout ve mesh başlık ölçeği.
Tarayıcıda metadata yanında gerçek terrain çözümleme, Olympus Mons yakın görünümü,
yükseklik renkleri ve düşey ölçek kontrol edildi. Ana belge `<!DOCTYPE html>` ile
Standards Mode kullanır. Konsoldaki `blank`/extension mesajları ve Cesium WASM
source-map uyarısı CORS ile aynı problem değildir.

API kaynakları:
- https://cesium.com/learn/cesiumjs/ref-doc/CesiumTerrainProvider.html
- https://cesium.com/learn/cesiumjs/ref-doc/Scene.html
- https://github.com/CesiumGS/quantized-mesh
