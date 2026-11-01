# Noduksen tokenomiikka- ja lainasimulaattori

Avaa Observatoryn yläriviltä **Simulaattori / Simulator** (`#tokenomics`).
Suomen- ja englanninkielinen sivu käyttää samaa Python-laskentamallia kuin
komentoriviversio. Nodea, lompakkoa, avaimia, tietokantaa tai uusia Python-paketteja
ei tarvita laskentaan.

## Asennus

Kehityshaara jatkaa uusimmasta `fix/statistics-range-reports-20261029`-haarasta,
jotta nykyinen tilasto- ja DeFi-ominaisuuksien ketju säilyy mukana.

```bash
git fetch origin
git switch feature/tokenomics-simulator-20261101
git pull --ff-only
sudo bash backend/install.sh
```

Asennus päivittää vain monitorin. Avaa tuttu Observatory-osoite, valitse
Simulaattori, muuta oletuksia ja käynnistä laskenta. Pelkkä staattinen
HTTP-palvelin ei suorita Pythonia: laskenta tarvitsee Observatoryn backendin.
Puuttuva rajapinta näkyy virheenä, eikä sitä korvata piilotetulla demotuloksella.

## Python-komentorivi

Suorita repon juuressa:

```bash
python3 -m tokenomics_simulator --output /tmp/nodus-simulation.json
python3 -m tokenomics_simulator --parameters /tmp/nodus-parameters.json \
  --output /tmp/nodus-simulation.json --csv /tmp/nodus-simulation.csv
```

Parametritiedosto sisältää JSON-olion; vain muutettavat arvot tarvitaan:

```json
{
  "months": 120,
  "validator_cost_usdt_year": 360,
  "storage_cost_usdt_year": 1800,
  "validator_entry_per_month": 4,
  "storage_entry_per_month": 0.1,
  "fees_nod_year": 1000000,
  "demand_growth_pct": 0,
  "hoarding_strength": 1
}
```

Storagen vuosikuluihin sisältyy myös laitteiston vuosittainen poisto.
`storage_entry_per_month = 0.1` tarkoittaa enintään noin 1,2 uutta storage-nodea
vuodessa kannattavuuden salliessa. Korkeammat kulut ja hitaampi osallistuminen
ovat käyttäjän oletuksia, eivät protokollan sääntöjä tai mitattua adoptionopeutta.
Molempia voi muuttaa. Nodemäärät ovat jatkuvia keskiarvoja ja voivat sisältää
murto-osia.

## Ketjun säännöt ja mallin oletukset

Upstream-lähteet on tarkastettu `nocdem/dna`-commitista
`d9cefb4fcf2e2e9ce073cedacaff45caa93c8e2c`. Tämä ei todenna käynnissä olevan
testnetin nykyisiä saldoja tai äänestettyjä asetuksia.

| Lähtökohta | Merkitys |
|---|---|
| Kokonaismäärä 1 miljardi NOD | Simulaatiossa ei minttausta tai polttoa |
| Konsensuspalkkioiden alkuvaranto 200 M | Genesis-mallipohja; muutettavissa |
| Storagen alkuvaranto 100 M | Erillinen palvelupotti; muutettavissa |
| Muut lukitut palveluvarannot 200 M | Compute 100 M, VPN 50 M, tulevat palvelut 50 M |
| Epoch 720 lohkoa | Kellonaika riippuu annetusta lohkoajasta |
| Budjetti jäljellä oleva potti / 65 536 per epoch | Erillinen laskenta kummallekin palkkiopotille |
| Transaktiomaksut konsensuspottiin | Olemassa olevien tokenien siirto; ei uutta supplyä |
| Bondit oletuksena 2 M / validaattori ja 1 M / storage | Koodin oletukset, eivät varmennettuja live-asetuksia |
| Enintään 32 aktiivista validaattoria | Ohjelmistoversion aktiivijoukon katto |
| Lainapooli, hinnan muodostuminen, kulut ja osallistuminen | Erillisiä skenaario-oletuksia |

Lähteet:

- [Genesis](https://github.com/nocdem/dna/blob/d9cefb4fcf2e2e9ce073cedacaff45caa93c8e2c/nodus/tools/genesis/testnet_v3.conf.template)
- [Validaattoripalkkiot](https://github.com/nocdem/dna/blob/d9cefb4fcf2e2e9ce073cedacaff45caa93c8e2c/nodus/src/witness/nodus_witness_v2_econ.c)
- [Storage-palkkiot](https://github.com/nocdem/dna/blob/d9cefb4fcf2e2e9ce073cedacaff45caa93c8e2c/nodus/src/witness/nodus_witness_v2_storage.c)
- [Rooli- ja staking-vakiot](https://github.com/nocdem/dna/blob/d9cefb4fcf2e2e9ce073cedacaff45caa93c8e2c/dnac/include/dnac/dnac.h)

## Mallin tulkinta

Palkkiovarannot, muut lukitut varat, kummankin roolin bondit, lainapoolin vapaat
tokenit ja muut lompakot summautuvat aina samaan miljardiin. Lainattu pääoma
sisältyy jo nodeihin sidottuihin tokeneihin. Lainasaatavia ja maksamatonta korkoa
ei lisätä supplyyn. Maksetut korot siirtyvät lainapooliin uudelleen lainattaviksi.

Kuukausimalli arvioi epochien palkkiopotin pienenemisen analyyttisesti. Se ei
toista yksittäisiä lohkoja, raakayksikköjen kokonaislukupyöristyksiä, kaikkia
osallistumiskynnyksiä tai maksupäivän UTXO-muodostusta. Se on taloudellinen
skenaario, ei ketjun kirjanpidon täsmällinen toisinto.

Storage-palkkiot jaetaan keskimääräisten kelpoisten arkisto-osuuksien perusteella.
Todellisia XOR-segmenttijakoja, grace-aikoja, siirtoja ja kelpoisuusraportteja ei
simuloida. Validaattorien erisuuruisia delegointeja, komissioita tai
aktiivijoukkoon odottavia kandidaatteja ei eritellä.

Hinta on vapaan tarjonnan, ulkoisen kysyntätrendin ja jemmausreaktion oletusmalli.
Se ei ole order book, AMM tai markkinoilta johdettu ennuste. USDT-vakuudet,
likvidoinnit, luottotappiot, slashing ja todelliset poistumislukot eivät sisälly
malliin. Koron ostamiseen oletetaan ulkoista USDT-rahoitusta, mutta NOD-tarjonta
rajoittaa maksamista. Maksamatta jäänyt korko säilyy saatavana.

Lähtöarvot eivät päivity automaattisesti testnetistä. Lopputulos on valitun
ajankohdan tilanne, ei todistettu tasapainopiste.

## Rajapinta ja testit

`GET /api/tokenomics` laskee oletusskenaarion.
`GET /api/tokenomics?p=<JSON>` hyväksyy yhden URL-koodatun parametriolion.
Tuntemattomat, toistetut ja virheelliset parametrit hylätään. Enimmäispituus on
240 kuukautta ja HTTP-pyynnön pituus enintään 4096 merkkiä. Laskenta ei kirjoita
tiedostoja, muuta seurantaa tai kutsu Nodus CLI:tä.

```bash
python3 -m unittest discover -s tokenomics_simulator/tests -v
python3 -m unittest discover -s backend/tests -p 'test_tokenomics_integration.py' -v
node --check dist/tokenomics/simulator.js
node tests/tokenomics-ui.mjs
bash -n backend/install.sh
```
