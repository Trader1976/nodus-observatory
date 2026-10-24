# Nodus Observatory

[English](README.md) · **Suomi**

![Nodus Observatoryn yleiskuva](docs/observatory.png)

Paikallinen seurantasivu Nodus-nodelle, jossa on witness, storage tai molemmat:
ketjun synkronointi, roolikohtaiset havainnot, verkon tilanne, palvelimen
resurssit, tapahtumat ja omistajalompakon erillinen palkkiokirjanpito
vuosikoosteineen ja CSV-vienteineen.

## Nykytila

- Versio **1.0.0**, tuettu Nodus 0.26.7 testnet -asennus Debian/Ubuntu-palvelimella.
- Pääalueet ovat **Observatory, Sopimusstudio ja Asetukset**.
- Observatoryn **Yleiskuva-, Tallennustila- ja Witness-näkymistä** näytetään vain
  seurantaan valitut roolit. Verkko, Palkkiot ja Tapahtumat säilyvät yhteisinä.
- Asetuksissa valitaan seurattavat roolit ja tallennetaan tämän asennuksen
  seuranta-asetukset. Katso [roolit ja asetukset](docs/settings_fin.md).
- **Sopimusstudio** on oma kokeellinen alueensa, jossa on asiakirjan paikallinen
  tiivistys, lompakossa tehtävä leimaus ja rekisterin lukutarkistus. Visuaalinen
  escrow-editori säilyy esimerkkinä. Uudessa editorissa voi muokata tiloja,
  toimintoja, ehtoja ja rooleja. Katso [asiakirjojen ohje](docs/document-notary_fin.md),
  [visuaalisen editorin ohje](docs/contract-studio-builder_fin.md) ja [escrow-ohje](docs/contract-studio_fin.md).
- Yläreunan **FIN / ENG** vaihtaa koko käyttöliittymän suomeksi tai englanniksi.
  Valinta säilyy samassa selaimessa; oletuskieli on suomi.
- Paikallinen kerääjä tallentaa mittauksia noin minuutin välein ja palvelee
  käyttöliittymää oletuksena vain osoitteessa `127.0.0.1:8890`. Nodus-kyselyt
  ovat vain lukua; Asetukset tallentaa vain rajattuja Observatoryn asetuksia.
- Kuvaajat perustuvat kerättyihin havaintoihin. Puuttuva tieto säilyy puuttuvana;
  vanhentuneet tiedot tai virheet eivät muutu terveeksi tilaksi.
- Omistajalompakon staking-, storage- ja witness-palkkiot sekä vanhojen maksujen
  automaattinen tuonti julkisesta Scanista. Bondien palautukset esitetään erikseen.
  Euromääräinen arvostus ja sen lähde voidaan kirjata; puuttuvaa hintaa ei keksitä.
- `dist/` sisältää myös **synteettisen demon**. Sen keksityt tunnisteet,
  mittaukset ja tapahtumat eivät kuvaa oikeaa palvelinta tai lompakkoa.
  Demotiedostoja ei asenneta paikallisen seurannan mittausdataksi.

Python 3:n vakiokirjasto riittää palvelimella. Käyttöliittymä ei lataa kirjastoja,
fontteja tai kuvia CDN:stä. Kehitystarkistukset käyttävät lisäksi Node.js 22:ta.

Tämä on erillinen monitorointisovellus. Se ei ole Nodus-noden lähdekoodirepo.
Repon mukana ei ole yksityisiä identiteettiavaimia tai lompakon tunnuksia.
Jokainen asennus tunnistaa oman nodensa ja käyttää omia paikallisia asetuksiaan.
Repon esimerkkidata on synteettistä.

## Verkon tilastot

Avaa ylävalikosta **Tilastot**: verkon aktiivisuus, erilliset native- ja
EVM-osoitteiden määrät, nodelista ja kartta, staking/storage-käyrät sekä
älysopimusten käyttö. Aikavalinnat ovat 24 tuntia, 7/30 vuorokautta, vuosi ja
kaikki saatavilla oleva historia. Rajattu taustakeruu tallentaa oman historiansa
ja indeksoi ensin tuoreet Scan-lohkot, sitten vanhempaa aineistoa. Lähdekattavuus,
aukot ja vanhentunut tieto näkyvät käyttöliittymässä. Kartan sijainnit saadaan valinnaisesta paikallisesta DB-IP City Lite -aineistosta,
jonka kuukausipäivitys otetaan käyttöön komennolla
`sudo bash backend/install.sh --enable-geoip`. CSV-ohitukset ovat myös mahdollisia.
Tilastot piilottaa nodejen IP-osoitteet käyttöliittymästä ja JSON-raporteista.
Witnessiä klikkaamalla näet paikallisen ketjutilan delegoijien lompakkotunnisteet,
summat ja jakaumakuviot.

Osion varsinainen lähdekoodi, testit ja kaksikielinen ohje ovat hakemistossa
[`network_statistics/`](network_statistics/README_fin.md). `dist/statistics/`
muodostetaan sen selainlähteistä. Vanhoihin asetuksiin sovelletaan oletusarvoja;
asennus säilyttää seurantahistorian ja käynnistää vain Observatoryn palvelut
uudelleen.

## Vaatimukset

- Debian/Ubuntu, systemd ja käynnissä oleva Nodus-node.
- Python 3.10 tai uudempi; valinnainen GeoIP-asennus lisää `python3-maxminddb`-lukijan, muuten vakiokirjasto riittää. Ubuntu 24.04 on testattu.
- Git, asennukseen ylläpitäjän oikeudet sekä `nodus-cli`, `findmnt` ja `lsblk`.
- Valinnainen `smartctl` (`smartmontools`) tuetun fyysisen levyn kuntotietoihin.

Käyttöliittymä ei vaadi käännösvaihetta. Node.js 22 tarvitaan vain kehitystesteihin.

## Erillinen Sopimusstudio-kokeilu

Avaa **Sopimusstudio** yläreunasta. Se on oma kokeellinen alueensa riippumatta
seurattavista node-rooleista. Muutos säilyttää nykyiset editorit ja
asiakirjatoiminnon eikä lisää Deploy to chain -toimintoa.

Asiakirjatoiminto laskee tiedoston SHA-256-tiivisteen paikallisesti
(enintään 64 MiB), valmistelee oikean rekisterin ABI:n, bytecoden ja lompakkokutsun
tiedot sekä lukee kirjauksen omalta nodelta rajatun lukukyselyn avulla. Tiedostoja
tai yksityisiä avaimia ei lähetetä. Tulos kertoo valitun rekisterin ja julkaisijan
kirjauksesta; se ei todista tekijyyttä, sisällön totuutta tai ketjuun kuulumista
riippumattomasti. Nykyinen CLI ei varmista julkaistun sopimuksen koodia automaattisesti.
Katso [asiakirjan leimaus ja tarkistus](docs/document-notary_fin.md).

**Escrow-esimerkki** säilyttää aiemman rajatun tilakoneen: ostajan talletus,
ostajan hyväksyntä, myyjän nosto, palautus määräajan jälkeen ja peruutus ennen
talletusta. Tilojen raahaaminen muuttaa asettelua. Yhteyksien muokkaaminen muuttaa
kaaviota, joka tarkistetaan ennen koodin vientiä. Puutteellinen tai tukematon
kaavio ilmoitetaan käyttäjälle eikä sitä korvata huomaamatta toisella sopimuksella.

**Visuaalinen editori** (`#contracts-editor`) lisää omat tilat, kutsuttavat
toiminnot, roolit ja JA/TAI-ehdot. V2-generaattori ja paikallinen simulaattori
tukevat täsmällisiä talletuksia ja maksuja, yhden hyväksyntäkierroksen
koorumeita sekä valtuutetun kutsujan tiivistekirjauksia. V1-tallennusten merkitys
säilyy, ja niistä voi erikseen muuntaa muokattavan kopion. Editoreilla on yhteinen
nimettyjen tallennusten lista. Tuetut toiminnot, kääntäjän valinta ja rajat on
kuvattu [visuaalisen editorin ohjeessa](docs/contract-studio-builder_fin.md).

Editori ja simulaatio toimivat paikallisesti selaimessa. Ne eivät lue avaimia,
allekirjoita tapahtumia, siirrä kolikoita tai lisää seurannan palvelimelle
kirjoittavia rajapintoja. Simulaatio on malli, ei ketjun nodessa suoritettu ohjelma.
Erillinen paikallinen käännöstyökalu tuottaa ABI:n ja bytecoden vain, kun sille
annetaan oikea Nodus-kääntäjä. Asiakirjapohjan mukana toimitetaan myös toistettavasti
käännetyt tiedostot. Sopimusten julkaisu ja rekisteröintikutsut tarkistetaan ja
allekirjoitetaan erikseen Nodus-lompakossa. Tiedoston valinta tai viite-JSONin
lataaminen ei vielä kirjaa mitään ketjuun.

Roolit huomioivan Observatory-haaran voi kokeilla erillisessä
työhakemistossa ennen sen yhdistämistä `main`-haaraan:

```bash
git clone --branch feature/role-aware-observatory \
  https://github.com/Trader1976/nodus-observatory.git nodus-observatory-roles
cd nodus-observatory-roles
sudo bash backend/install.sh
```

Tämä päivittää asennetun seurannan kokeiluversioon. Editorin, kääntäjän, testien ja
rajoitusten ohjeet ovat [Sopimusstudion ohjeessa](docs/contract-studio_fin.md).

## Asennus lähdekoodista

Kloonaa repo node-palvelimelle ja aja sen juuressa:

```bash
git clone https://github.com/Trader1976/nodus-observatory.git
cd nodus-observatory
sudo bash backend/install.sh
```

Uusi asennus tunnistaa julkisen fingerprintin ja datahakemiston paikallisesta
`nodus-cli status` -tulosteesta sekä tiedostojärjestelmän ja tavallisen levyn
`findmnt`/`lsblk`-tiedoista. Paikallisten palvelutietojen perusteella ehdotetaan
myös seurattavia storage- ja witness-rooleja. Valinnan voi korjata Asetuksissa.
Myös käyttöjärjestelmän juurilevyllä oleva data on tuettu. Erillinen dataosio on valinnainen. Verkkoliitäntä seuraa oletusreittiä.
Nodus-palvelun pitää olla käynnissä, jotta tunnistus onnistuu. Yksityisiä avaimia
tai Nodus-asetustiedostoa ei lueta. Tunnistuksen virhe pysäyttää asennuksen ennen
palvelumuutoksia. LVM/RAID-laitteen SMART jää tuntemattomaksi automaattitilassa.

Tarvittaessa kopioi `backend/config.example.json` repon ulkopuolelle, aseta oman
koneesi `data_path`, `mount_path`, `cli_path` ja halutessasi `disk_device` sekä
`rewards_source_db`, ja käytä `sudo bash backend/install.sh --config /polku/config.json`.
`fingerprint: null` käyttää paikallisen noden status-tunnistetta. `mount_path` on
datan todellinen liitoskohta (esimerkiksi `/`, jos erillistä dataosiota ei ole).
Monitorin omat `state_dir`- ja `frontend_dir`-polut ovat asennuksessa kiinteät.
Asenna node-data järjestelmähakemistoon: systemd-palvelun `ProtectHome=yes` rajaa
kotihakemistot pois. SMART tarvitsee `smartctl`-ohjelman (paketti `smartmontools`);
puuttuvat levymittaukset jäävät tuntemattomiksi.

Päivityksessä asennin säilyttää olemassa olevan
`/etc/nodus-monitor/config.json`-tiedoston, Asetukset-sivun tallennukset ja
konekohtaiset arvot. Jos vanhasta asetustiedostosta puuttuu `roles`, molempien
roolien seuranta säilyy käytössä. Päivitys ei poista roolia seurannasta.
`--config` on tarkoitettu vain ensimmäiseen asennukseen. Rajattuja seurannan
asetuksia voi muuttaa [Asetukset-sivulla](docs/settings_fin.md).

## Asennetun sovelluksen päivittäminen

Aja puhtaassa lähdekoodihakemistossa node-palvelimella. Korvaa esimerkkipolku
oman kloonisi polulla:

```bash
cd /path/to/nodus-observatory
git switch main
git pull --ff-only origin main
sudo bash backend/install.sh
```

Jos aiempi asennus tuli arkistopaketista, kloonaa repo uuteen hakemistoon ja aja
asennin. Se käyttää olemassa olevia asetuksia ja säilyttää kerätyn historian.
Erillistä julkaisupakettia ei tarvita. Asennin käynnistää vain monitorin omat
palvelut uudelleen; node ja muut palvelinsovellukset jatkavat toimintaansa.

HTTP-palvelin voi tarvita hetken käynnistyäkseen. Tarkista asennuksen jälkeen:

```bash
systemctl is-active nodus-monitor.service nodus-monitor-collect.timer
curl -fsS --retry 5 --retry-connrefused --retry-delay 1 --max-time 10 \
  http://127.0.0.1:8890/api/health
```

Päivitä käyttöliittymä selaimessa välimuistin ohittaen (yleensä Ctrl+Shift+R).

Asennuspolut:

- Ohjelma: `/opt/nodus-monitor`
- Ylläpitäjän omistamat perusasetukset: `/etc/nodus-monitor/config.json`
- Asetukset-sivun tallennukset: `/var/lib/nodus-monitor/settings/settings.json`
- Mittaukset, tapahtumat ja palkkiokirjanpito: `/var/lib/nodus-monitor`
- HTTP: `127.0.0.1:8890`

## Avaa sivu

Aja **työpöytäkoneella** ja pidä tämä yhteys auki:

```bash
ssh -N -L 8890:127.0.0.1:8890 USER@NODE_SERVER
```

Avaa selaimessa <http://127.0.0.1:8890>. Yhteys on SSH-tunnelissa.
Uutta reitittimen porttiohjausta ei tarvita. Palvelu ei tarjoa internetiin
avointa hallintapaneelia eikä ota vastaan noden hallintakomentoja.

## Valinnainen etäkäyttö puhelimella

Paikallinen oletusasennus toimii ilman Cloudflarea tai verkkotunnusta.
Ylläpitäjä voi lisätä oman HTTPS-osoitteen Cloudflare Tunnelin ja Accessin kautta.
Katso [etäkäytön määritys ja kirjautumisen tarkistukset](docs/remote-access_fin.md).
Pilvipalvelun tili, domain ja kirjautumissäännöt kuuluvat kyseiseen asennukseen.
Sama käyttöliittymä ja API toimivat sekä localhostissa että suojatulla etäosoitteella.
Kaikki asennukseen pääsevät käyttäjät voivat myös muuttaa sen muokattavia
asetuksia. Suojaa koko osoite, myös Asetukset-API. Sovelluksessa ei ole erillisiä
katselu- ja ylläpitäjätunnuksia.

## Käyttöliittymän kielet

Yläreunan FIN/ENG-painikkeet vaihtavat kaikkien näkymien, esimerkkien, kuvaajien,
työkaluvihjeiden, virhetilojen ja tietoa-ikkunan kielen heti. Sivu, kuvaajan
aikaväli, tapahtumasuodatin ja palkkiovuosi säilyvät vaihdossa. Valinta tallennetaan
selaimen paikalliseen tallennustilaan kyseiselle osoitteelle. Jos tallennustila
on estetty, kielivalinta toimii nykyisen sivun ajan. Ensimmäisen käynnin oletus
on suomi; FIN/ENG-painikkeet toimivat myös puhelimella ja näppäimistöllä.

Käännökset eivät muuta mittausdataa tai rahamäärien tarkkuutta. Näytön luvut ja
päiväykset muotoillaan kielivalinnan mukaan; raporttien aikavyöhyke säilyy
Europe/Helsinki-alueena. Alkuperäiset lokiviestit ja tekniset tunnisteet säilyvät
lähteen mukaisina. CSV:n sarakenimet ja täsmälliset rahamäärät pysyvät samoina
molemmilla kielillä, jotta kirjanpidon jatkokäsittely on vakaa.

## Omistajalompakon palkkiot ja aiemmat maksut

Palkkiot-sivu kattaa **omistajalompakolle** maksetut staking-, storage- ja
witness-palkkiot. Maksutositteessa eri roolien palkkiot yhdistyvät, joten sovellus
ei keksi roolikohtaista erittelyä eikä kohdista koko lompakon tuottoa tälle
node-roolille. Näkymän tai seurattavien roolien vaihto ei luo palkkioihin
roolikohtaista erittelyä. Storagen grace-jakso estää vain storage-palkkiot, ei
lompakon muista rooleista saamia palkkioita.

Päivitetty monitori tarkistaa julkisen Scanin palkkiohistorian automaattisesti
noin viiden minuutin välein ja tuo aiemmat maksut samaan kirjanpitoon paikallisten
havaintojen kanssa. Tuonti ei tarvitse lompakon avaimia, Nodus-asetusten muutoksia
tai Noduksen uudelleenkäynnistystä. Pyyntö lähettää havaitun **julkisen omistajan
sormenjäljen** osoitteeseen `scan.nodusnetwork.io`. Scan on ulkopuolinen havaintolähde,
ei jokaisen maksun itsenäinen kryptografinen varmennus. Sen ilmoittaman
ketjutunnisteen on vastattava paikallista nodea ja tuettua julkista testnetiä.

Sivu näyttää lähteen ja sen havaitun kattavuuden. Scan voi toimittaa vain omaan
indeksiinsä kuuluvat maksut; tuonti ei osoita koko lompakkohistoriaa tai verovuotta
täydelliseksi. Sama tapahtuma lasketaan vain kerran, vaikka se löytyisi sekä
paikallisesti että Scanista. Ristiriitainen aineisto hylätään korvaamatta aiempia
maksuja tai EUR-arvostuksia. Epäonnistunut tuonti säilyttää aiemman kirjanpidon.
Odottava kertymä saadaan edelleen vain paikallisen Nodus-tietokannan nykytilasta
ja pidetään erillään maksetuista palkkioista ja palautetusta pääomasta.

`rewards_scan_enabled` on oletuksena `true`, myös jos avain puuttuu vanhasta
asetustiedostosta. Pelkän Scan-tuonnin saa pois asettamalla arvoksi `false`
tiedostossa `/etc/nodus-monitor/config.json` tai Asetukset-sivulla; paikallinen
palkkiokeruu jatkuu. Tallennettu sivuasetus ohittaa vastaavan perusasetuksen.
`network_enabled: false` estää kaikki ulkoiset verkkokyselyt, myös Scanin
palkkiotuonnin. `rewards_enabled: false` estää molemmat palkkiolähteet.

### Kytke tulevien maksujen paikallinen historia

Noduksen osoitehistoria on oletuksena pois päältä. Se kerää **tulevia paikallisia**
maksuja eikä rakenna vanhaa paikallista historiaa uudelleen. Scan-tuonti voi
lisätä aiempia maksuja oman kattavuutensa rajoissa, vaikka paikallinen indeksi
olisi aloitettu myöhemmin. Erillinen ylläpitotyökalu näyttää ensin suunnitelman:

```bash
sudo python3 /opt/nodus-monitor/enable-reward-history.py
```

Tarkistettuasi suunnitelman voit kytkeä tulevan paikallisen maksuarkiston:

```bash
sudo python3 /opt/nodus-monitor/enable-reward-history.py --apply
sudo nodus-cli status
```

Työkalu varmuuskopioi `/etc/nodus.conf`-tiedoston, lisää
`"addr_history_index": true` ja käynnistää **vain nodus-witness-palvelun kerran**
uudelleen. Ketjudata ja identiteetti säilyvät. Tarkista käynnistyksen jälkeen,
että node palaa synkroniin ja `fail_streak` on kunnossa. Jos asetus on jo päällä,
työkalu ei muuta mitään eikä käynnistä palvelua uudelleen. Tavallinen seuranta
ja Scan-tuonti eivät kytke indeksiä tai käynnistä Nodusta uudelleen.

Palkkiot-sivulta ladataan valitun vuoden CSV. Alkuperäiset raw/tokenimäärät,
lohko, tapahtumatunniste, UTC- ja Suomen aika, verkko sekä aineiston kattavuus
säilyvät. Rahamäärät käsitellään täsmällisinä kokonais-/desimaalilukuina.
Puuttuva euromääräinen arvostus näkyy puuttuvana, ei nollana. Nykyinen verkko on
testnet; sovellus ei anna testnet-tokenille markkina-arvoa.

Euromääräisten arvostusten erillinen tuonti, lähteet ja muutoshistoria on kuvattu
tiedostossa [rewards/README_fin.md](rewards/README_fin.md). Raportti tuottaa aineistoa omaan kirjanpitoon;
se ei laske verovelkaa tai luokittele tuloa automaattisesti.

## Mitä kerätään

- Nodus CLI:n tilanne ja julkinen storage-tilakysely ilman identiteetin salaisia avaimia.
- Oma ja verkon lohkokorkeus, lohkoero, grace, fail_streak, segmentit ja palvelut.
- Palvelimen CPU, muisti, levytila, verkko- ja levyliikenne; SMART noin 15 min välein.
- Enintään 300 luokiteltua journal-havaintoa keräyskerralla. Tämä ei ole täydellinen lokiarkisto.
- Verkon julkiset Scan-tilastot noin 5 min välein ja paikallinen komiteakysely.
- Valinnaiset omistajalompakon palkkiot paikallisesta Nodus-tietokannasta vain
  lukemalla ja julkisesta Scanista historiatietoineen sekä lähteen kattavuuksineen.

Mittauksia kerätään noin minuutin välein. Pitkä tai aikakatkaistu kysely voi
siirtää seuraavaa keräystä; tuoreus näkyy sivulla. Ensimmäisellä keräyksellä ei
vielä ole kahden näytteen erotusta CPU-/siirtonopeuksille. Mittaushistoriaa
säilytetään oletuksena 30 päivää. Palkkiokirjanpitoa ei poisteta tämän rajan mukana.

Staattinen demo käyttää synteettisiä JSON-esimerkkejä. Niitä ei asenneta paikalliseen
käyttöliittymään eikä käytetä epäonnistuneen reaaliaikaisen keräyksen korvikkeena.
Demotila on merkitty näkyvästi. Oikeat mittaukset tulevat asennetusta kerääjästä.
Kerääjä tarkistaa myös valinnaisten PQ-NAS- ja cloudflared-palveluiden tilan,
jos ne on asennettu. Niitä ei vaadita monitorin käyttöön.

## Tarkistukset ja lokit

```bash
systemctl status nodus-monitor nodus-monitor-collect.timer --no-pager
sudo journalctl -u nodus-monitor-collect -n 30 --no-pager
curl -fsS http://127.0.0.1:8890/api/health
```

Kerääjän tilatiedostoissa virhe on virhe, ei nolla tai terve tila. Puuttuvat
ulkopuoliset verkkotilastot eivät estä oman noden seurantaa.

Varmuuskopioi `/var/lib/nodus-monitor` ja mahdolliset arvostusten lähdeasiakirjat
säännöllisesti. Erillisen SQLite-kirjanpidon johdonmukaisen varmuuskopion voi tehdä:

```bash
sudo python3 - <<'PY'
import sqlite3
from pathlib import Path
from datetime import datetime, timezone
src = Path('/var/lib/nodus-monitor/reporting.sqlite3')
dst = Path('/root/nodus-rewards-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '.sqlite3')
if not src.is_file():
    raise SystemExit('Palkkiokirjanpitoa ei vielä ole.')
with sqlite3.connect(src.as_uri() + '?mode=ro', uri=True) as source:
    with sqlite3.connect(dst) as target:
        source.backup(target)
dst.chmod(0o600)
print(dst)
PY
```

## Poistaminen

```bash
sudo systemctl disable --now nodus-monitor.service nodus-monitor-collect.timer
sudo systemctl stop nodus-monitor-collect.service
```

Tämä pysäyttää vain seurannan. Säilytä kirjanpitotietokanta ja asetukset.
Seurannan pysäytys tai roolin poisto seurannasta ei poista Nodus-dataa,
muuta roolirekisteröintiä, pysäytä Nodus-palvelua tai vapauta bondia.

## Kehityksen tarkistukset

```bash
python3 -m unittest discover -s backend/tests -v
python3 -m unittest discover -s rewards -p 'test_*.py' -v
python3 -m unittest discover -s tests -v
node --check dist/i18n.js
node --check dist/app-translations.js
node --check dist/app.js
node --check dist/observatory-settings.js
node --check dist/observatory-settings-i18n.js
node tests/frontend-smoke.mjs dist
node tests/frontend-i18n.mjs dist
node tests/frontend-roles.mjs dist
node tests/observatory-settings.mjs dist
node tests/contract-studio-core.mjs
node tests/contract-studio-integration.mjs
node tests/document-notary-core.mjs
node tests/document-notary-integration.mjs
bash -n backend/install.sh
```

Lähdesopimus on tarkistettu asennetusta Nodus 0.26.7 / commit
`24f93e6b709119a3013efacf3a374930c97871b7` -versiosta. Ohjelmiston päivitys voi
muuttaa CLI-tekstiä tai tietokantaskeemaa; tuntematon kenttä jätetään tyhjäksi.


GitHub Actions suorittaa samat Python-testit, käyttöliittymän smoke- ja kielitestit sekä
syntaksitarkistukset. Testit eivät tarvitse Nodus-nodea, juurioikeuksia tai
ulkopuolisia verkkopalveluita; API-testit käyttävät paikallista testipalvelinta.

## Repon rakenne

| Hakemisto | Sisältö |
|---|---|
| `backend/` | Kerääjä, paikallinen HTTP-API, asetusesimerkki ja systemd-asennus |
| `dist/` | Valmis käyttöliittymä ja synteettiset demotiedostot |
| `docs/` | Käyttöönotto-ohjeet englanniksi ja suomeksi |
| `rewards/` | Palkkiot, arvostukset, CSV-vienti ja aineiston kattavuus |
| `tests/` | Verkkoadapterin, julkisten esimerkkien ja käyttöliittymän testit |
| `.github/workflows/` | Automaattiset tarkistukset |

Älä lisää repon tiedostoihin palvelimen mittaustietokantoja, lokiarkistoja,
veroraportteja, `.env`-tiedostoja tai identiteettiavaimia. Niiden oletuspolut ja
yleiset tiedostomuodot on rajattu pois `.gitignore`-tiedostossa. Palkkiokirjanpidon
varmuuskopiot säilytetään erillään lähdekoodista.

Dokumentaatiota ylläpidetään pareittain: päivitä englanninkielinen sivu ja sen
`_fin.md`-vastine samalla muutoksella. Vanha `README-fi.md` säilyy ohjaavana linkkinä.
Käytä esimerkeissä dokumentaatioon varattuja osoitteita, paikkamerkkejä ja keksittyjä
tunnisteita. Frontend-testit eivät käytä oikeaa selainta; tarkista ulkoasumuutokset
myös selaimessa, kun kehität käyttöliittymää.


## Trade / Swap -testityöpöytä

Uusi `#trade`-alue valmistelee NODUS–tBNB-osto- ja myyntitarjouksia, säilyttää julkiset tarjoukset paikallisesti ja simuloi kahden ketjun lukitukset, lunastukset ja palautukset. Sisältää käännetyt Nodus- ja BSC-testiverkkosopimukset. Lompakkoyhteydet ja verkkotapahtumien lähetys tulevat erikseen. [Ohje](docs/trade-swap_fin.md).
