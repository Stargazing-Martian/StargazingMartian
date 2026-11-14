# Mars terrain v3.0.1 — 15 Kasım 2026

## Düzenlenen yol

- `mars_raster.py`: native Mars CRS doğrulaması, blok bazlı raster okuma,
  128 MiB blok önbelleği, nearest/bilinear örnekleme, kutup/meridyen sürekliliği.
- `mars_mesh.py`: 128×128 hücre, 16.641 köşe ve 32.768 üçgen; aynı halo
  örneklemesinden yükseklik ve sınır ötesi normal hesabı. Boş hücreler aynı DEM’in
  geçerli, daha kaba overview seviyesinden tamamlanır; hiçbir seviyede veri
  bulunamazsa açık hata döner.
- `mars.py`: dört işçi, aynı tile için paylaşılan üretim, sürümlü bellek/disk
  önbelleği. İstemci zaman aşımı paylaşılan işi iptal etmez.
- Compose: yerel COG klasörü bağlanabilir; bu bilgisayarda bulunan önceki
  `MarsHRSCMOLA_MAP2_COG.tif` için `.env` hazırlandı. `.env` ve DEM Git'e girmez.
- Arayüz: gerçek başarısız tile koordinatı gösterilir; aynı tile başarıyla
  yüklenince uyarı kalkar. Yüzeye tıklama kaynak DEM yüksekliğini metreyle okur.
  Eğik inceleme ışığı eğimleri belirginleştirir.

## Doğrudan üretim ölçümü

Mevcut 106695×53348, 200 m/piksel yerel COG, Python 3.10 ortamı.
Gzip tile üretimi, gerçek DEM okuması ve quantized-mesh kodlamasını içerir.
Bu değerler tarayıcı yükleme süreleri veya uzaktan USGS performansı değildir.

| TMS tile | Üretim (s) | Sıkıştırılmış bayt | Min / max yükseklik (m) |
| --- | ---: | ---: | ---: |
| 0/0/0 | 0.021 | 127943 | -6179.7 / 19585.2 |
| 0/1/0 | 0.014 | 128788 | -7467.4 / 7495.6 |
| 1/2/1 | 0.040 | 119789 | -6052.1 / 2381.1 |
| 3/4/3 | 0.069 | 119376 | -5110.0 / 5668.9 |
| 8/65/154 | 0.043 | 110445 | 18109.7 / 20378.1 |
| 8/356/184 | 0.055 | 116395 | -3084.4 / -2495.0 |
| 9/131/309 | 0.020 | 107905 | 19076.1 / 19997.9 |

## Kontrol durumu

- Kullanıcının açık test onayından sonra normal ortamda 22 backend testinin
  tamamı geçti (0.669 s). Kısıtlı ortamda bekleyen eşzamanlılık testi normal
  ortamda geçti. Bu çalışma için açık test izni alındıktan sonra önceki otomatik
  onay engeli kalktı.
- Beş Node testi geçti: iki arazi hata izleme/toparlanma testi ve üç yıldız
  yönelimi testi. Sözdizimi ve `git diff --check` kontrolleri geçti.
- Gerçek DEM ve çalışan HTTP sunucusuyla, sekiz eşzamanlı istekte 239 tile
  başarılı oldu (3.791 s). Bunlar z=0–3 tüm küre, z=8 kuzey/güney kutup
  örnekleri ve Olympus/ikinci yükseklik örneklerini içerir. Her tile 16.641
  köşe içeriyordu. Bu bir tam z=0–9 küresel kapsama taraması değildir.
- İlk aşırı yük denemesinde 173 istek aynı anda verildiğinde 64 benzersiz iş
  sınırının üstündekiler 503 döndü. Bu sınır belleği/iş kuyruğunu korur;
  sonraki kontroller tarayıcıya benzer sekiz eşzamanlı istekle yapıldı.
- `docker compose config --quiet` geçti. Mevcut Docker konteynerleri bu turda
  başlatılmadı; Docker içi yerel bind mount sonradan başlatılırken logdan
  doğrulanmalıdır.
- Geçici yerel CTOD (5015) ve web (5505) sunucularında Cesium gerçek tile'ları
  çözdü; topografya renkleri, 1×/5× ölçek ve Olympus Mons yakın kamera görünümü
  gözlendi. Son sürümde yeşil `3B arazi etkin` durumu görüldü.
- Son Olympus yakın görünümünde yüzeye tıklama 16.2094°, -134.4493° noktasında
  **15.107 m** kaynak DEM yüksekliği döndürdü; bu değer 5× abartılı geometriyle
  karıştırılmadı. Son görüntü `/tmp/stargazing-v3-proof/olympus-5x.jpg`.
- Geçici kontrol sekmesi ve iki kontrol sunucusu iş bitince kapatıldı.

## Kullanım

Mevcut Python bağımlılıkları değişmedi; çalışan proje imajı için tekrar
bağımlılık derlemesi gerekmez:

```sh
docker compose up -d
```

`http://localhost:5500` adresini Ctrl+Shift+R ile yenileyin. CTOD logundaki
`Mars DEM:` satırı `/data/MarsHRSCMOLA_MAP2_COG.tif` göstermelidir.

Kaynak DEM'in doğal çözünürlüğü 200 metredir. Görüntü kaplaması Viking
mozaiğidir; yüzey fotoğrafının çözünürlüğü bu backend değişikliğiyle artmaz.
Veri yükseklikleri korunur, düşey datum dönüşümü yapılmaz.
