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

## GitHub Pages: uygulama ve arazi tek adreste

Yayın adresi: <https://stargazing-martian.github.io/StargazingMartian/>.
CTOD'un ürettiği gerçek arazi dosyaları `data/terrain/mars/` altında uygulamayla
birlikte sunulur. Ziyaretçinin Docker veya ayrı bir CTOD servisi açması gerekmez.
`site-config.js`, bu statik paketi otomatik seçer. Aynı dosyalar basit bir yerel
HTTP sunucusunda da çalışır:

```sh
python3 -m http.server 5500
```

<http://localhost:5500> adresini açın. **Topographic mode**, yalnızca yükseklik
renklerini açıp kapatır; gerçek 3B arazi etkin kalır. Sıcaklık, atmosferik toz,
görev/Sol/UTC gözlemleri ve yeni görev/fotoğraf paneli aynı yayın altında çalışır.

Paket 1.021 tile ve yaklaşık 322 MiB içerir. Tüm gezegen seviye 4'e, görev
bölgeleri ve mevcut rover rotaları seviye 9'a kadar kapsanır. Görev bölgelerinin
dışında daha kaba arazi kullanılır; kaynak DEM'in 200 m çözünürlüğü bütün
gezegenin her yakınlaştırmada 200 m ayrıntı taşıdığı anlamına gelmez.
Mesh yoğunluğu düşürülmemiştir. [Paket, kapsama ve yeniden üretim notları](data/terrain/README.md).

Kökteki `.nojekyll` korunur; depo kökünden GitHub Pages yayını kullanılabilir.
`data/terrain/mars/` içindeki bütün tile'lar, `layer.json` ve `export.json` aynı
commit'te bulunmalıdır. Dosyalar yüklenmeden yalnızca arayüzü yayımlamak yeterli değildir.

## Ayrı sunucuyla geliştirme

Gerekirse `site-config.js` içindeki `terrainUrl` değerini çalışan servisin
`/tiles/mars` adresiyle değiştirin. HTTPS yayında HTTPS terrain adresi gerekir.
`terrainUrl: null`, localhost ve Codespaces'te otomatik CTOD servisini seçer.
Tarayıcıdaki eski kayıtlı adresler yayın ayarını değiştirmez. URL alanı ve
elle bağlantı düğmesi son kullanıcı arayüzünden kaldırılmıştır.

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

Ardından <http://localhost:5500> adresini açın. Statik arazi paketi varsayılandır;
canlı CTOD geliştirmesi için `site-config.js` içinde `terrainUrl: null` seçin.
Docker, arazi paketini yeniden üretirken veya backend geliştirmesi yaparken
kullanılır; normal site ziyaretinde gerekmez. İlk imaj kurulumu Python
bağımlılıklarını indirir. Yerel DEM yoksa CTOD resmi USGS HRSC/MOLA rasterını
HTTP aralık istekleriyle okur.

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

Yayın kaynağı `site-config.js` dosyasından yönetilir. Varsayılan
`terrainUrl: "./data/terrain/mars"` aynı site altındaki dosyaları kullanır.
Dış servis seçilecekse tam HTTPS adresini buraya yazın. Ayar dosyası herkese
açıktır; anahtar veya parola içermemelidir. `file://` yerine HTTP sunucusu kullanın.

## CORS

CTOD'deki güncel ayar `localhost`, `127.0.0.1` ve `[::1]` originlerini herhangi
bir portta kabul eder. Harici host/domain kullanıldığında CTOD'ye **Stargazing
sayfasının origin'i** `--cors-allow-origins` veya `CTOD_CORS_ALLOW_ORIGINS` ile
verilmelidir. Bu, CTOD'nin kendi adresi değildir. Statik Pages paketinde bütün
veriler aynı origin'dedir ve CORS ayarı gerekmez.

Üretimde yerel geliştirme iznini kapatmak için `CTOD_CORS_ALLOW_ORIGIN_REGEX=""`
kullanın ve izin verilen site originlerini açıkça belirtin. `no-cors` kullanmak
çözüm değildir: tarayıcı opaque yanıtın yükseklik verisini okuyamaz.

## Topografya

**3D terrain active** durumu, yalnızca metadata ve örnek terrain tile'larının
Cesium tarafından okunup yükseklikleri doğrulandığında gösterilir. Eksik veride
uygulama yüzey görünümüne döner; bilimsel haritalar ve görev gözlemleri çalışır.

Arazi görünümünde **Topographic mode** anahtarı ve yalnızca **1× / 5×** ölçek seçimi bulunur. Açıkken DEM yüksekliği
renklerle gösterilir; kapalıyken Viking yüzey dokusu görünür. Her iki durumda
3B geometri etkindir. 5× kabartı varsayılandır; 1× gerçek ölçeğe geçilebilir. Seçim lejantta belirtilir; renkler
kaynak metre cinsindendir. Bağlantı formu, 10× seçeneği, Olympus düğmesi
ve normal tıkla yükseklik okuma kaldırılmıştır; normal tıklar görev/rota
seçimine ayrılır. Bilimsel haritaların Shift+tıkla sayısal okuması korunur.

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
CTOD arazi sağlayıcısı, kamera, rota/pinler ve 1×/5× düşey ölçek korunur. Veri yüklenemezse
yüzey görünümü ve açıklayıcı hata gösterilir. Statik JSON dosyaları web
uygulamasıyla birlikte sunulur; ek servis veya canlı NASA erişimi gerekmez.

Kaynaklar, yeniden üretim ve yorum sınırları:
[NASA TES veri notları](data/science/tes-dust/README.md).
Kontroller: `node --test tests/*.test.mjs`.

## Yüzey sıcaklığı haritası

**Bilimsel harita → Yüzey sıcaklığı · NASA TES** seçeneği, NASA'nın yayımlanmış
sayısal `TSURF` gözlemlerinden hesaplanan bir ısı haritasını açar. Ocak,
Mart–Nisan ve Temmuz–Ağustos 2004 için üç örnek gözlem aralığı sunulur.
Yalnızca yerel gerçek güneş saati 13:00–15:00 arasındaki ölçümler kullanılır.

**Merkezdeki sıcaklığı oku** veya **Shift+tıklama**, seçilen 6° × 3° hücredeki
gözlemlerin ortalamasını °C/K olarak; gözlenen aralığı, örnek sayısını,
yayılımını ve gerçek gözlem zamanlarını gösterir. Yayılım ölçüm hatası değildir.
Gri alanlarda veri yoktur; bu alanlar doldurulmaz. Bu, hava sıcaklığı, termal
atalet, günlük en düşük/en yüksek sıcaklık veya güncel hava tahmini değildir.

Toz ve sıcaklık aynı mod yöneticisini kullanır; renkler ve aktif katmanlar
birbirine karışmaz. CTOD, kamera, pinler ve rotalar korunur. Haritalar NASA
gözlemlerinden Stargazing tarafından türetilmiştir; rover görev tarihleriyle
otomatik eşleştirme veya rota güvenliği değerlendirmesi yapılmaz.

Yöntem, kaynaklar ve yeniden üretim:
[Yüzey sıcaklığı veri notları](data/science/tes-temperature/README.md).

## Görev ve zamanla çevre gözlemi

Arazi panelindeki **Görev ve zaman · NASA Pancam** bölümünde Spirit veya
Opportunity ve göreve özel Sol numarası (örnek: **2**) seçilir. Alternatif
olarak araç saatinden türetilmiş yaklaşık UTC günüyle arama yapılabilir.
Birden fazla eşleşmede gerçek gözlemler ayrı ayrı seçilebilir. Görev pinine
tıklamak paneldeki görevi de seçer; panelde tarih değiştirmek kamerayı oynatmaz.
**Seçili görevin rotasına git** düğmesi mevcut rota görünümünü açar.

Pancam'ın 440 nm atmosfer optik derinliği sunulur. Kaynak göreli hata alanı,
Sol, Ls, görüntü kimliği ve yaklaşık UTC açıkça gösterilir. Eksik kayıt başka
görevden veya en yakın günden doldurulmaz. Diğer görevlerde veri eklenmediyse
panel bunu belirtir. Hava sıcaklığı ve rüzgâr bu kaynakta bulunmaz.

**Harita dönemini bu gözleme bağla** açıkken toz/ısı listesi yalnızca seçili
UTC gözlemiyle örtüşen örnek dönemleri içerir. Eşleşme yoksa katman kaldırılır
ve yüzey görünümü korunur. Bu, bölgesel dönem örtüşmesidir; aynı gün roverın
tam konumunda ölçülen hava durumu değildir. İniş bölgesinin referans hücresi
ayrıca etiketlenir. Kutuyu kapatarak serbest arşiv taramasına dönülür.

Spirit 4.391, Opportunity 8.697 tarihsel ölçüm içerir. Opportunity'nin 408
ölçümü NASA saat dosyasının geçerlilik sınırını aştığından yalnızca Sol ile
gösterilir; UTC ve harita dönemi türetilmez. Veriler web uygulamasıyla birlikte
sunulur; ek servis veya Docker kurulumu gerektirmez.
[Kaynaklar, saat dönüşümü ve bilimsel sınırlar](data/science/mer-weather/README.md).

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
