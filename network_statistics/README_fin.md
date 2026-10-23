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

Sijaintihaku käyttää valinnaista ylläpitäjän hallitsemaa paikallista
CSV-tiedostoa. Automaattisia ulkoisia sijaintikyselyjä ei tehdä. Mukana oleva
[geoip.example.csv](geoip.example.csv) sisältää vain dokumentointiin varattuja
osoitteita ja havainnollisia sijainteja. Se ei ole GeoIP-tietokanta eikä sitä
pidä käyttää oikeiden nodejen paikantamiseen.

Aseta oman sijaintitiedostosi absoluuttinen polku avaimelle
`statistics_geoip_file` tiedostossa `/etc/nodus-monitor/config.json`. Säilytä
tiedosto repon ulkopuolella. Polku on ylläpitäjän asennusasetus eikä selaimesta
muokattava asetus. Komitean IP-osoitteen voi yhdistää sijaintiin suoraan;
storage-rekisterin fingerprint ei yksin sisällä IP-osoitetta.

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
| `statistics_geoip_file` | `null` | Paikallisen CSV-tiedoston absoluuttinen polku tai `null`. |
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
| `geolocation.py` | Paikallinen IP-sijaintihaku. |
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
python3 -m unittest discover -s network_statistics/tests -v
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
