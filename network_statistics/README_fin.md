# Verkon tilastot

[English](README.md) · **Suomi**

Avaa yläreunasta **Tilastot** (`#statistics`). Osio yhdistää kerätyt
verkkohavainnot ja julkisesta Scanin lohkodatasta muodostetun paikallisen
indeksin. **FIN / ENG** vaihtaa käyttöliittymän kielen. Aikavalinnat ovat
**24 h, 7 vrk, 30 vrk, 1 vuosi ja kaikki saatavilla oleva historia**.

Osion lähdekoodi on tässä hakemistossa. Nykyiset Observatory, Sopimusstudio,
Kaupankäynti ja Asetukset säilyvät erillisinä alueina.

Verkon nykytilakortit kuvaavat viimeisintä havaintoa. Aikavalinta rajaa
tallennettuja käyriä ja indeksoitua toimintaa; se ei muuta tämän päivän
noderekisteriä menneen ajan tilannekuvaksi.

## Lukujen merkitys

| Luku | Merkitys ja rajat |
| --- | --- |
| Tapahtumat | Indeksoidulla aikavälillä hyväksytyt envelope-tapahtumat (`applied_count`). Claim-erät lasketaan erikseen. Tavalliset siirrot, staking-toiminnot ja EVM-toiminnot erotetaan, kun lähde tunnistaa ne. Tapahtumamäärä ei ole ihmisten välisten maksujen määrä. |
| Hylätyt tapahtumat ja epäonnistuneet EVM-kutsut | Hylätyt ketjukohteet erotetaan hyväksytyistä tapahtumista. Hyväksytty EVM-tapahtuma voi epäonnistua suorituksessa ja maksaa silti kulunsa; suorituksen tulos lasketaan erikseen. |
| Siirtomäärä | Natiivin spend-tapahtuman tulosteet muihin osoitteisiin kuin tunnettujen syötteiden omistajille. Tunnetuille lähettäjille palautuvat vaihtorahat jäävät pois. Luku ei arvioi taloudellista kaupankäyntivolyymia. Kun lähtöosoite puuttuu, tapahtuman siirtosumma on tuntematon. Tunnettujen osien summa ja kattavuus esitetään erikseen. |
| Kulut | Indeksoitujen tapahtumien tarkat raakayksiköt. Puuttuva kulutieto säilyy tuntemattomana. Testnet-NODUSille ei anneta markkina- tai euroarvoa. |
| Aktiiviset native- ja EVM-osoitteet | Valitun indeksoidun toiminnan eri osoitteet. Osoiteavaruudet lasketaan erikseen. Luvut eivät ole lompakoiden, käyttäjien tai ihmisten määriä. |
| Ensimmäistä kertaa havaitut osoitteet | Osoitteet, jotka on nähty ensimmäisen kerran tämän asennuksen indeksialueella. Kun indeksi ei ulotu genesikseen, luku ei kerro osoitteen ensimmäistä esiintymistä koko ketjussa. Käyttämätöntä, paikallisesti luotua lompakkoa ei voi laskea. |
| Validaattorit | Havaittu komitea ja staking-tiedot. Aktiivinen komiteapaikka, bondin sitonut validaattori ja havaittu verkkopalvelin tarkoittavat eri asioita. |
| Storage-nodet | Paikallisesta ketjutietokannasta luettu julkinen rekisteri ja jäädytetty jäsenjoukko. Rekisteröinti, nykyinen jäsenyys, grace ja virheputki kuvaavat eri asioita. Rekisteri ei kerro verkon koko levykapasiteettia. |
| Havaitut nodet | Keruulähteiden kautta tunnetut nodet. Samalla nodella voi olla useita rooleja, joten roolien määriä ei summata erillisinä koneina. Lista ei ole koko verkon täydellinen luettelo. Rekisteririvi ei todista palvelimen olevan verkossa. |
| Sopimukset | Indeksoidut EVM-julkaisut, kutsut, epäonnistuneet suoritukset ja gas-kulutus. Kattavuus seuraa lohkoindeksiä. Tilasto ei osoita sopimuksen käyttötarkoitusta tai luotettavuutta. |

Rahalliset määrät säilyvät koneluettavassa datassa desimaalimerkkijonoina, jotta
JavaScriptin liukuluvut eivät pyöristä suuria kokonaislukuja. Yksi natiivin
raakayksikkö on 10^-8 NODUS; EVM-arvoilla on omat dokumentoidut yksikkönsä.

Lohkorajalla syntyvät palkkiomaksut ja bondien palautukset eivät kuulu
tapahtumaindeksiin; erillinen Palkkiot-osio hoitaa niiden kirjanpidon.
Shielded-toiminta ja ketjun ulkopuolella luodut lompakot jäävät pois.
Noden viimeinen havainto tarkoittaa komitea- tai rekisterihavaintoa, ei
palvelimen verkkoyhteyden toimivuuskoetta.

## Lähteet ja historia

Kerääjä käyttää nykyistä verkkohavaintoa: julkisen Scanin `stats`- ja
`tps`-vastauksia sekä paikallista komiteakyselyä. Ulkopuolinen ketjudata
hyväksytään vain, kun Scanin ketjutunniste vastaa havaittua paikallista nodea ja
tuettua julkista testnetiä. Vastaamaton tai eri ketjua ilmoittava lähde ei muutu
nollamittaukseksi.

Tapahtumaindeksi aloitetaan nykyisen kärjen läheltä, jotta viimeaikainen
toiminta alkaa näkyä ennen koko ketjun kopioimista. Jokaisen keruukerran työ on
rajattu: uusia lohkoja seurataan ja vanhoja lisätään taustalla. Kokonainen lohko,
sen tapahtumat ja indeksin etenemismerkintä tallentuvat yhdessä. Kattavuus
kertoo indeksoidut lohkot ja valitun aikavälin täydellisyyden.

Scanin valmis TPS-historia sisältää 24 tunnin tuntikoosteet. Pidemmät
verkkokäyrät tarvitsevat tämän asennuksen keräämiä havaintoja. Vanhaa
lohkoaktiivisuutta voidaan täydentää saatavilla olevista ketjutiedoista, mutta
nodejen aiempaa saavutettavuutta ja sijaintia ei voi palauttaa tämän päivän
havainnosta. Puuttuvat havainnot säilyvät aukkoina. Tyhjä, katettu aikaväli voi
olla todellinen nolla; havaitsematon aikaväli on tuntematon.

Tilasto-osiossa näytetään lähteet, viimeinen havainto, virheet ja puutteellinen
kattavuus. Tallennetuista tuloksista voi olla hyötyä lähteen virheen aikana,
mutta niiden ikä ja virhetila säilyvät näkyvissä. Rajapinnan lukupyyntö lukee
seurannan tilaa; se ei käynnistä verkkokartoitusta tai lue Nodus-tietokantaa.

## Nodekartta ja paikalliset sijaintitiedot

Kartalle sijoitetaan vain nodet, joille löytyy sijaintivastaavuus. Ilman
sijaintia olevat nodet säilyvät listassa, ja niiden määrä näytetään erikseen.
IP-sijainti on likimääräinen ja kuvaa tavallisesti palveluntarjoajan verkkoa tai
palvelinkeskusta, ei ihmisen sijaintia. Usea node voi käyttää samaa IP-osoitetta.

Paikannetut verkkopäätepisteet näkyvät kartalla vinoneliöinä, joiden
nodeidentiteetti on **vahvistamatta**. Niiden karttalukumäärä ilmoitetaan
erillään tunnistetuista nodeista. Roolisuodatin piilottaa päätepisteet, joiden
rooli on tuntematon; osoite- ja maahaku koskevat myös niitä. **Oma node**
-merkin saa node, jonka tilatietojen fingerprint ja P2P ID vastaavat havaittua
rekisteri-identiteettiä. Paikallisen tilatiedon julkinen `external_ip` täydentää
puuttuvan rekisteriosoitteen; komiteasta saatua osoitetta ei korvata.
Pelkkä yhteinen IP tai päätepistelistan järjestys ei yhdistä osoitetta identiteettiin.

Ota automaattinen paikallinen sijaintihaku käyttöön asennuksessa tai päivityksessä:

```bash
sudo bash backend/install.sh --enable-geoip
```

Valinta asentaa Debian/Ubuntun `python3-maxminddb`-lukijan, varmuuskopioi
seurannan asetustiedoston, ottaa sijaintihaun käyttöön ja käynnistää tavallisena
käyttäjänä toimivan latauspalvelun taustalle. Se ei muuta Nodus-asetuksia.
Lokakuun 2026 aineiston lataus on noin 60 Mt ja purettu tiedosto noin 127 Mt.
Varaa päivityksen ajaksi noin 400 Mt vapaata levytilaa.

Päivityspalvelu lataa kuukausittaisen [DB-IP City Lite MMDB -aineiston](https://db-ip.com/db/download/ip-to-city-lite)
HTTPS-yhteydellä tiedostoon `/var/lib/nodus-monitor/geoip/dbip-city-lite.mmdb`.
Ajastin tarkistaa tilanteen päivittäin ja yrittää epäonnistunutta latausta
uudelleen. Voimassa olevaa kuluvan kuun aineistoa ei ladata uudestaan.
Uuden tiedoston koko ja latausaika rajataan, sisältö tarkistetaan ja tiedosto
vaihdetaan atomisesti. Epäonnistunut lataus tai virheellinen ehdokas säilyttää
edellisen tiedoston. Ilmaisaineiston kattavuus ja tarkkuus ovat rajallisia.
Kartalla näkyvät aineiston päiväys, **IP Geolocation by DB-IP** -lähdelinkki
ja **CC BY 4.0** -lisenssi.

Vain koko tietokanta ladataan. Nodejen osoitteita ei lähetetä DB-IP:lle eikä
muulle sijaintipalvelulle. Julkiset IPv4- ja IPv6-osoitteet haetaan paikallisesta
muistikartoitetusta tiedostosta. Rajattu välimuisti on tiedostossa
`/var/lib/nodus-monitor/geoip-cache.json`, ja aineiston vaihto mitätöi sen.
Yksityiset, varatut ja ratkaisemattomat osoitteet jäävät tuntemattomiksi.
Storage-fingerprint ilman IP-osoitetta ei anna karttapistettä. Kerääjä
päivittää johdetut sijainnit seuraavalla keruukerralla, vaikka verkon
lähdehavainto olisi sama. HTTP-pyynnöt lukevat vain tallennetun raportin.

Tarkista latauspalvelu ja kartan kattavuus:

```bash
systemctl status nodus-monitor-geoip-update.service --no-pager
systemctl is-active nodus-monitor-geoip-update.timer
journalctl -u nodus-monitor-geoip-update.service -n 20 --no-pager
curl -fsS 'http://127.0.0.1:8890/api/statistics?range=24h' \
  | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["geolocation"], indent=2))'
```

Onnistunut kertaluonteinen latauspalvelu päätyy tilaan `inactive (dead)`;
ajastin jää aktiiviseksi. Sijainnit ilmestyvät latauksen ja seuraavan
keruukerran jälkeen. Välittömän uuden yrityksen saa komennolla
`sudo systemctl start nodus-monitor-geoip-update.service`.

Estä lataukset pysäyttämällä ja poistamalla käytöstä
`nodus-monitor-geoip-update.timer` sekä asettamalla seurannan asetuksiin
`statistics_geoip_auto_update: false`. Myös paikallinen sijaintihaku poistuu
käytöstä asetuksella `statistics_geoip_enabled: false`. Päivittäjä noudattaa
lisäksi asetuksia `network_enabled` ja `statistics_enabled`; verkkokeruun
poistaminen käytöstä estää ulkoiset lataukset. DB-IP-tiliä tai API-avainta ei tarvita.

Valinnainen ylläpitäjän hallitsema CSV antaa käsin asetettavat ohitukset ennen
MMDB-hakua. Aseta sen absoluuttinen polku avaimelle `statistics_geoip_file`
tiedostossa `/etc/nodus-monitor/config.json`. Säilytä aineisto repon ulkopuolella.
Polku on ylläpitäjän asennusasetus eikä selaimesta muokattava asetus.
[geoip.example.csv](geoip.example.csv) sisältää vain dokumentointiin varattuja
osoitteita ja havainnollisia sijainteja; se ei ole oikea GeoIP-tietokanta.

CSV:n pakollinen otsikkorivi on
`network,country,country_code,city,latitude,longitude`. `network` hyväksyy
yksittäisen IP-osoitteen tai CIDR-verkon. Tarkin sopiva verkkorajaus voittaa;
päällekkäiset saman verkon rivit hylätään. Koordinaattien on oltava äärellisiä
lukuja: leveysaste −90…90 ja pituusaste −180…180. Maakoodi on valinnainen ja
annettuna kaksikirjaiminen. Lukuraja on 100 000 riviä ja 16 MB. Yksityisiä ja
varattuja osoitteita ei sijoiteta kartalle; tämä koskee myös esimerkin osoitteita.

## Asennuksen asetukset

Ylläpitäjän hallitsemat avaimet ovat valinnaisia. Vanhat asetustiedostot saavat
alla näkyvät oletusarvot. Avaimet kuuluvat seurannan asetuksiin,
eivät Nodus-asetuksiin.

| Avain | Oletus | Sallittu arvo |
| --- | --- | --- |
| `statistics_enabled` | `true` | Totuusarvo. Ottaa tämän osion keruun käyttöön. |
| `statistics_collection_seconds` | `20` | Kokonaisluku 2–60; keruun aikaraja sekunteina. |
| `statistics_max_blocks` | `32` | Kokonaisluku 1–256; uusien lohkojen keruuraja kerralla. |
| `statistics_backfill_blocks` | `16` | Kokonaisluku 0–256; vanhempien lohkojen keruuraja kerralla. |
| `statistics_geoip_enabled` | `true` | Totuusarvo. Sallii paikallisen MMDB-/CSV-haun, kun aineisto on saatavilla. |
| `statistics_geoip_auto_update` | `false` | Totuusarvo. Lataukset vaativat asennusvalinnan ja ajastimen. |
| `statistics_geoip_file` | `null` | Paikallisen CSV-ohitustiedoston absoluuttinen polku tai `null`. |
| `statistics_history_days` | `366` | Kokonaisluku 1–3660; verkkohavaintojen säilytysaika päivinä. |

`network_enabled: false` estää ulkoisen keruun. Hidas tai vastaamaton lähde voi
jättää keruukerran kesken; lohkorajan kasvattaminen ei ohita aikarajaa.
Lohkohistorialla ja tallennetuilla verkkohavainnoilla on eri kattavuus, joka
ilmoitetaan erikseen.

Pääkäyttäjänä toimiva kerääjä avaa paikallisen witness-tietokannan vain lukua
varten julkisten storage-tietojen hakemiseksi. Se ei muuta Nodus-asetuksia,
allekirjoita tapahtumia tai käynnistä nodepalveluita uudelleen. Tavallisena
käyttäjänä toimiva HTTP-palvelu lukee vain seurannan tallentamia tilastoja.

Vain lukua palvelevat HTTP-rajapinnat ovat:

| Rajapinta | Tulos |
| --- | --- |
| `/api/statistics?range=24h` | Tilastojen JSON, lähteiden tila ja kattavuus. |
| `/api/statistics/export.csv?range=24h` | Valitun aikavälin CSV-vienti. |

`range` hyväksyy arvot `24h`, `7d`, `30d`, `1y` ja `all`; oletus on `24h`.
Kattavuustiedot ovat mukana viennissä. Aikavälin valitseminen ei tee
puutteellisesta lähteestä täydellistä.

Tavallinen asennus ja yhteyden avaaminen on kuvattu
[pääohjeessa](../README_fin.md). Asennus on ylläpitäjän erillinen toimenpide;
tämän kehityshaaran hakeminen ei yksin päivitä käynnissä olevaa palvelinta.

## Lähdekoodi ja kehitys

| Polku | Tarkoitus |
| --- | --- |
| `collector.py`, `store.py`, `api.py` | Rajattu keruu, havaintojen tallennus ja raporttien lukurajapinta. |
| `indexer.py` | Vähitellen täydentyvä lohkoindeksi ja aktiivisuuskoosteet. |
| `geolocation.py`, `geoip_common.py` | Paikallinen MMDB-/CSV-haku, välimuisti ja tiedostomuotojen tarkistus. |
| `geoip_update.py`, `enable_geoip.sh`, `nodus-monitor-geoip-update.*` | Tarkistetut kuukausilataukset ja systemd-asennusvalinta. |
| `frontend/` | Varsinainen käyttöliittymälähde, tyylit, mukana tuleva kartta ja erikseen tunnistettu synteettinen esikatselu. |
| `tests/` | Synteettiset taustaosan ja käyttöliittymän tarkistukset. |

`sync_frontend.py` kopioi varsinaiset käyttöliittymätiedostot hakemistoon
`dist/statistics/`. Näin nykyisen sovelluksen esikatselu käyttää samoja tiedostoja
kuin asennettu seuranta. Python-paketti asennetaan hakemistoon
`/opt/nodus-monitor/network_statistics`.

Käyttöliittymän lähteiden muokkauksen jälkeen aja repon juuressa:

```bash
python3 network_statistics/sync_frontend.py
python3 network_statistics/sync_frontend.py --check
python3 -m pip install maxminddb==3.2.0  # valinnainen lukija, tarvitaan MMDB-testeihin
python3 -m unittest discover -s network_statistics/tests -v
node network_statistics/tests/frontend.mjs
```

Mukana tulevan maa-alueiden ääriviivakartan tekijätiedot ja public domain
-lähde on kuvattu tiedostossa [frontend/NOTICE.md](frontend/NOTICE.md).
Karttatiedosto sisältää vain maantiedettä, ei nodejen sijaintiluetteloa.

Esikatselu on erikseen merkitty synteettiseksi. Sitä käytetään vain
tarkoituksellisessa demotilassa. Oikean rajapinnan virhe ei saa vaihtaa
demotietoja mittaustiedoksi. Esikatseludataa ei asenneta varsinaiseen seurantaan.

## Noduksen lähteet

- [Scanin JSON-rajapinta ja indeksin säännöt](https://github.com/nocdem/dna/blob/main/explorer/README.md)
- [Nodus-asiakkaan kyselyt](https://github.com/nocdem/dna/blob/main/nodus/include/nodus/nodus.h)
- [Julkiset palvelin- ja vertaishavainnot](https://github.com/nocdem/dna/blob/main/nodus/src/server/nodus_server.c)
- [Storage-rekisterin ja jäsenjoukkojen rakenne](https://github.com/nocdem/dna/blob/main/nodus/src/witness/nodus_witness.h)

Noduksen lähdekoodi ja käytössä olevat rajapinnat voivat erota toisistaan.
Testit käyttävät synteettisiä aineistoja. Hyväksytty testitulos ei väitä kaikkien
julkisten nodejen tai Scan-rajapintojen olevan juuri nyt tavoitettavissa.
