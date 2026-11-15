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

## Hızlı başlatma (Docker)

Docker kuruluysa Stargazing ve CTOD'yi tek komutla başlatın:

```sh
docker compose up -d --build
```

Sonraki açılışlarda yeniden derlemeyin:

```sh
docker compose up -d
```

Durdurmak için `docker compose down` kullanın; önbellek volume'u korunur.

Ardından <http://localhost:5500> adresini açın. Arazi bağlantısı, CTOD adresini
yerel kurulumda otomatik seçer. İlk açılış Docker imajlarını ve Python
bağımlılıklarını indirir. Mars DEM'i Git deposuna eklenmez. Yerel kaynak yoksa CTOD, resmi USGS HRSC/MOLA
200 m GeoTIFF'ini HTTP aralık istekleriyle bloklar halinde okur; dosyanın tamamını
indirmez. Uzaktan kaynak ilk tile'larda ağ gecikmesine tabidir.

Yerel DEM için `.env.example` dosyasını `.env` olarak kopyalayıp
`STARGAZING_DEM_DIR` değerini `MarsHRSCMOLA_MAP2_COG.tif` dosyanızın bulunduğu
klasöre ayarlayın. Alternatif olarak COG'u `ctod/data/` klasörüne koyun.
Compose bu klasörü salt okunur `/data` olarak bağlar; CTOD yerel dosyayı
bulursa USGS ağına ihtiyaç duymadan onu kullanır. Başlangıç logu seçilen kaynağı
yazar. `.env` ve rasterlar Git'e dahil edilmez.

VS Code'da **Dev Containers** eklentisiyle depoyu açıp **Reopen in Container**
seçin. GitHub Codespaces'te **Code → Codespaces → Create codespace** ile aynı
ortamı başlatabilirsiniz; port 5500 önizlemeyi açar.

DEM kaynağı: [USGS Astrogeology](https://astrogeology.usgs.gov/search/map/Mars/Topography/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2).
HRSC verisi CC BY-SA 3.0 IGO koşullarına tabidir; akademik kullanımda kaynak
yazarlarını belirtin.

İstenirse `index.html` içindeki module script'ten önce merkezi ayar verilebilir:

```html
<script>
  globalThis.STARGAZING_CONFIG = {
    terrainUrl: "https://terrain.example.com/tiles/mars",
    terrainTimeoutMs: 120000
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
- **Topografya renkleri:** doku yerine DEM yüksekliklerini renklerle gösterir;
  varsayılan açıktır ve düşey ölçek 5× olarak açıkça etiketlenir.
- **Yüzeye tıklama:** en ayrıntılı terrain seviyesinden kaynak yüksekliğini metre
  ve koordinatla gösterir; bu değer düşey abartıdan etkilenmez.
- **1×:** kaynak yüksekliklerinin gerçek ölçeği; **5×/10×:** açıkça etiketlenmiş
  görsel abartı. Renk lejandı abartıdan bağımsız kaynak yüksekliklerini gösterir.

Gezegenin tamamına uzaktan bakarken gerçek ölçekte kabartı çok küçük görünür;
yakın görünüm veya abartılı ölçek kullanın. Globe, terrain ve WMTS aynı
3396190 m Mars küresini kullanır. Kaynak raster değerleri korunur; düşey datum
ve birim metadata'sı açık olmadığından mutlak Mars yarıçapı doğruluğu iddia edilmez.
Areoid düzeltmesi uygulanmamıştır. Mevcut terrain üst seviyesi 9, görüntü seviyesi
7'dir; yakınlaştırmak kaynak çözünürlüğünün ötesinde yeni ayrıntı üretmez.

## Tarihsel atmosferik toz haritası

Arazi panelindeki **Bilimsel harita → Atmosferik toz · NASA TES** seçeneği,
aynı Mars küresinde ayrı bir bilimsel görünüm açar. **Arşivden seçilmiş gözlem
dönemi** listesinden 11 NASA PDS ürününden biri seçilebilir. Bunlar örnek
dönemlerdir; tam arşiv veya kesintisiz günlük hava durumu serisi değildir.

**Merkezdeki bölgenin değerini oku** düğmesi veya yüzeyde **Shift+tıklama**;
toz optik derinliğini, yayımlanmış belirsizliği, katkı veren gözlem sayısını ve
zaman penceresini gösterir. Gri alanlarda veri yoktur. Kaynak dosyası, DOI ve
bilimsel kullanıcı kılavuzu panelden açılabilir.

Grid 6° × 3° bölgesel atmosfer bağlamıdır; roverın yerel sıcaklık/rüzgâr
ölçümü veya kısa bir EVA rotasının güvenlik değerlendirmesi değildir. Harita
1–7 sol içindeki gözlemleri birleştirebilir; arayüz gerçek girdi gözlem
aralığını UTC olarak gösterir. Rota/görev tarihiyle otomatik eşleştirme yapılmaz.

Bilimsel mod açıldığında topografya renkleri ve görsel aydınlatma geçici olarak
devreden çıkar; **Yüzey ve arazi** seçildiğinde önceki görünüm geri gelir.
CTOD arazi sağlayıcısı, kamera, rota/pinler ve düşey ölçek korunur. Veri yüklenemezse
yüzey görünümü ve açıklayıcı hata gösterilir. Statik JSON dosyaları web
uygulamasıyla birlikte sunulur; ek servis veya canlı NASA erişimi gerekmez.

Kaynaklar, yeniden üretim ve yorum sınırları:
[NASA TES veri notları](data/science/tes-dust/README.md).
Kontroller: `node --test tests/*.test.mjs`.

## Mars arazi üretimi (v3)

Mars yolu yeniden düzenlendi: blok tabanlı raster okuma, bilinear örnekleme,
her seviyede varsayılan 128×128 hücre (16.641 köşe), tek halo üzerinden normal
hesabı, dört üretim işçisi ve aynı tile için paylaşılan tek üretim işi.
Kaynak ve ayarlar sürümlü cache kimliğine dahildir. Tile'lar Docker cache
volume'unda saklanır; yeniden başlatma önbelleği silmez.

Eksik DEM hücreleri aynı kaynağın geçerli overview seviyesinden tamamlanır;
hiçbir seviyede veri yoksa tile hatası açıkça bildirilir. Derin çukurlar üretilmez.
Arayüz başarısız tile koordinatını gösterir ve aynı tile başarıyla gelince
uyarıyı kaldırır. Yüzey görüntüsü hâlâ Viking mozaiğidir; CTOD değişikliği
fotoğrafın doğal çözünürlüğünü artırmaz.

Ölçümler ve henüz tamamlanmamış kontroller:
[CTOD yeniden yapılandırma notları](ctod/REBUILD_NOTES.md).

API kaynakları:
- https://cesium.com/learn/cesiumjs/ref-doc/CesiumTerrainProvider.html
- https://cesium.com/learn/cesiumjs/ref-doc/Scene.html
- https://github.com/CesiumGS/quantized-mesh
